/**
 * Specialization — zero-cost typeclass abstraction via compile-time inlining
 *
 * The core philosophy of typesugar is zero-cost abstractions: you write generic,
 * typeclass-polymorphic code, and the transformer eliminates the abstraction
 * overhead at compile time — no dictionary passing, no indirect dispatch, no
 * closure allocation at runtime.
 *
 * ## How it works
 *
 * Specialization is a transparent compiler optimization (PEP-053), not an API —
 * there is no macro to call. Every call site that passes a known typeclass
 * dictionary is a candidate: the transformer inlines the dictionary's methods
 * directly, eliminating the indirection.
 *
 * ```typescript
 * // Generic (has runtime cost: dictionary passing, indirect dispatch)
 * function double<F>(F: Functor<F>, fa: Kind<F, number>): Kind<F, number> {
 *   return F.map(fa, x => x * 2);
 * }
 *
 * // Auto-specialized at the call site — no annotation needed:
 * const result = double(arrayFunctor, [1, 2, 3]);
 * // Compiles to: [1, 2, 3].map(x => x * 2)
 * ```
 *
 * ## Specialization strategies
 *
 * 1. **Dictionary elimination** — The dictionary parameter is removed from the
 *    function signature. All `F.method(...)` calls are replaced with the
 *    concrete implementation from the dictionary.
 *
 * 2. **Method inlining** — When the dictionary's methods are simple enough
 *    (single expression bodies), they're inlined directly at the call site.
 *
 * 3. **Type narrowing** — `Kind<F, A>` in the signature is replaced with the
 *    concrete type (e.g., `Array<A>`, `Option<A>`).
 *
 * Specialization only skips a call when it can't prove the inlining is sound
 * (e.g. the function body has a loop or try/catch) — the fallback is always
 * the code you wrote, semantically unchanged. Use `// @no-specialize` on a
 * call to opt it out explicitly.
 *
 * @module
 */

import * as ts from "typescript";
import { MacroContext } from "@typesugar/core";
import { stripPositions, stripCommentsDeep, getOrCreateWeak } from "@typesugar/core";
import { HygieneContext } from "@typesugar/core";
import * as primitives from "./primitives.js";

// ============================================================================
// Specialization Deduplication Cache
// ============================================================================

/**
 * Entry in the specialization cache representing a hoisted specialized function.
 */
export interface SpecCacheEntry {
  /** The identifier referencing the hoisted function */
  ident: ts.Identifier;
  /** The variable declaration statement to be hoisted to module scope */
  declaration: ts.VariableStatement;
}

/**
 * Cache for deduplicated specializations within a single file.
 *
 * When multiple call sites specialize the same function with the same dictionary,
 * this cache ensures only one specialized version is generated. The specialized
 * function is hoisted to module scope and reused at all call sites.
 *
 * Key format: `fnSymbolId×brand1,brand2,...` where brands are sorted alphabetically.
 * This handles aliased imports (different local names, same function).
 */
export class SpecializationCache {
  private cache = new Map<string, SpecCacheEntry>();
  private hoistedDeclarations: ts.VariableStatement[] = [];

  /**
   * Compute a cache key for a specialization.
   *
   * @param fnSymbolId - The TypeScript symbol ID of the function (or function name as fallback)
   * @param dictBrands - Array of dictionary brand names (e.g., ["Array"], ["Option", "Show"])
   * @returns Cache key string
   */
  static computeKey(fnSymbolId: string | number, dictBrands: string[]): string {
    const sortedBrands = [...dictBrands].sort();
    return `${fnSymbolId}×${sortedBrands.join(",")}`;
  }

  /**
   * Generate a hygienic name for a hoisted specialized function.
   *
   * @param fnName - The original function name
   * @param dictBrands - Array of dictionary brand names
   * @param hygiene - Hygiene context for name mangling
   * @returns A unique identifier for the specialized function
   */
  static generateHoistedName(
    fnName: string,
    dictBrands: string[],
    hygiene: HygieneContext
  ): ts.Identifier {
    const sortedBrands = [...dictBrands].sort();
    const baseName = `__${fnName}_${sortedBrands.join("_")}`;
    return hygiene.createIdentifier(baseName);
  }

  /**
   * Check if a specialization is already cached.
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Get a cached specialization entry.
   */
  get(key: string): SpecCacheEntry | undefined {
    return this.cache.get(key);
  }

  /**
   * Store a new specialization in the cache.
   *
   * @param key - The cache key
   * @param ident - The identifier for the hoisted function
   * @param declaration - The variable declaration to hoist
   */
  set(key: string, ident: ts.Identifier, declaration: ts.VariableStatement): void {
    this.cache.set(key, { ident, declaration });
    this.hoistedDeclarations.push(declaration);
  }

  /**
   * Get all declarations that need to be hoisted to module scope.
   * Call this once when processing the source file to get statements to prepend.
   */
  getHoistedDeclarations(): ts.VariableStatement[] {
    return this.hoistedDeclarations;
  }

  /**
   * Clear the cache and hoisted declarations.
   * Call this when starting to process a new file.
   */
  clear(): void {
    this.cache.clear();
    this.hoistedDeclarations = [];
  }

  /**
   * Get the number of cached specializations.
   */
  get size(): number {
    return this.cache.size;
  }
}

/**
 * Create a hoisted variable declaration for a specialized function.
 *
 * Emits: `/*#__PURE__*\/ const __fnName_Brand = <specializedFn>;`
 *
 * The PURE annotation allows bundlers to tree-shake unused specializations.
 */
export function createHoistedSpecialization(
  factory: ts.NodeFactory,
  ident: ts.Identifier,
  specializedFn: ts.Expression
): ts.VariableStatement {
  // Add /*#__PURE__*/ comment for tree-shaking
  const pureSpecializedFn = ts.addSyntheticLeadingComment(
    specializedFn,
    ts.SyntaxKind.MultiLineCommentTrivia,
    "#__PURE__",
    false
  );

  const declaration = factory.createVariableDeclaration(
    ident,
    undefined,
    undefined,
    pureSpecializedFn
  );

  return factory.createVariableStatement(
    undefined,
    factory.createVariableDeclarationList([declaration], ts.NodeFlags.Const)
  );
}

// ============================================================================
// Result Algebra System
// ============================================================================

/**
 * A Result algebra defines how to rewrite `ok()` and `err()` constructors
 * when specializing a Result-returning function to a target type.
 *
 * This enables polymorphic Result functions to be specialized to different
 * target types (Option, Either, bare T) without manual intervention.
 */
export interface ResultAlgebra {
  /** Name of the algebra (e.g., "Option", "Either", "Unsafe") */
  name: string;

  /**
   * Type names that this algebra targets.
   * When the contextual type matches one of these, this algebra is used.
   * e.g., ["Option"] for the Option algebra
   */
  targetTypes: string[];

  /**
   * Rewrite rule for `ok(value)` calls.
   * The function receives the value expression and returns the rewritten expression.
   */
  rewriteOk: (ctx: MacroContext, value: ts.Expression) => ts.Expression;

  /**
   * Rewrite rule for `err(error)` calls.
   * The function receives the error expression and returns the rewritten expression.
   */
  rewriteErr: (ctx: MacroContext, error: ts.Expression) => ts.Expression;

  /**
   * Whether this algebra preserves the error type information.
   * true for Either (keeps error in Left), false for Option (discards error)
   */
  preservesError: boolean;
}

/**
 * Registry of Result algebras, keyed by target type name.
 */
const resultAlgebraRegistry = new Map<string, ResultAlgebra>();

/**
 * Register a Result algebra for use in return-type-driven specialization.
 */
export function registerResultAlgebra(algebra: ResultAlgebra): void {
  for (const typeName of algebra.targetTypes) {
    resultAlgebraRegistry.set(typeName, algebra);
  }
}

/**
 * Look up a Result algebra by target type name.
 */
export function getResultAlgebra(typeName: string): ResultAlgebra | undefined {
  return resultAlgebraRegistry.get(typeName);
}

// ============================================================================
// Built-in Result Algebras
// ============================================================================

/**
 * Option algebra: ok(v) -> v, err(e) -> null
 *
 * Specializes Result<E, T> to T | null (Option<T>).
 * Error information is discarded.
 */
export const optionResultAlgebra: ResultAlgebra = {
  name: "Option",
  targetTypes: ["Option"],
  rewriteOk: (_ctx, value) => value,
  rewriteErr: (ctx, _error) => ctx.factory.createNull(),
  preservesError: false,
};

/**
 * Either algebra: ok(v) -> { _tag: "Right", right: v }, err(e) -> { _tag: "Left", left: e }
 *
 * Specializes Result<E, T> to Either<E, T>.
 * Both success and error values are preserved with discriminated union tags.
 */
export const eitherResultAlgebra: ResultAlgebra = {
  name: "Either",
  targetTypes: ["Either"],
  rewriteOk: (ctx, value) =>
    ctx.factory.createObjectLiteralExpression([
      ctx.factory.createPropertyAssignment("_tag", ctx.factory.createStringLiteral("Right")),
      ctx.factory.createPropertyAssignment("right", value),
    ]),
  rewriteErr: (ctx, error) =>
    ctx.factory.createObjectLiteralExpression([
      ctx.factory.createPropertyAssignment("_tag", ctx.factory.createStringLiteral("Left")),
      ctx.factory.createPropertyAssignment("left", error),
    ]),
  preservesError: true,
};

/**
 * Promise algebra: ok(v) -> Promise.resolve(v), err(e) -> Promise.reject(e)
 *
 * Specializes Result<E, T> to Promise<T>.
 * Useful for async error handling.
 */
export const promiseResultAlgebra: ResultAlgebra = {
  name: "Promise",
  targetTypes: ["Promise"],
  rewriteOk: (ctx, value) =>
    ctx.factory.createCallExpression(
      ctx.factory.createPropertyAccessExpression(
        ctx.factory.createIdentifier("Promise"),
        "resolve"
      ),
      undefined,
      [value]
    ),
  rewriteErr: (ctx, error) =>
    ctx.factory.createCallExpression(
      ctx.factory.createPropertyAccessExpression(ctx.factory.createIdentifier("Promise"), "reject"),
      undefined,
      [error]
    ),
  preservesError: true,
};

// Register built-in algebras
// DELIBERATE builtin seeding (PEP-052 Wave 4 reviewed and retained): these
// algebras are AST-building rewrite functions — not declarable as JSDoc
// metadata — and fp has no macro entry to host its own registration, so
// relocating the seeds would mean inventing loader plumbing for three lines.
// `registerResultAlgebra` remains the extension point for third-party result
// types; the seeds are ordinary calls to it, not a privileged path.
registerResultAlgebra(optionResultAlgebra);
registerResultAlgebra(eitherResultAlgebra);
registerResultAlgebra(promiseResultAlgebra);

// ============================================================================
// Specialization Registry
// ============================================================================

/**
 * Maps dictionary variable names to their known method implementations.
 * Populated by registerInstance() or by analyzing const declarations.
 */
export interface DictMethodMap {
  /** The URI/brand name (e.g., "Array", "Option") */
  brand: string;
  /** Maps method names to their implementation source */
  methods: Map<string, DictMethod>;
}

export interface DictMethod {
  /** The implementation as an AST node — how inlining substitutes the call. */
  node?: ts.Expression;
  /** Parameter names for the method */
  params: string[];
}

/**
 * Registry of known typeclass instances and their method implementations.
 * This is the compile-time knowledge base that enables specialization.
 *
 * Keyed per `ts.Program` (like `instance-resolver.ts`'s `importMapCache`) so
 * watch/LSP rebuilds — which produce a fresh program — invalidate
 * automatically and never serve a stale entry from an old compilation.
 * Callers that can't supply a program (e.g. `diagnostic-suppression-rules.ts`,
 * which only has a bare `ts.TypeChecker`/`ts.SourceFile` via the
 * `DiagnosticSuppressionRule` interface) fall back to one shared bucket,
 * preserving the exact pre-partitioning behavior for that path rather than
 * forcing a public cross-package interface change for a low-severity gap
 * (PEP-056 Wave 5 item 2).
 */
const instanceMethodRegistryByProgram = new WeakMap<ts.Program, Map<string, DictMethodMap>>();
const legacyInstanceMethodRegistry = new Map<string, DictMethodMap>();

function instanceRegistryFor(program?: ts.Program): Map<string, DictMethodMap> {
  if (!program) return legacyInstanceMethodRegistry;
  return getOrCreateWeak(instanceMethodRegistryByProgram, program, () => new Map());
}

/**
 * Register a typeclass instance's methods for specialization using AST nodes.
 * This is the preferred registration method as it avoids source string parsing.
 *
 * Called by @instance macros when processing declarations at compile time.
 */
export function registerInstanceMethodsFromAST(
  dictName: string,
  brand: string,
  methods: Map<string, DictMethod>,
  program?: ts.Program
): void {
  instanceRegistryFor(program).set(dictName, { brand, methods });
}

/**
 * Resolve an object-literal member that is not a direct function expression —
 * a property-access reference (`map: optionFunctor.map`), an identifier
 * reference (`map: mapOption`), or a shorthand property (`{ map }`) — to the
 * underlying method implementation. Supplied by the source-extraction layer,
 * which has TypeChecker access (PEP-053 Wave 2 gap 4).
 */
export type MemberMethodResolver = (expr: ts.Expression | ts.Identifier) => DictMethod | undefined;

/**
 * Extract method implementations from an object literal expression.
 * Used by @instance and @deriving to register instances for specialization.
 *
 * @param objLiteral - The object literal containing method implementations
 * @param hygiene - Optional hygiene context for generating safe placeholder names
 * @param resolveMember - Optional resolver for indirect members (property-access,
 *   identifier, shorthand); without it those members are skipped as before
 * @returns A map of method names to their DictMethod info
 */
export function extractMethodsFromObjectLiteral(
  objLiteral: ts.ObjectLiteralExpression,
  hygiene?: HygieneContext,
  resolveMember?: MemberMethodResolver
): Map<string, DictMethod> {
  const methods = new Map<string, DictMethod>();

  const makeParamPlaceholder = (index: number): string => {
    return hygiene ? hygiene.mangleName(`param_${index}`) : `__param${index}`;
  };

  for (const prop of objLiteral.properties) {
    // Handle property assignments: { methodName: (a, b) => ... }
    if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
      const methodName = prop.name.text;
      const initializer = prop.initializer;

      // Skip non-method properties (like URI)
      if (methodName === "URI") continue;

      if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
        const params = initializer.parameters.map((p, i) => {
          if (ts.isIdentifier(p.name)) {
            return p.name.text;
          }
          // Handle destructuring patterns by using a placeholder
          return makeParamPlaceholder(i);
        });

        methods.set(methodName, {
          node: initializer,
          params,
        });
      } else if (
        resolveMember &&
        (ts.isPropertyAccessExpression(initializer) || ts.isIdentifier(initializer))
      ) {
        // Indirect member: `map: optionFunctor.map` or `map: mapOption`
        const resolved = resolveMember(initializer);
        if (resolved) {
          methods.set(methodName, resolved);
        }
      }
    }

    // Handle method declarations: { methodName(a, b) { ... } }
    if (ts.isMethodDeclaration(prop) && ts.isIdentifier(prop.name)) {
      const methodName = prop.name.text;

      // Skip non-method properties
      if (methodName === "URI") continue;

      const params = prop.parameters.map((p, i) => {
        if (ts.isIdentifier(p.name)) {
          return p.name.text;
        }
        return makeParamPlaceholder(i);
      });

      // Convert method declaration to arrow function expression for storage
      // We store the method body and params; inlineMethod will handle it
      methods.set(methodName, {
        node: prop as unknown as ts.Expression, // Store the method declaration
        params,
      });
    }

    // Handle shorthand property: { methodName } where methodName is a function variable
    if (ts.isShorthandPropertyAssignment(prop)) {
      if (prop.name.text === "URI") continue;
      if (resolveMember) {
        const resolved = resolveMember(prop.name);
        if (resolved) {
          methods.set(prop.name.text, resolved);
        }
      }
      // Without a resolver we can't extract the implementation from shorthand - skip
      continue;
    }
  }

  return methods;
}

/**
 * Get the method map for a known dictionary.
 */
export function getInstanceMethods(
  dictName: string,
  program?: ts.Program
): DictMethodMap | undefined {
  return instanceRegistryFor(program).get(dictName);
}

/**
 * Check if a name is a registered instance dictionary.
 */
export function isRegisteredInstance(name: string, program?: ts.Program): boolean {
  return instanceRegistryFor(program).has(name);
}

/**
 * Get all registered instance dictionary names.
 */
export function getRegisteredInstanceNames(program?: ts.Program): string[] {
  return Array.from(instanceRegistryFor(program).keys());
}

// ---------------------------------------------------------------------------
// Primitive intrinsic registry — separate from instanceMethodRegistry so
// tryAutoSpecialize doesn't pick up primitives as specializable instances.
// Only tryInlineDerivedInstanceCall consults this registry.
//
// Deliberately NOT WeakMap<ts.Program>-partitioned like instanceMethodRegistry
// above: this registry's contents aren't per-compilation state at all — it's
// populated exactly once, at module load, by reflecting primitives.ts's fixed,
// unchanging exports (loadPrimitiveIntrinsicsFromReflection, below). The same
// 16 entries are correct for every ts.Program that will ever exist in this
// process, so partitioning would only add WeakMap indirection for identical
// content in every partition — a real registry needing per-Program isolation
// looks like instanceMethodRegistry; a process-lifetime reflection cache of
// immutable source looks like this one, and the two shouldn't be conflated.
// ---------------------------------------------------------------------------

const primitiveIntrinsicRegistry = new Map<string, DictMethodMap>();

/**
 * Look up instance methods from either the main registry or primitive intrinsics.
 * Used by tryInlineDerivedInstanceCall which should inline both derived and primitive calls.
 */
export function getInstanceOrIntrinsicMethods(
  dictName: string,
  program?: ts.Program
): DictMethodMap | undefined {
  return instanceRegistryFor(program).get(dictName) ?? primitiveIntrinsicRegistry.get(dictName);
}

/**
 * Look up instance methods from the primitive intrinsic registry only —
 * i.e. NOT the per-file `@impl`-derived registry. Callers that inline by
 * bare identifier name (`eqNumber.eq(a, b)`) need to distinguish this
 * source: a well-known intrinsic name like `eqNumber` has no corresponding
 * user declaration in a correct program (it's a synthetic reference the
 * transformer itself injects), so a caller can safely treat any resolvable
 * user declaration for that identifier as shadowing — see
 * `tryInlineDerivedInstanceCall` in transformer-core/specialization.ts.
 */
export function getPrimitiveIntrinsicMethods(dictName: string): DictMethodMap | undefined {
  return primitiveIntrinsicRegistry.get(dictName);
}

// ============================================================================
// Built-in instance registrations — REMOVED (PEP-053 Wave 4)
// ============================================================================
//
// The ~28 static registerInstanceMethods(...) builtins (source-code-as-strings
// copies of the fp/std/effect instances) are gone. Instance method bodies now
// come exclusively from source extraction (instance-extraction.ts): same rules
// for std/fp/effect as for user instances — no builtin magic. Instances whose
// bodies reference their module's local helpers or imports fall back to
// dictionary passing at cross-module call sites (always correct).

// ============================================================================
// Primitive Typeclass Intrinsics — inline to native operators (PEP-052 Wave 7)
// ============================================================================
//
// eqNumber.equals(a, b) → a === b, ordNumber.compare(a, b) → a < b ? -1 : …,
// etc. These used to be hand-written source strings restating primitives.ts's
// real instances — an independently-maintained copy that had drifted for 6 of
// 16 entries (e.g. showString's escaping, ordString's locale-dependence — both
// fixed in primitives.ts directly rather than perpetuated here).
//
// Rather than hand-typing them a second time OR re-reading primitives.ts's
// source text from disk (tried and reverted — this package's specialize.ts
// gets bundled into @typesugar/playground's browser-target IIFE build via
// runtime-entry.ts, where Node's fs/path/url modules don't exist; a
// filesystem read here broke that build), this imports the REAL, live
// primitives.ts values — an ordinary import, works in any environment — and
// reflects each method's own source text via `Function.prototype.toString()`,
// which is standard JS, not a Node API. That text is parsed into a real AST
// node (DictMethod.node), so the registry still holds the same shape
// extractMethodsFromObjectLiteral produces for real user/std/fp/effect
// instances (instance-extraction.ts) — just derived from a live value's
// reflection instead of a call site's Program/TypeChecker.
//
// Single source of truth, automatically: since these are the actual
// primitives.ts functions (not a copy), there is nothing left to drift.
//
// Safe-by-construction, with an explicit guard for the one way this can go
// wrong: a primitive's real body may call ANOTHER primitives.ts export as a
// module-scope helper (e.g. hashNumber/hashBigint both fall back to
// hashString.hash for non-trivial inputs) — a reference that's correctly
// bound when the function actually RUNS (closed over its own module), but
// would be an unbound free identifier if its text were inlined verbatim at
// a user's call site. `hasOnlySafeFreeIdentifiers` below rejects any body
// referencing anything other than its own parameters or a small allowlist
// of real JS globals, so such methods are simply never registered — the
// call falls through to an ordinary (correct) function call instead of
// generating a ReferenceError. Every other skip path (parse failure, parse
// errors, non-arrow node, non-identifier params) degrades the same way:
// only the inlining optimization is lost, never correctness.
//
// A second, distinct environment hazard: @typesugar/playground's
// runtime-entry.ts (the sandboxed-iframe bundle used to EVALUATE already-
// transformed code, separate from browser.ts which TRANSFORMS it) stubs
// `typescript` out entirely via an esbuild plugin — that stub doesn't even
// export `createSourceFile`, so calling it there throws immediately at this
// module's top-level load. `loadPrimitiveIntrinsicsFromReflection`'s
// top-level try/catch exists for exactly this: an environment where parsing
// isn't available at all degrades to "no intrinsics registered," not a
// crash that takes down every other export this package provides.

const PRIMITIVE_INTRINSIC_NAME = /^(eq|ord|show|hash)(Number|String|Boolean|Bigint)$/;

const SAFE_GLOBALS = new Set([
  "JSON",
  "String",
  "Number",
  "Math",
  "Array",
  "Boolean",
  "Object",
  "RegExp",
  "isNaN",
  "isFinite",
  "parseInt",
  "parseFloat",
  "undefined",
  "NaN",
  "Infinity",
]);

/**
 * Names bound ANYWHERE within the body — `let`/`const`/`var` declarations,
 * catch clause bindings, nested function parameters. Not full lexical-scope
 * analysis (no shadowing/TDZ precision) — deliberately coarse, since this
 * only ever runs over the 16 small, non-nested, self-contained primitives in
 * primitives.ts, not arbitrary user code. Good enough to distinguish a
 * method's own locals (e.g. hashString's `let hash`/`for (let i …)`) from a
 * genuine free reference to something outside it.
 */
function collectLocallyDeclaredNames(body: ts.Node, names: Set<string>): void {
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      names.add(node.name.text);
    } else if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
      names.add(node.name.text);
    } else if (
      ts.isCatchClause(node) &&
      node.variableDeclaration &&
      ts.isIdentifier(node.variableDeclaration.name)
    ) {
      names.add(node.variableDeclaration.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
}

function hasOnlySafeFreeIdentifiers(body: ts.Node, paramNames: ReadonlySet<string>): boolean {
  const boundNames = new Set(paramNames);
  collectLocallyDeclaredNames(body, boundNames);

  let safe = true;
  const visit = (node: ts.Node): void => {
    if (!safe) return;
    if (ts.isPropertyAccessExpression(node)) {
      visit(node.expression); // `.name` is a member, not a free reference
      return;
    }
    if (ts.isIdentifier(node)) {
      if (!boundNames.has(node.text) && !SAFE_GLOBALS.has(node.text)) safe = false;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return safe;
}

function parseAsStandaloneExpression(text: string): ts.Expression | undefined {
  // Arrow functions parse fine as a bare ExpressionStatement, so the paren
  // wrap isn't load-bearing for them — but a `function` expression or
  // method-shorthand form at statement-start position is NOT unambiguous
  // (`function`/an identifier there starts a declaration), so wrapping is
  // kept as cheap defense-in-depth for any reflected text that isn't an
  // arrow (the `ts.isArrowFunction` check below rejects those anyway).
  const sourceFile = ts.createSourceFile("intrinsic.ts", `(${text})`, ts.ScriptTarget.Latest, true);
  const diagnostics = (sourceFile as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics;
  if (diagnostics && diagnostics.length > 0) return undefined;
  const [stmt] = sourceFile.statements;
  if (!stmt || !ts.isExpressionStatement(stmt)) return undefined;
  const expr = stmt.expression;
  return ts.isParenthesizedExpression(expr) ? expr.expression : expr;
}

function loadPrimitiveIntrinsicsFromReflection(): void {
  // `ts.createSourceFile` isn't available everywhere this package's compiled
  // output loads: @typesugar/playground's runtime-entry.ts (the sandboxed
  // iframe bundle used to EVALUATE already-transformed code, as opposed to
  // the separate browser.ts bundle that TRANSFORMS it) stubs `typescript`
  // out entirely via an esbuild plugin, since that sandbox never needs real
  // macro expansion — its stub doesn't even export `createSourceFile`, so
  // calling it throws immediately. A single top-level try/catch around the
  // whole load — rather than the environment failing the same way on every
  // one of the 16×N iterations — is enough: if parsing isn't available at
  // all, nothing gets registered, calls fall through to real (correct)
  // function calls, and every OTHER export from this module still loads
  // normally instead of the whole package failing to import.
  try {
    for (const [dictName, dict] of Object.entries(primitives)) {
      const match = dictName.match(PRIMITIVE_INTRINSIC_NAME);
      if (!match || typeof dict !== "object" || dict === null) continue;

      const methods = new Map<string, DictMethod>();
      for (const [methodName, fn] of Object.entries(dict)) {
        if (typeof fn !== "function") continue;
        const node = parseAsStandaloneExpression(fn.toString());
        if (!node || !ts.isArrowFunction(node)) continue;
        // Reject destructuring params outright rather than fabricating a
        // placeholder name that could never be substituted. NOTE: this only
        // checks `p.name` is a plain identifier — it does NOT reject rest
        // params or defaulted params (both still have an identifier name),
        // and a defaulted param's initializer expression is never scanned by
        // hasOnlySafeFreeIdentifiers (only node.body is). None of the 16 real
        // primitives use rest/default params today, so this is a latent gap
        // for a hypothetical future primitives.ts rewrite, not a live one.
        if (!node.parameters.every((p) => ts.isIdentifier(p.name))) continue;
        const params = node.parameters.map((p) => (p.name as ts.Identifier).text);
        if (!hasOnlySafeFreeIdentifiers(node.body, new Set(params))) continue;

        methods.set(methodName, { node: stripPositions(node), params });
      }

      if (methods.size > 0) {
        primitiveIntrinsicRegistry.set(dictName, { brand: match[2].toLowerCase(), methods });
      }
    }
  } catch {
    // See comment above: an environment without a working `typescript`
    // parser degrades to "no intrinsic inlining," not a load-time crash.
  }
}

loadPrimitiveIntrinsicsFromReflection();

/**
 * Inline a dictionary method call with its concrete implementation.
 *
 * For a method like `(fa, f) => fa.map(f)` called with args `[myArr, myFn]`,
 * produces `myArr.map(myFn)`.
 */
export function inlineMethod(
  ctx: MacroContext,
  method: DictMethod,
  callArgs: ts.Expression[]
): ts.Expression | undefined {
  if (!method.node) return undefined;
  return inlineFromNode(ctx, method.node, method.params, callArgs);
}

/**
 * Inline a method from its AST node representation.
 */
function inlineFromNode(
  ctx: MacroContext,
  methodNode: ts.Expression | ts.Node,
  paramNames: string[],
  callArgs: ts.Expression[]
): ts.Expression | undefined {
  let body: ts.Node | undefined;
  let params: readonly ts.ParameterDeclaration[] | undefined;

  if (ts.isArrowFunction(methodNode)) {
    body = methodNode.body;
    params = methodNode.parameters;
  } else if (ts.isFunctionExpression(methodNode)) {
    body = methodNode.body;
    params = methodNode.parameters;
  } else if (ts.isMethodDeclaration(methodNode)) {
    body = methodNode.body;
    params = methodNode.parameters;
  } else if (ts.isFunctionDeclaration(methodNode)) {
    // Indirect members can reference top-level functions (`map: mapOption`
    // where mapOption is a function declaration) — PEP-053 Wave 2 gap 4.
    body = methodNode.body;
    params = methodNode.parameters;
  } else {
    return undefined;
  }

  if (!body) return undefined;

  // Build substitution map: param name → call argument
  // Use paramNames from DictMethod (more reliable than extracting from potentially synthetic nodes)
  const substitutions = new Map<string, ts.Expression>();
  for (let i = 0; i < paramNames.length && i < callArgs.length; i++) {
    substitutions.set(paramNames[i], callArgs[i]);
  }

  // Also try to extract param names from the AST node itself as fallback
  if (params) {
    for (let i = 0; i < params.length && i < callArgs.length; i++) {
      const param = params[i];
      if (ts.isIdentifier(param.name)) {
        const paramName = param.name.text;
        if (!substitutions.has(paramName)) {
          substitutions.set(paramName, callArgs[i]);
        }
      }
    }
  }

  // For block bodies, handle inlining
  if (ts.isBlock(body)) {
    // First, substitute parameters in the entire block
    const substitutedBody = substituteParams(ctx, body, substitutions);
    if (!ts.isBlock(substitutedBody)) {
      return undefined;
    }
    const substitutedBlock = substitutedBody as ts.Block;

    // Check if the block has a single return statement
    const statements = substitutedBlock.statements;
    const firstStmt = statements[0];
    if (statements.length === 1 && ts.isReturnStatement(firstStmt) && firstStmt.expression) {
      return firstStmt.expression;
    }

    // Check for simple single-return pattern (may have bindings before)
    const classification = classifyInlineFailureDetailed(substitutedBlock);

    if (classification.reason === null) {
      // Single return at end - extract it
      for (let i = statements.length - 1; i >= 0; i--) {
        const stmt = statements[i];
        if (ts.isReturnStatement(stmt) && stmt.expression) {
          // If there are bindings, wrap in IIFE
          if (i > 0) {
            const blockStmts: ts.Statement[] = [...statements.slice(0, i), stmt];
            const block = ctx.factory.createBlock(blockStmts, true);
            const arrowFn = ctx.factory.createArrowFunction(
              undefined,
              undefined,
              [],
              undefined,
              ctx.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
              block
            );
            return ctx.factory.createCallExpression(
              ctx.factory.createParenthesizedExpression(arrowFn),
              undefined,
              []
            );
          }
          return stmt.expression;
        }
      }
    }

    // Check if we can flatten early returns to a ternary expression
    if (classification.canFlatten) {
      const flattened = flattenReturnsToExpression(ctx, substitutedBlock);
      if (flattened) {
        return flattened;
      }
    }

    // Can't inline block body
    return undefined;
  }

  // Substitute parameters in the expression body
  return substituteParams(ctx, body, substitutions);
}

/**
 * Substitute parameter references with concrete argument expressions.
 *
 * Replacements are stripped of source positions to prevent TypeScript's
 * printer from attaching comments from the original source file into the
 * inlined output (the replacement nodes come from the call site and carry
 * real positions; mixing them with synthetic template nodes causes the
 * printer to emit stray comments at those positions).
 */
function substituteParams(
  ctx: MacroContext,
  node: ts.Node,
  substitutions: Map<string, ts.Expression>
): ts.Expression {
  // Strip comments from the template body to prevent the printer from emitting
  // stray comments (e.g. JSDoc from the typeclass definition) into inlined code.
  const cleanNode = stripCommentsDeep(node);

  const stripped = new Map<string, ts.Expression>();
  for (const [key, value] of substitutions) {
    stripped.set(key, stripPositions(value));
  }

  function visit(n: ts.Node): ts.Node {
    if (ts.isIdentifier(n)) {
      const replacement = stripped.get(n.text);
      if (replacement) {
        return replacement;
      }
    }
    return ts.visitEachChild(n, visit, ctx.transformContext);
  }

  const result = ts.visitNode(cleanNode, visit);
  return result as ts.Expression;
}

// ============================================================================
// Inline Failure Classification
// ============================================================================

/**
 * Reasons why a function body cannot be inlined.
 * Used for diagnostic messages.
 */
export type InlineFailureReason =
  | "early return"
  | "early return (flattenable)"
  | "try/catch"
  | "loop"
  | "mutable variable"
  | "throw statement"
  | "no return statement"
  | "expression statement"
  | null;

/**
 * Detailed result of inline failure classification.
 * Includes whether the body can be flattened when early returns are present.
 */
export interface InlineClassification {
  /** The failure reason, or null if inlineable */
  reason: InlineFailureReason;
  /** Whether the body can be flattened to an expression (for early returns) */
  canFlatten: boolean;
}

/**
 * Classify why a block body cannot be inlined, with detailed information
 * about flattenability for early returns.
 *
 * @returns InlineClassification with the failure reason and whether flattening is possible
 */
export function classifyInlineFailureDetailed(body: ts.Block): InlineClassification {
  const statements = body.statements;

  if (statements.length === 0) {
    return { reason: "no return statement", canFlatten: false };
  }

  // Count return statements (including nested ones)
  let returnCount = 0;
  let lastReturnIndex = -1;

  // Helper to count returns in nested blocks
  const countReturnsInStatement = (stmt: ts.Statement): number => {
    let count = 0;
    if (ts.isReturnStatement(stmt)) {
      count++;
    } else if (ts.isIfStatement(stmt)) {
      count += countReturnsInBlock(stmt.thenStatement);
      if (stmt.elseStatement) {
        count += countReturnsInBlock(stmt.elseStatement);
      }
    } else if (ts.isBlock(stmt)) {
      for (const s of stmt.statements) {
        count += countReturnsInStatement(s);
      }
    }
    return count;
  };

  const countReturnsInBlock = (block: ts.Statement): number => {
    if (ts.isBlock(block)) {
      let count = 0;
      for (const stmt of block.statements) {
        count += countReturnsInStatement(stmt);
      }
      return count;
    } else {
      return countReturnsInStatement(block);
    }
  };

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];

    // Check for try/catch/finally
    if (ts.isTryStatement(stmt)) {
      return { reason: "try/catch", canFlatten: false };
    }

    // Check for loops
    if (
      ts.isForStatement(stmt) ||
      ts.isWhileStatement(stmt) ||
      ts.isDoStatement(stmt) ||
      ts.isForOfStatement(stmt) ||
      ts.isForInStatement(stmt)
    ) {
      return { reason: "loop", canFlatten: false };
    }

    // Check for throw statements
    if (ts.isThrowStatement(stmt)) {
      return { reason: "throw statement", canFlatten: false };
    }

    // Check for mutable variable declarations (let)
    if (ts.isVariableStatement(stmt)) {
      const declList = stmt.declarationList;
      if (!(declList.flags & ts.NodeFlags.Const)) {
        return { reason: "mutable variable", canFlatten: false };
      }
    }

    // Track return statements (including nested)
    const returnsInStmt = countReturnsInStatement(stmt);
    if (returnsInStmt > 0) {
      returnCount += returnsInStmt;
      lastReturnIndex = i;
    }

    // Check for try-catch/loops nested in if statements
    if (ts.isIfStatement(stmt)) {
      const nestedReason = checkNestedStatements(stmt);
      if (nestedReason) {
        return { reason: nestedReason, canFlatten: false };
      }
    }
  }

  // No return statement found
  if (returnCount === 0) {
    return { reason: "no return statement", canFlatten: false };
  }

  // Multiple returns or return not at the end = early return
  if (returnCount > 1 || lastReturnIndex !== statements.length - 1) {
    // Check if the early returns can be flattened to a ternary expression
    const analysis = analyzeForFlattening(body);
    if (analysis.canFlatten) {
      return { reason: "early return (flattenable)", canFlatten: true };
    }
    return { reason: "early return", canFlatten: false };
  }

  // Single return at the end — inlineable
  return { reason: null, canFlatten: false };
}

/**
 * Classify why a block body cannot be inlined.
 *
 * Returns a human-readable reason string if the body contains patterns
 * that prevent inlining, or `null` if the body is simple enough to inline
 * (single return statement at the end).
 *
 * Note: For early returns, consider using `classifyInlineFailureDetailed()` which
 * also indicates whether the body can be flattened to an expression.
 *
 * Checks for:
 * - Multiple return statements or early returns (return not as last statement)
 * - try/catch/finally blocks
 * - Loop statements (for, while, do..while, for..of, for..in)
 * - Mutable variable declarations (let without const)
 * - Throw statements
 */
export function classifyInlineFailure(body: ts.Block): InlineFailureReason {
  return classifyInlineFailureDetailed(body).reason;
}

/**
 * Recursively check nested statements (in if/else) for non-inlineable patterns.
 * Note: This does NOT check for returns - that's handled by the main function.
 */
function checkNestedStatements(node: ts.IfStatement): InlineFailureReason {
  const checkBlock = (block: ts.Statement): InlineFailureReason => {
    if (ts.isBlock(block)) {
      for (const stmt of block.statements) {
        if (ts.isTryStatement(stmt)) return "try/catch";
        if (
          ts.isForStatement(stmt) ||
          ts.isWhileStatement(stmt) ||
          ts.isDoStatement(stmt) ||
          ts.isForOfStatement(stmt) ||
          ts.isForInStatement(stmt)
        ) {
          return "loop";
        }
        if (ts.isThrowStatement(stmt)) return "throw statement";
        if (ts.isVariableStatement(stmt)) {
          const declList = stmt.declarationList;
          if (!(declList.flags & ts.NodeFlags.Const)) {
            return "mutable variable";
          }
        }
        if (ts.isIfStatement(stmt)) {
          const nested = checkNestedStatements(stmt);
          if (nested) return nested;
        }
      }
    } else {
      // Single statement (not a block)
      if (ts.isTryStatement(block)) return "try/catch";
      if (
        ts.isForStatement(block) ||
        ts.isWhileStatement(block) ||
        ts.isDoStatement(block) ||
        ts.isForOfStatement(block) ||
        ts.isForInStatement(block)
      ) {
        return "loop";
      }
      if (ts.isThrowStatement(block)) return "throw statement";
      if (ts.isIfStatement(block)) {
        return checkNestedStatements(block);
      }
    }
    return null;
  };

  const thenResult = checkBlock(node.thenStatement);
  if (thenResult) return thenResult;

  if (node.elseStatement) {
    return checkBlock(node.elseStatement);
  }

  return null;
}

/**
 * Get help text for a given inline failure reason.
 */
export function getInlineFailureHelp(reason: InlineFailureReason): string {
  switch (reason) {
    case "early return":
      return "Extract early-return logic into a helper; use single-expression body";
    case "early return (flattenable)":
      return "Body can be flattened to a ternary expression automatically";
    case "try/catch":
      return "Move error handling outside the specialized function";
    case "loop":
      return "Use Array methods or a recursive helper instead of loops";
    case "mutable variable":
      return "Use const bindings or fold/reduce pattern";
    case "throw statement":
      return "Use Result type instead of throwing, or move throws outside";
    case "no return statement":
      return "Add a return statement or use an expression body";
    case "expression statement":
      return "Move side effects outside the inlined function or use IIFE";
    default:
      return "";
  }
}

// ============================================================================
// Early-Return Flattening
// ============================================================================

/**
 * Result of analyzing whether a block can be flattened to an expression.
 */
export interface FlattenAnalysis {
  /** Whether the block can be flattened */
  canFlatten: boolean;
  /** Reason if cannot flatten */
  reason?: InlineFailureReason;
  /** Collected const bindings that must be preserved */
  bindings: ts.VariableStatement[];
  /** The flattened expression (if canFlatten is true) */
  expression?: ts.Expression;
}

/**
 * Analyze whether a block body consists of flattenable patterns:
 * - const bindings
 * - if (cond) return expr; guards
 * - if (cond) return expr; else return expr2; branches
 * - terminal return expr;
 *
 * Returns analysis result indicating whether flattening is possible.
 */
export function analyzeForFlattening(body: ts.Block): FlattenAnalysis {
  const statements = body.statements;

  if (statements.length === 0) {
    return { canFlatten: false, reason: "no return statement", bindings: [] };
  }

  // Check for blocking patterns first
  for (const stmt of statements) {
    if (ts.isTryStatement(stmt)) {
      return { canFlatten: false, reason: "try/catch", bindings: [] };
    }
    if (
      ts.isForStatement(stmt) ||
      ts.isWhileStatement(stmt) ||
      ts.isDoStatement(stmt) ||
      ts.isForOfStatement(stmt) ||
      ts.isForInStatement(stmt)
    ) {
      return { canFlatten: false, reason: "loop", bindings: [] };
    }
    if (ts.isThrowStatement(stmt)) {
      return { canFlatten: false, reason: "throw statement", bindings: [] };
    }
    if (ts.isVariableStatement(stmt)) {
      const declList = stmt.declarationList;
      if (!(declList.flags & ts.NodeFlags.Const)) {
        return { canFlatten: false, reason: "mutable variable", bindings: [] };
      }
    }
    if (ts.isExpressionStatement(stmt)) {
      // Early-return flattening currently doesn't preserve ExpressionStatements
      // (like console.log or side effects) in the generated ternary/IIFE.
      return { canFlatten: false, reason: "expression statement", bindings: [] };
    }
    // Check nested if statements for blocking patterns
    if (ts.isIfStatement(stmt)) {
      const nestedReason = checkNestedForFlattening(stmt);
      if (nestedReason) {
        return { canFlatten: false, reason: nestedReason, bindings: [] };
      }
    }
  }

  // All patterns are flattenable - collect bindings
  const bindings: ts.VariableStatement[] = [];
  for (const stmt of statements) {
    if (ts.isVariableStatement(stmt)) {
      bindings.push(stmt);
    }
  }

  return { canFlatten: true, bindings };
}

/**
 * Check nested if/else for blocking patterns (loops, try/catch, etc.)
 */
function checkNestedForFlattening(node: ts.IfStatement): InlineFailureReason {
  const check = (block: ts.Statement): InlineFailureReason => {
    if (ts.isBlock(block)) {
      for (const stmt of block.statements) {
        if (ts.isTryStatement(stmt)) return "try/catch";
        if (
          ts.isForStatement(stmt) ||
          ts.isWhileStatement(stmt) ||
          ts.isDoStatement(stmt) ||
          ts.isForOfStatement(stmt) ||
          ts.isForInStatement(stmt)
        ) {
          return "loop";
        }
        if (ts.isThrowStatement(stmt)) return "throw statement";
        if (ts.isVariableStatement(stmt)) {
          if (!(stmt.declarationList.flags & ts.NodeFlags.Const)) {
            return "mutable variable";
          }
        }
        if (ts.isIfStatement(stmt)) {
          const nested = checkNestedForFlattening(stmt);
          if (nested) return nested;
        }
      }
    } else {
      if (ts.isTryStatement(block)) return "try/catch";
      if (
        ts.isForStatement(block) ||
        ts.isWhileStatement(block) ||
        ts.isDoStatement(block) ||
        ts.isForOfStatement(block) ||
        ts.isForInStatement(block)
      ) {
        return "loop";
      }
      if (ts.isThrowStatement(block)) return "throw statement";
      if (ts.isIfStatement(block)) {
        return checkNestedForFlattening(block);
      }
    }
    return null;
  };

  const thenResult = check(node.thenStatement);
  if (thenResult) return thenResult;

  if (node.elseStatement) {
    return check(node.elseStatement);
  }

  return null;
}

/**
 * Flatten a block body with early returns into a single expression.
 *
 * Transforms:
 * ```
 * {
 *   const n = Number(input);
 *   if (isNaN(n)) return err("not a number");
 *   if (n < 0 || n > 150) return err("out of range");
 *   return ok(n);
 * }
 * ```
 *
 * Into:
 * ```
 * (() => {
 *   const n = Number(input);
 *   return isNaN(n) ? err("not a number")
 *        : n < 0 || n > 150 ? err("out of range")
 *        : ok(n);
 * })()
 * ```
 *
 * Or if no bindings are needed:
 * ```
 * isNaN(n) ? err("not a number") : n < 0 || n > 150 ? err("out of range") : ok(n)
 * ```
 *
 * @param ctx - The macro context for AST factory access
 * @param body - The block to flatten
 * @returns The flattened expression, or undefined if flattening fails
 */
export function flattenReturnsToExpression(
  ctx: MacroContext,
  body: ts.Block
): ts.Expression | undefined {
  const analysis = analyzeForFlattening(body);
  if (!analysis.canFlatten) {
    return undefined;
  }

  // Extract statements, separating bindings from control flow
  const bindings: ts.VariableStatement[] = [];
  const controlFlow: ts.Statement[] = [];

  for (const stmt of body.statements) {
    if (ts.isVariableStatement(stmt)) {
      bindings.push(stmt);
    } else {
      controlFlow.push(stmt);
    }
  }

  // Flatten the control flow into a ternary expression
  const ternary = flattenStatements(ctx, controlFlow);
  if (!ternary) {
    return undefined;
  }

  // If no bindings, return the bare ternary
  if (bindings.length === 0) {
    return ternary;
  }

  // Wrap in a block with return for the IIFE
  const blockStatements: ts.Statement[] = [...bindings, ctx.factory.createReturnStatement(ternary)];

  const block = ctx.factory.createBlock(blockStatements, true);

  // Create IIFE: (() => { bindings; return ternary; })()
  const arrowFn = ctx.factory.createArrowFunction(
    undefined,
    undefined,
    [],
    undefined,
    ctx.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    block
  );

  return ctx.factory.createCallExpression(
    ctx.factory.createParenthesizedExpression(arrowFn),
    undefined,
    []
  );
}

/**
 * Flatten a sequence of control flow statements into a nested ternary expression.
 *
 * Handles:
 * - if (cond) return expr;  → guard clause
 * - if (cond) return expr; else return expr2;  → full branch
 * - if (cond) { ...stmts; return expr; } else { ... }  → nested flattening
 * - return expr;  → terminal expression
 */
function flattenStatements(
  ctx: MacroContext,
  statements: ts.Statement[]
): ts.Expression | undefined {
  if (statements.length === 0) {
    return undefined;
  }

  // Process statements in reverse order to build nested ternaries from the bottom up
  let result: ts.Expression | undefined;

  for (let i = statements.length - 1; i >= 0; i--) {
    const stmt = statements[i];

    if (ts.isReturnStatement(stmt)) {
      // Terminal return statement
      if (stmt.expression) {
        if (result === undefined) {
          result = stmt.expression;
        } else {
          // This shouldn't happen in well-formed code (unreachable after return)
          return undefined;
        }
      } else {
        // return; without expression - use undefined
        if (result === undefined) {
          result = ctx.factory.createIdentifier("undefined");
        } else {
          return undefined;
        }
      }
    } else if (ts.isIfStatement(stmt)) {
      const flattened = flattenIfStatement(ctx, stmt, result);
      if (!flattened) {
        return undefined;
      }
      result = flattened;
    } else if (ts.isExpressionStatement(stmt)) {
      // Skip expression statements (side effects before control flow)
      // They'll be handled by the IIFE wrapper if needed
      continue;
    } else {
      // Unsupported statement type
      return undefined;
    }
  }

  return result;
}

/**
 * Flatten an if statement into a ternary expression.
 *
 * @param ctx - Macro context
 * @param ifStmt - The if statement to flatten
 * @param continuation - The expression to use if neither branch is taken (for guards without else)
 */
function flattenIfStatement(
  ctx: MacroContext,
  ifStmt: ts.IfStatement,
  continuation: ts.Expression | undefined
): ts.Expression | undefined {
  const condition = ifStmt.expression;

  // Get the "then" expression
  const thenExpr = flattenBranch(ctx, ifStmt.thenStatement);
  if (!thenExpr) {
    return undefined;
  }

  // Get the "else" expression
  let elseExpr: ts.Expression | undefined;

  if (ifStmt.elseStatement) {
    if (ts.isIfStatement(ifStmt.elseStatement)) {
      // else if - recurse
      elseExpr = flattenIfStatement(ctx, ifStmt.elseStatement, continuation);
    } else {
      // else block
      elseExpr = flattenBranch(ctx, ifStmt.elseStatement);
    }
  } else {
    // No else - use continuation (the rest of the function)
    elseExpr = continuation;
  }

  if (!elseExpr) {
    return undefined;
  }

  // Create: condition ? thenExpr : elseExpr
  return ctx.factory.createConditionalExpression(
    condition,
    ctx.factory.createToken(ts.SyntaxKind.QuestionToken),
    thenExpr,
    ctx.factory.createToken(ts.SyntaxKind.ColonToken),
    elseExpr
  );
}

/**
 * Flatten a branch (then/else block) to an expression.
 */
function flattenBranch(ctx: MacroContext, branch: ts.Statement): ts.Expression | undefined {
  // Single return statement
  if (ts.isReturnStatement(branch)) {
    return branch.expression ?? ctx.factory.createIdentifier("undefined");
  }

  // Block with statements
  if (ts.isBlock(branch)) {
    // Collect bindings and find the return
    const bindings: ts.VariableStatement[] = [];
    const controlFlow: ts.Statement[] = [];

    for (const stmt of branch.statements) {
      if (ts.isVariableStatement(stmt)) {
        bindings.push(stmt);
      } else {
        controlFlow.push(stmt);
      }
    }

    // Flatten control flow
    const flattened = flattenStatements(ctx, controlFlow);
    if (!flattened) {
      return undefined;
    }

    // If no bindings, return bare expression
    if (bindings.length === 0) {
      return flattened;
    }

    // Wrap in IIFE with bindings
    const blockStatements: ts.Statement[] = [
      ...bindings,
      ctx.factory.createReturnStatement(flattened),
    ];

    const block = ctx.factory.createBlock(blockStatements, true);
    const arrowFn = ctx.factory.createArrowFunction(
      undefined,
      undefined,
      [],
      undefined,
      ctx.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      block
    );

    return ctx.factory.createCallExpression(
      ctx.factory.createParenthesizedExpression(arrowFn),
      undefined,
      []
    );
  }

  // Single if statement as branch
  if (ts.isIfStatement(branch)) {
    return flattenIfStatement(ctx, branch, undefined);
  }

  return undefined;
}

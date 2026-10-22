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
import {
  stripPositions,
  stripCommentsDeep,
  getOrCreateWeak,
  cloneNodeDeep,
  isSyntheticNode,
} from "@typesugar/core";
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
 * Key format: `fnSymbolId×dict1,dict2,...` where each entry identifies the
 * dictionary passed at that position — the resolved instance declaration, not
 * merely its type brand (two `Show<Point>` instances must not share a
 * specialization), in argument order (`pair(a, b)` ≠ `pair(b, a)`). Keying by
 * the function's symbol handles aliased imports (different local names, same
 * function). (deep review 1.0, tc#9)
 */
/**
 * Replace every character that cannot appear in an identifier with `_`.
 * A dictionary's brand can be a type's printed text (`Functor<any[]>` gives
 * the brand "any[]"), which used to leak into the hoisted name and make the
 * output unparseable (`const __double_any[]_0__ = ...`).
 */
function toIdentifierText(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    out += ts.isIdentifierPart(code, ts.ScriptTarget.ESNext) ? ch : "_";
  }
  return out;
}

export class SpecializationCache {
  private cache = new Map<string, SpecCacheEntry>();
  private hoistedDeclarations: ts.VariableStatement[] = [];

  /**
   * Compute a cache key for a specialization.
   *
   * @param fnSymbolId - The TypeScript symbol ID of the function (or function name as fallback)
   * @param dictIdentities - One identity per dictionary argument, in argument
   *   order (position-qualified instance identities; order is significant)
   * @returns Cache key string
   */
  static computeKey(fnSymbolId: string | number, dictIdentities: string[]): string {
    return `${fnSymbolId}×${dictIdentities.join(",")}`;
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
    return hygiene.createIdentifier(toIdentifierText(baseName));
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

// Built-in Result algebras (Option, Either, Promise) are registered by
// their owning packages' own `./macros` entries, not seeded here — PEP-055
// Phase D relocation. `optionResultAlgebra`/`eitherResultAlgebra` live in
// `@typesugar/fp/macros` (`packages/fp/src/macros.ts`); `promiseResultAlgebra`
// lives in `@typesugar/std/macros` (`packages/std/src/macros/index.ts`).
// `registerResultAlgebra` remains the extension point for third-party
// result types — this file no longer calls it itself.

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
  /**
   * For methods extracted from source with a TypeChecker: each identifier the
   * body references outside itself, mapped to the symbol it resolves to where
   * the method is defined. Call sites must resolve every name to the SAME
   * symbol before inlining (a call-site local named like a module-level helper
   * would otherwise capture it — deep review 1.0, tc#18).
   */
  freeSymbols?: ReadonlyMap<string, ts.Symbol>;
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
 * Declaration-keyed view of the same registrations: two unrelated instances
 * that share a name (different files) are distinct here, unlike the
 * name-keyed map above, where the last registration wins. Keyed by the
 * ORIGINAL declaration node (`ts.getOriginalNode`), so a visited/updated copy
 * of a declaration finds the same entry. No per-Program partitioning is
 * needed: a fresh Program has fresh nodes, and the WeakMap lets old ones go.
 *
 * Shape (CLAUDE.md "Resolving things a macro just generated"): a LIVE keyed
 * registry written by `@impl` / `impl()` during the transform pass and read
 * within the same pass — not a scan of a pass-start snapshot. The usual
 * declare-before-use constraint of a single top-down pass applies.
 */
const instanceMethodsByDeclaration = new WeakMap<ts.Node, DictMethodMap>();

/**
 * Register a typeclass instance's methods for specialization using AST nodes.
 * This is the preferred registration method as it avoids source string parsing.
 *
 * Called by @instance macros when processing declarations at compile time.
 * Pass `declaration` (the instance's `VariableDeclaration`) whenever it is
 * known, so {@link getInstanceMethodsForDeclaration} can find the entry by
 * declaration identity rather than by bare name.
 */
export function registerInstanceMethodsFromAST(
  dictName: string,
  brand: string,
  methods: Map<string, DictMethod>,
  program?: ts.Program,
  declaration?: ts.Node
): void {
  const entry: DictMethodMap = { brand, methods };
  instanceRegistryFor(program).set(dictName, entry);
  if (declaration) instanceMethodsByDeclaration.set(ts.getOriginalNode(declaration), entry);
}

/**
 * The methods registered for exactly this instance declaration (see
 * {@link registerInstanceMethodsFromAST}'s `declaration` parameter), or
 * undefined if it was registered by name only / not at all.
 */
export function getInstanceMethodsForDeclaration(declaration: ts.Node): DictMethodMap | undefined {
  return instanceMethodsByDeclaration.get(ts.getOriginalNode(declaration));
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
 *
 * NAME-KEYED: two unrelated declarations with the same name in different
 * files share one entry. Callers must not use this for an identifier that
 * resolves (via the checker) to a declaration — resolve that declaration and
 * extract from source instead (deep review 1.0, tc#8 / core#4). It remains
 * the lookup for references the checker cannot resolve at all.
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

// ============================================================================
// Safe method inlining
// ============================================================================
//
// Inlining `inst.method(a1, a2)` replaces a call with the method's body, with
// each parameter reference replaced by its argument. That is only a pure
// optimization when it cannot change behaviour (deep review 1.0, tc#1-#4).
//
// `inlineMethod` DECLINES (returns undefined — the caller keeps the ordinary
// call) when the body depends on its receiver or activation: `this`, `super`,
// `arguments` or `new.target` outside a nested non-arrow function, its own
// `await`/`yield`, or an async/generator method.
//
// Otherwise it substitutes arguments directly into the body when ALL of the
// following hold, and else falls back to applying the method as an IIFE,
// `((a, b) => body)(arg1, arg2)` — arguments evaluated once, in order, into
// the body's own scope, i.e. exactly the call's semantics minus the
// dictionary lookup:
//
// - The parameters are plain identifiers with no default or rest, and the
//   call passes exactly one non-spread argument per parameter.
// - No binding declared anywhere in the body (locals, nested parameters,
//   catch variables) has the name of a parameter (substitution would reach
//   the shadowed inner references) or of any identifier used in an argument
//   (the inlined argument would be captured by the body's local).
// - No parameter is assigned to or updated in the body.
// - Arguments keep their evaluation semantics:
//     * literals: unrestricted;
//     * arrow/function expressions: referenced at most once (no duplication);
//     * identifiers, `this`, property-access chains on those ("stable"):
//       any number of references, but a reference inside a nested function
//       (evaluated later, not at call time) is only allowed for an identifier
//       bound to a const/function/class/enum/import declaration;
//     * anything else ("effectful", e.g. calls): referenced exactly once,
//       not inside a nested function or a conditionally-evaluated position
//       (`&&`/`||`/`??` right side, `?:` branches, optional chains, code after
//       an `if`), with no call/assignment/update/delete/await/yield evaluated
//       in the body before it, effectful arguments referenced in argument
//       order, and every stable argument to its left read before it and every
//       stable argument to its right read after it.
//
// Substitution replaces only identifier REFERENCES — never property names,
// object-literal keys, method names, binding-pattern property names or
// labels — and expands a shorthand property `{ a }` to `{ a: <arg> }`.
// Arguments that are not primary expressions are parenthesized.
//
// Known residuals (documented, not checked): a getter or a callee that
// mutates a caller's `let` binding via a closure can observe the different
// read timing of a stable argument.

type InlineableFunction =
  | ts.ArrowFunction
  | ts.FunctionExpression
  | ts.MethodDeclaration
  | ts.FunctionDeclaration;

function asInlineableFunction(node: ts.Node): InlineableFunction | undefined {
  if (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isFunctionDeclaration(node)
  ) {
    return node;
  }
  return undefined;
}

interface WalkState {
  /** Inside a nested function: not evaluated at call time. */
  nestedFn: boolean;
  /** Inside a nested non-arrow function or class: `this`/`arguments` rebound. */
  nonArrow: boolean;
  /** Possibly not evaluated (short-circuit RHS, ?: branch, optional chain, after an `if`). */
  cond: boolean;
}

interface WalkHooks {
  /** An identifier in a reference (read or write) position. */
  ref?(id: ts.Identifier, st: WalkState, isWrite: boolean): void;
  /** A potentially side-effecting operation completed (post-order). */
  effect?(st: WalkState): void;
  /** `this`/`super`/`arguments`/`new.target` bound to the inlined function. */
  receiver?(): void;
  /** `await`/`yield` belonging to the inlined function. */
  suspend?(): void;
  /** Any binding name declared within the walked node. */
  binding?(name: string): void;
  /** A construct the analysis doesn't model (classes). */
  unsupported?(): void;
}

const LOGICAL_OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

function isAssignmentOperatorKind(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

function walkBindingName(name: ts.BindingName, st: WalkState, h: WalkHooks): void {
  if (ts.isIdentifier(name)) {
    h.binding?.(name.text);
    return;
  }
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) walkNode(element, st, h);
  }
}

function walkFunction(
  fn: ts.SignatureDeclaration & { body?: ts.Node },
  st: WalkState,
  h: WalkHooks
): void {
  const inner: WalkState = {
    nestedFn: true,
    nonArrow: st.nonArrow || !ts.isArrowFunction(fn),
    cond: st.cond,
  };
  if ((ts.isFunctionExpression(fn) || ts.isFunctionDeclaration(fn)) && fn.name) {
    h.binding?.(fn.name.text);
  }
  for (const p of fn.parameters) walkNode(p, inner, h);
  if (fn.body) walkNode(fn.body, inner, h);
}

/**
 * Walk a method body in evaluation order, distinguishing identifier
 * references from non-reference identifier positions (property names, keys,
 * labels, types). Shared by the inliner's analysis and the free-name scan.
 */
function walkNode(node: ts.Node, st: WalkState, h: WalkHooks): void {
  const go = (n: ts.Node | undefined, s: WalkState = st): void => {
    if (n) walkNode(n, s, h);
  };
  const condSt: WalkState = { ...st, cond: true };

  if (ts.isTypeNode(node)) return; // erased
  if (
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isTypeParameterDeclaration(node)
  ) {
    return;
  }

  if (ts.isIdentifier(node)) {
    if (node.text === "arguments" && !st.nonArrow) h.receiver?.();
    h.ref?.(node, st, false);
    return;
  }
  switch (node.kind) {
    case ts.SyntaxKind.ThisKeyword:
    case ts.SyntaxKind.SuperKeyword:
      if (!st.nonArrow) h.receiver?.();
      return;
  }
  if (ts.isMetaProperty(node)) {
    if (!st.nonArrow) h.receiver?.();
    return;
  }
  if (ts.isPropertyAccessExpression(node)) {
    go(node.expression);
    return;
  }
  if (ts.isQualifiedName(node)) return;
  if (ts.isPropertyAssignment(node)) {
    if (ts.isComputedPropertyName(node.name)) go(node.name);
    go(node.initializer);
    return;
  }
  if (ts.isShorthandPropertyAssignment(node)) {
    h.ref?.(node.name, st, false);
    go(node.objectAssignmentInitializer, condSt);
    return;
  }
  if (ts.isMethodDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node)) {
    if (ts.isComputedPropertyName(node.name)) go(node.name);
    walkFunction(node, st, h);
    return;
  }
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)) {
    walkFunction(node, st, h);
    return;
  }
  if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
    h.unsupported?.();
    return;
  }
  if (ts.isBindingElement(node)) {
    if (node.propertyName && ts.isComputedPropertyName(node.propertyName)) go(node.propertyName);
    walkBindingName(node.name, st, h);
    go(node.initializer, condSt);
    return;
  }
  if (ts.isVariableDeclaration(node) || ts.isParameter(node)) {
    walkBindingName(node.name, st, h);
    go(node.initializer);
    return;
  }
  if (ts.isCatchClause(node)) {
    if (node.variableDeclaration) walkBindingName(node.variableDeclaration.name, st, h);
    go(node.block);
    return;
  }
  if (ts.isLabeledStatement(node)) {
    go(node.statement);
    return;
  }
  if (ts.isBreakStatement(node) || ts.isContinueStatement(node)) return;
  if (ts.isJsxAttribute(node)) {
    go(node.initializer);
    return;
  }
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    if (LOGICAL_OPERATORS.has(op)) {
      go(node.left);
      go(node.right, condSt);
      if (isAssignmentOperatorKind(op)) h.effect?.(st);
      return;
    }
    if (isAssignmentOperatorKind(op)) {
      if (ts.isIdentifier(node.left)) {
        h.ref?.(node.left, st, true);
      } else {
        go(node.left);
      }
      go(node.right);
      h.effect?.(st);
      return;
    }
    go(node.left);
    go(node.right);
    return;
  }
  if (ts.isConditionalExpression(node)) {
    go(node.condition);
    go(node.whenTrue, condSt);
    go(node.whenFalse, condSt);
    return;
  }
  if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
    const isUpdate =
      node.operator === ts.SyntaxKind.PlusPlusToken ||
      node.operator === ts.SyntaxKind.MinusMinusToken;
    if (isUpdate && ts.isIdentifier(node.operand)) {
      h.ref?.(node.operand, st, true);
    } else {
      go(node.operand);
    }
    if (isUpdate) h.effect?.(st);
    return;
  }
  if (ts.isDeleteExpression(node)) {
    go(node.expression);
    h.effect?.(st);
    return;
  }
  if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
    go(node.expression);
    const argSt = ts.isOptionalChain(node) ? condSt : st;
    for (const a of node.arguments ?? []) go(a, argSt);
    h.effect?.(st);
    return;
  }
  if (ts.isElementAccessExpression(node)) {
    go(node.expression);
    go(node.argumentExpression, ts.isOptionalChain(node) ? condSt : st);
    return;
  }
  if (ts.isTaggedTemplateExpression(node)) {
    go(node.tag);
    go(node.template);
    h.effect?.(st);
    return;
  }
  if (ts.isAwaitExpression(node) || ts.isYieldExpression(node)) {
    if (!st.nestedFn) h.suspend?.();
    go(node.expression);
    h.effect?.(st);
    return;
  }
  if (ts.isIfStatement(node)) {
    go(node.expression);
    go(node.thenStatement, condSt);
    go(node.elseStatement, condSt);
    return;
  }
  if (ts.isBlock(node)) {
    let s = st;
    for (const stmt of node.statements) {
      go(stmt, s);
      if (ts.isIfStatement(stmt)) s = { ...s, cond: true };
    }
    return;
  }
  ts.forEachChild(node, (child) => {
    walkNode(child, st, h);
  });
}

const TOP_LEVEL_STATE: WalkState = { nestedFn: false, nonArrow: false, cond: false };

/**
 * Names a method body references that are not its own parameters — i.e. the
 * identifiers that must resolve to the same declarations wherever the body is
 * inlined. Coarse by design: a body-local name is included too (checking it
 * at the call site is harmless).
 */
export function collectMethodFreeNames(methodNode: ts.Node): Set<string> {
  const names = new Set<string>();
  forEachMethodFreeReference(methodNode, (id) => names.add(id.text));
  return names;
}

/**
 * Visit every identifier REFERENCE in a function's parameter defaults and
 * body whose name is not one of its own parameters (property names, keys and
 * labels are not references). Body-local names are included — callers that
 * have a checker can tell them apart by declaration position.
 */
export function forEachMethodFreeReference(
  methodNode: ts.Node,
  cb: (id: ts.Identifier) => void
): void {
  const fn = asInlineableFunction(methodNode);
  if (!fn) return;
  const params = new Set<string>();
  for (const p of fn.parameters) if (ts.isIdentifier(p.name)) params.add(p.name.text);
  const hooks: WalkHooks = {
    ref: (id) => {
      if (!params.has(id.text)) cb(id);
    },
  };
  for (const p of fn.parameters) if (p.initializer) walkNode(p.initializer, TOP_LEVEL_STATE, hooks);
  if (fn.body) walkNode(fn.body, TOP_LEVEL_STATE, hooks);
}

/**
 * Does this method body depend on its receiver/activation (`this`, `super`,
 * `arguments`, `new.target`, own `await`/`yield`), or is it async/a
 * generator? Such bodies change meaning when moved to a call site (tc#2).
 */
export function methodDependsOnReceiver(methodNode: ts.Node): boolean {
  const fn = asInlineableFunction(methodNode);
  if (!fn) return true;
  if (fn.asteriskToken) return true;
  if (fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) return true;
  let depends = false;
  const hooks: WalkHooks = {
    receiver: () => (depends = true),
    suspend: () => (depends = true),
  };
  for (const p of fn.parameters) walkNode(p, TOP_LEVEL_STATE, hooks);
  if (fn.body) walkNode(fn.body, TOP_LEVEL_STATE, hooks);
  return depends;
}

type ArgClass = "literal" | "pure" | "stable" | "effectful";

function unwrapParens(expr: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(expr)) expr = expr.expression;
  return expr;
}

function classifyArgument(arg: ts.Expression): ArgClass {
  const e = unwrapParens(arg);
  if (
    ts.isNumericLiteral(e) ||
    ts.isStringLiteral(e) ||
    ts.isBigIntLiteral(e) ||
    ts.isNoSubstitutionTemplateLiteral(e) ||
    e.kind === ts.SyntaxKind.TrueKeyword ||
    e.kind === ts.SyntaxKind.FalseKeyword ||
    e.kind === ts.SyntaxKind.NullKeyword
  ) {
    return "literal";
  }
  if (
    ts.isPrefixUnaryExpression(e) &&
    (e.operator === ts.SyntaxKind.MinusToken || e.operator === ts.SyntaxKind.PlusToken) &&
    (ts.isNumericLiteral(e.operand) || ts.isBigIntLiteral(e.operand))
  ) {
    return "literal";
  }
  if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) return "pure";
  if (isStableReference(e)) return "stable";
  return "effectful";
}

function isStableReference(e: ts.Expression): boolean {
  e = unwrapParens(e);
  if (ts.isIdentifier(e) || e.kind === ts.SyntaxKind.ThisKeyword) return true;
  if (ts.isPropertyAccessExpression(e)) return isStableReference(e.expression);
  return false;
}

/**
 * May this argument be read lazily (from inside a nested function in the
 * inlined body) instead of once at call time? Only for literals and
 * identifiers bound to declarations that can never be reassigned.
 */
function isClosureStable(ctx: MacroContext, arg: ts.Expression, cls: ArgClass): boolean {
  if (cls === "literal" || cls === "pure") return true;
  const e = unwrapParens(arg);
  if (!ts.isIdentifier(e) || e.pos < 0) return false;
  const checker = (ctx as Partial<MacroContext>).typeChecker;
  if (!checker) return false;
  let symbol: ts.Symbol | undefined;
  try {
    symbol = checker.getSymbolAtLocation(e);
  } catch {
    return false;
  }
  const decls = symbol?.declarations;
  if (!decls || decls.length === 0) return false;
  return decls.every((d) => {
    if (d.getSourceFile().isDeclarationFile) return true;
    if (ts.isVariableDeclaration(d)) {
      return ts.isVariableDeclarationList(d.parent) && (d.parent.flags & ts.NodeFlags.Const) !== 0;
    }
    return (
      ts.isFunctionDeclaration(d) ||
      ts.isClassDeclaration(d) ||
      ts.isEnumDeclaration(d) ||
      ts.isImportSpecifier(d) ||
      ts.isImportClause(d) ||
      ts.isNamespaceImport(d)
    );
  });
}

function collectIdentifierTexts(node: ts.Node, out: Set<string>): void {
  if (ts.isIdentifier(node)) out.add(node.text);
  ts.forEachChild(node, (c) => collectIdentifierTexts(c, out));
}

function needsParens(arg: ts.Expression): boolean {
  return !(
    ts.isIdentifier(arg) ||
    ts.isPropertyAccessExpression(arg) ||
    ts.isElementAccessExpression(arg) ||
    ts.isCallExpression(arg) ||
    ts.isParenthesizedExpression(arg) ||
    ts.isArrayLiteralExpression(arg) ||
    ts.isTemplateExpression(arg) ||
    ts.isNoSubstitutionTemplateLiteral(arg) ||
    ts.isStringLiteral(arg) ||
    ts.isNumericLiteral(arg) ||
    ts.isBigIntLiteral(arg) ||
    arg.kind === ts.SyntaxKind.ThisKeyword ||
    arg.kind === ts.SyntaxKind.TrueKeyword ||
    arg.kind === ts.SyntaxKind.FalseKeyword ||
    arg.kind === ts.SyntaxKind.NullKeyword
  );
}

interface RefEvent {
  kind: "ref";
  param: number;
  nested: boolean;
  cond: boolean;
}
interface EffectEvent {
  kind: "effect";
}

/**
 * Decide whether substituting `callArgs` for `fn`'s parameters preserves the
 * call's semantics (see the section comment). Returns the parameter names on
 * success, undefined to decline.
 */
function checkInlineSafety(
  ctx: MacroContext,
  fn: InlineableFunction,
  body: ts.Node,
  callArgs: readonly ts.Expression[]
): string[] | undefined {
  if (methodDependsOnReceiver(fn)) return undefined;

  const names: string[] = [];
  for (const p of fn.parameters) {
    if (!ts.isIdentifier(p.name) || p.initializer || p.dotDotDotToken) return undefined;
    names.push(p.name.text);
  }
  if (callArgs.length !== names.length) return undefined;
  if (callArgs.some((a) => ts.isSpreadElement(a))) return undefined;

  const paramIndex = new Map(names.map((n, i) => [n, i] as const));
  const events: Array<RefEvent | EffectEvent> = [];
  const bound = new Set<string>();
  let unsafe = false;
  walkNode(body, TOP_LEVEL_STATE, {
    ref: (id, st, isWrite) => {
      const i = paramIndex.get(id.text);
      if (i === undefined) return;
      if (isWrite) unsafe = true;
      events.push({ kind: "ref", param: i, nested: st.nestedFn, cond: st.cond });
    },
    effect: (st) => {
      if (!st.nestedFn) events.push({ kind: "effect" });
    },
    binding: (n) => bound.add(n),
    unsupported: () => (unsafe = true),
  });
  if (unsafe) return undefined;

  // A named function expression can refer to itself; that name is not bound
  // at the call site.
  if (ts.isFunctionExpression(fn) && fn.name) bound.add(fn.name.text);

  // Shadowing: a nested binding with a parameter's name.
  if (names.some((n) => bound.has(n))) return undefined;
  // Capture: a body binding with the name of an identifier used in an argument.
  const argIdents = new Set<string>();
  for (const a of callArgs) collectIdentifierTexts(a, argIdents);
  for (const n of argIdents) if (bound.has(n)) return undefined;

  const classes = callArgs.map(classifyArgument);
  const refsOf = (i: number): number[] =>
    events.flatMap((e, idx) => (e.kind === "ref" && e.param === i ? [idx] : []));

  let lastEffectfulPos = -1;
  for (let i = 0; i < callArgs.length; i++) {
    const cls = classes[i];
    const refIdx = refsOf(i);
    const refs = refIdx.map((idx) => events[idx] as RefEvent);
    if (cls === "literal") continue;
    if (cls === "pure") {
      if (refs.length > 1) return undefined;
      continue;
    }
    if (cls === "stable") {
      if (refs.some((r) => r.nested) && !isClosureStable(ctx, callArgs[i], cls)) return undefined;
      continue;
    }
    // effectful
    if (refs.length !== 1 || refs[0].nested || refs[0].cond) return undefined;
    const pos = refIdx[0];
    if (pos < lastEffectfulPos) return undefined; // effectful args out of order
    lastEffectfulPos = pos;
    for (let k = 0; k < pos; k++) if (events[k].kind === "effect") return undefined;
    for (let j = 0; j < callArgs.length; j++) {
      if (j === i || classes[j] !== "stable") continue;
      const other = refsOf(j);
      if (j < i && other.some((idx) => idx > pos)) return undefined;
      if (j > i && other.some((idx) => idx < pos)) return undefined;
    }
  }

  return names;
}

// ============================================================================
// Object-literal argument projection (scalar replacement)
// ============================================================================
//
// `a + b + c` on a product type rewrites to `V.add(V.add(a, b), c)`. The inner
// call inlines to an object literal, `{ x: a.x + b.x, y: a.y + b.y }`, which
// is not a "stable" argument, and the outer body reads it twice (`a.x`,
// `a.y`), so plain substitution would duplicate it and the inliner used to
// fall back to `((a, b) => ({ ... }))({ ... }, c)`: an IIFE per level, with
// every intermediate object allocated. Instead, when the outer body reads
// that parameter only as `p.name`, each read is replaced by the literal's
// `name` initializer, and the object is never built:
// `{ x: (a.x + b.x) + c.x, y: (a.y + b.y) + c.y }`.
//
// When that is safe:
// - the literal has only `name: init` / shorthand properties with plain
//   names (no spread, method, accessor, computed or duplicate name,
//   `__proto__`), and every initializer is free of effects (literals, reads,
//   operators; see isEffectFreeInitializer), so reading it later, at its
//   use, or not at all, or (when it is rereadable) more than once, is
//   indistinguishable from evaluating it once up front;
// - every reference to the parameter in the body is `p.name` for a property
//   the literal has, not written, deleted, updated or called as a method
//   (`p.m()` would lose its receiver), and not inside a nested function
//   (read later, when the initializer's operands may have changed);
// - no other argument is effectful (a call evaluated before the body reads
//   the literal's operands could change them; e.g. `add({ x: a.x }, bump())`),
//   and no body binding has the name of an identifier in a projected
//   initializer (it would capture it).
// A property read more than once whose initializer is not rereadable
// (`a.d * b.d` in a rational's `add`) is evaluated once, not duplicated:
// into a `const` declared before the enclosing statement when the caller
// allows it (InlineOptions.hoistConst; then nothing is left to wrap), and
// otherwise into a new parameter, the remaining function being inlined by
// the ordinary rules, which apply it as an IIFE over those values if they
// must (no intermediate object either way). The parameters are
// renamed to fresh names first, so an initializer's identifiers can never be
// mistaken for a remaining parameter (`add({ x: b.x }, a)` with params
// `a, b`). Reads move relative to the body's own calls exactly as a stable
// argument's do (the "Known residuals" above).

function isEffectFreeInitializer(e: ts.Expression): boolean {
  e = unwrapParens(e);
  const cls = classifyArgument(e);
  if (cls === "literal" || cls === "stable") return true;
  if (ts.isAsExpression(e) || ts.isNonNullExpression(e) || ts.isSatisfiesExpression(e)) {
    return isEffectFreeInitializer(e.expression);
  }
  if (ts.isTypeAssertionExpression(e)) return isEffectFreeInitializer(e.expression);
  if (ts.isPropertyAccessExpression(e)) {
    return !e.questionDotToken && isEffectFreeInitializer(e.expression);
  }
  if (ts.isElementAccessExpression(e)) {
    return (
      !e.questionDotToken &&
      isEffectFreeInitializer(e.expression) &&
      isEffectFreeInitializer(e.argumentExpression)
    );
  }
  if (ts.isBinaryExpression(e)) {
    const op = e.operatorToken.kind;
    if (isAssignmentOperatorKind(op) || op === ts.SyntaxKind.CommaToken) return false;
    return isEffectFreeInitializer(e.left) && isEffectFreeInitializer(e.right);
  }
  if (ts.isPrefixUnaryExpression(e)) {
    if (
      e.operator === ts.SyntaxKind.PlusPlusToken ||
      e.operator === ts.SyntaxKind.MinusMinusToken
    ) {
      return false;
    }
    return isEffectFreeInitializer(e.operand);
  }
  if (ts.isTypeOfExpression(e) || ts.isVoidExpression(e)) {
    return isEffectFreeInitializer(e.expression);
  }
  if (ts.isConditionalExpression(e)) {
    return (
      isEffectFreeInitializer(e.condition) &&
      isEffectFreeInitializer(e.whenTrue) &&
      isEffectFreeInitializer(e.whenFalse)
    );
  }
  if (ts.isTemplateExpression(e)) {
    return e.templateSpans.every((span) => isEffectFreeInitializer(span.expression));
  }
  return false;
}

/** Plain property name -> initializer, or undefined when the literal can't be projected. */
function projectableProperties(arg: ts.Expression): Map<string, ts.Expression> | undefined {
  const lit = unwrapParens(arg);
  if (!ts.isObjectLiteralExpression(lit)) return undefined;
  const props = new Map<string, ts.Expression>();
  for (const p of lit.properties) {
    let name: string;
    let init: ts.Expression;
    if (ts.isPropertyAssignment(p)) {
      if (!ts.isIdentifier(p.name) && !ts.isStringLiteral(p.name) && !ts.isNumericLiteral(p.name)) {
        return undefined;
      }
      name = p.name.text;
      init = p.initializer;
    } else if (ts.isShorthandPropertyAssignment(p) && !p.objectAssignmentInitializer) {
      name = p.name.text;
      init = p.name;
    } else {
      return undefined;
    }
    if (name === "__proto__" || props.has(name) || !isEffectFreeInitializer(init)) {
      return undefined;
    }
    props.set(name, init);
  }
  return props;
}

/** A read is rereadable when doing it twice costs nothing and gives the same value. */
function isRereadableInitializer(e: ts.Expression): boolean {
  const cls = classifyArgument(e);
  return cls === "literal" || cls === "stable";
}

function projectObjectLiteralArguments(
  ctx: MacroContext,
  fn: InlineableFunction,
  body: ts.Node,
  callArgs: readonly ts.Expression[],
  options: InlineOptions | undefined
): { fn: ts.ArrowFunction; args: ts.Expression[] } | undefined {
  if (typeof (ctx as Partial<MacroContext>).generateUniqueName !== "function") return undefined;
  const names: string[] = [];
  for (const p of fn.parameters) {
    if (!ts.isIdentifier(p.name) || p.initializer || p.dotDotDotToken) return undefined;
    names.push(p.name.text);
  }
  if (callArgs.length !== names.length || callArgs.some((a) => ts.isSpreadElement(a))) {
    return undefined;
  }
  const literalProps = callArgs.map(projectableProperties);
  if (literalProps.every((p) => p === undefined)) return undefined;

  // Where each identifier sits: projectable only as `p.name` in a read position.
  type Use = { prop: string } | "other";
  const useOf = new Map<ts.Identifier, Use>();
  const mark = (n: ts.Node, target: boolean): void => {
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && !n.questionDotToken) {
      useOf.set(n.expression, target ? "other" : { prop: n.name.text });
      return;
    }
    if (ts.isBinaryExpression(n) && isAssignmentOperatorKind(n.operatorToken.kind)) {
      mark(n.left, true);
      mark(n.right, false);
      return;
    }
    if (
      (ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) &&
      (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken)
    ) {
      mark(n.operand, true);
      return;
    }
    if (ts.isDeleteExpression(n)) {
      mark(n.expression, true);
      return;
    }
    if (
      (ts.isForInStatement(n) || ts.isForOfStatement(n)) &&
      !ts.isVariableDeclarationList(n.initializer)
    ) {
      mark(n.initializer, true);
      mark(n.expression, false);
      mark(n.statement, false);
      return;
    }
    if (
      (ts.isCallExpression(n) || ts.isTaggedTemplateExpression(n)) &&
      ts.isPropertyAccessExpression(ts.isCallExpression(n) ? n.expression : n.tag)
    ) {
      // `p.m()`: the receiver is the object itself.
      const callee = (ts.isCallExpression(n) ? n.expression : n.tag) as ts.PropertyAccessExpression;
      if (ts.isIdentifier(callee.expression)) useOf.set(callee.expression, "other");
      else mark(callee, target);
      if (ts.isCallExpression(n)) for (const a of n.arguments) mark(a, false);
      else mark(n.template, false);
      return;
    }
    ts.forEachChild(n, (c) => mark(c, target));
  };
  mark(body, false);

  // Per parameter: projectable, and how often each property is read.
  const reads = callArgs.map(() => new Map<string, number>());
  const projectable = literalProps.map((p) => p !== undefined);
  const paramIndex = new Map(names.map((n, i) => [n, i] as const));
  const bound = new Set<string>();
  let unsafe = false;
  walkNode(body, TOP_LEVEL_STATE, {
    ref: (id, st) => {
      const i = paramIndex.get(id.text);
      if (i === undefined || !projectable[i]) return;
      const use = useOf.get(id);
      if (st.nestedFn || use === undefined || use === "other" || !literalProps[i]!.has(use.prop)) {
        projectable[i] = false;
        return;
      }
      reads[i].set(use.prop, (reads[i].get(use.prop) ?? 0) + 1);
    },
    binding: (n) => bound.add(n),
    unsupported: () => (unsafe = true),
  });
  if (unsafe || !projectable.some(Boolean)) return undefined;
  if (ts.isFunctionExpression(fn) && fn.name) bound.add(fn.name.text);
  if (names.some((n) => bound.has(n))) return undefined;
  // An effectful sibling argument would run before the body reads the
  // literal's operands; a body binding would capture them.
  for (let i = 0; i < callArgs.length; i++) {
    if (!projectable[i] && classifyArgument(callArgs[i]) === "effectful") return undefined;
  }
  const projectedIdents = new Set<string>();
  for (let i = 0; i < callArgs.length; i++) {
    if (projectable[i]) collectIdentifierTexts(callArgs[i], projectedIdents);
  }
  for (const n of projectedIdents) if (bound.has(n)) return undefined;

  const f = ctx.factory;
  // 1. Rename every parameter to a fresh name (substituteParamRefs handles
  //    shorthand properties and reference positions).
  const fresh = names.map((n) => ctx.generateUniqueName(n));
  const renamed = substituteParamRefs(ctx, stripCommentsDeep(cloneNodeDeep(body)), names, fresh);

  // 2. Replace `fresh_i.name` with the initializer, or with a new parameter
  //    holding it when it is read more than once and isn't rereadable.
  const freshIndex = new Map(fresh.map((id, i) => [id.text, i] as const));
  const temps: { name: ts.Identifier; init: ts.Expression }[] = [];
  const tempOf = new Map<string, ts.Identifier>();
  const replacementFor = (i: number, prop: string): ts.Expression => {
    const init = literalProps[i]!.get(prop)!;
    if ((reads[i].get(prop) ?? 0) <= 1 || isRereadableInitializer(init)) {
      const copy = cloneNodeDeep(unwrapParens(init));
      return needsParens(copy) ? f.createParenthesizedExpression(copy) : copy;
    }
    const key = `${i}:${prop}`;
    let temp = tempOf.get(key);
    if (!temp) {
      temp = ctx.generateUniqueName(`${names[i]}_${prop}`);
      tempOf.set(key, temp);
      const value = cloneNodeDeep(unwrapParens(init));
      if (options?.hoistConst) options.hoistConst(temp, value);
      else temps.push({ name: temp, init: value });
    }
    return f.createIdentifier(temp.text);
  };
  const project = (n: ts.Node): ts.Node => {
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression)) {
      const i = freshIndex.get(n.expression.text);
      if (i !== undefined && projectable[i]) return replacementFor(i, n.name.text);
    }
    return ts.visitEachChild(n, project, ctx.transformContext);
  };
  const projectedBody = ts.visitNode(renamed, project) as ts.Node;

  const params: ts.ParameterDeclaration[] = [];
  const args: ts.Expression[] = [];
  for (let i = 0; i < names.length; i++) {
    if (projectable[i]) continue;
    params.push(f.createParameterDeclaration(undefined, undefined, fresh[i]));
    args.push(callArgs[i]);
  }
  for (const t of temps) {
    params.push(f.createParameterDeclaration(undefined, undefined, t.name));
    args.push(t.init);
  }
  const arrow = f.createArrowFunction(
    undefined,
    undefined,
    params,
    undefined,
    f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    ts.isBlock(projectedBody) || !ts.isObjectLiteralExpression(projectedBody)
      ? (projectedBody as ts.ConciseBody)
      : f.createParenthesizedExpression(projectedBody as ts.Expression)
  );
  return { fn: arrow, args };
}

/**
 * Replace parameter references with their arguments. Mirrors `walkNode`'s
 * notion of reference positions; parameters can't be shadowed here
 * (`checkInlineSafety` rejected that), so every matching reference is the
 * parameter.
 */
function substituteParamRefs(
  ctx: MacroContext,
  node: ts.Node,
  names: readonly string[],
  callArgs: readonly ts.Expression[]
): ts.Node {
  const f = ctx.factory;
  const index = new Map(names.map((n, i) => [n, i] as const));
  const replacement = (i: number): ts.Expression => {
    const arg = callArgs[i];
    // Always a fresh synthetic copy: never strip positions off the caller's
    // real nodes in place (a callee body is re-specialized at every call site
    // and must stay checker-resolvable), and never share one node between
    // two positions.
    const node = cloneNodeDeep(arg);
    // cloneNodeDeep severs the copy's `original` link (a callee body may come
    // from another file). An ARGUMENT that is, or copies, a node of the file
    // being transformed keeps that link, so the copy still says which source
    // expression it is (power-assert draws an operand's value at its column).
    const source = ts.getOriginalNode(arg);
    if (!isSyntheticNode(source) && source.getSourceFile?.() === ctx.sourceFile) {
      ts.setOriginalNode(node, source);
    }
    return needsParens(node) ? f.createParenthesizedExpression(node) : node;
  };

  const visit = (n: ts.Node): ts.Node => {
    if (ts.isTypeNode(n) || ts.isQualifiedName(n)) return n;
    if (ts.isIdentifier(n)) {
      const i = index.get(n.text);
      return i === undefined ? n : replacement(i);
    }
    if (ts.isPropertyAccessExpression(n)) {
      const expr = visit(n.expression) as ts.Expression;
      return ts.isPropertyAccessChain(n)
        ? f.updatePropertyAccessChain(n, expr, n.questionDotToken, n.name)
        : f.updatePropertyAccessExpression(n, expr, n.name);
    }
    if (ts.isPropertyAssignment(n)) {
      const name = ts.isComputedPropertyName(n.name) ? (visit(n.name) as ts.PropertyName) : n.name;
      return f.updatePropertyAssignment(n, name, visit(n.initializer) as ts.Expression);
    }
    if (ts.isShorthandPropertyAssignment(n)) {
      const i = index.get(n.name.text);
      if (i === undefined) return ts.visitEachChild(n, visit, ctx.transformContext);
      return f.createPropertyAssignment(f.createIdentifier(n.name.text), replacement(i));
    }
    if (ts.isMethodDeclaration(n)) {
      return f.updateMethodDeclaration(
        n,
        n.modifiers,
        n.asteriskToken,
        ts.isComputedPropertyName(n.name) ? (visit(n.name) as ts.PropertyName) : n.name,
        n.questionToken,
        n.typeParameters,
        ts.visitNodes(n.parameters, visit) as ts.NodeArray<ts.ParameterDeclaration>,
        n.type,
        n.body ? (visit(n.body) as ts.Block) : undefined
      );
    }
    if (ts.isGetAccessor(n)) {
      return f.updateGetAccessorDeclaration(
        n,
        n.modifiers,
        ts.isComputedPropertyName(n.name) ? (visit(n.name) as ts.PropertyName) : n.name,
        ts.visitNodes(n.parameters, visit) as ts.NodeArray<ts.ParameterDeclaration>,
        n.type,
        n.body ? (visit(n.body) as ts.Block) : undefined
      );
    }
    if (ts.isSetAccessor(n)) {
      return f.updateSetAccessorDeclaration(
        n,
        n.modifiers,
        ts.isComputedPropertyName(n.name) ? (visit(n.name) as ts.PropertyName) : n.name,
        ts.visitNodes(n.parameters, visit) as ts.NodeArray<ts.ParameterDeclaration>,
        n.body ? (visit(n.body) as ts.Block) : undefined
      );
    }
    if (ts.isBindingElement(n)) {
      const propertyName =
        n.propertyName && ts.isComputedPropertyName(n.propertyName)
          ? (visit(n.propertyName) as ts.PropertyName)
          : n.propertyName;
      return f.updateBindingElement(
        n,
        n.dotDotDotToken,
        propertyName,
        visit(n.name) as ts.BindingName,
        n.initializer ? (visit(n.initializer) as ts.Expression) : undefined
      );
    }
    if (ts.isLabeledStatement(n)) {
      return f.updateLabeledStatement(n, n.label, visit(n.statement) as ts.Statement);
    }
    if (ts.isBreakStatement(n) || ts.isContinueStatement(n)) return n;
    if (ts.isJsxAttribute(n)) {
      return f.updateJsxAttribute(
        n,
        n.name,
        n.initializer ? (visit(n.initializer) as ts.JsxAttributeValue) : undefined
      );
    }
    return ts.visitEachChild(n, visit, ctx.transformContext);
  };

  return visit(node);
}

/**
 * Inline a dictionary method call with its concrete implementation.
 *
 * For a method like `(fa, f) => fa.map(f)` called with args `[myArr, myFn]`,
 * produces `myArr.map(myFn)`. Falls back to an IIFE when direct substitution
 * could change evaluation, and returns undefined — keep the ordinary call —
 * when the body depends on its receiver (see "Safe method inlining").
 */
export function inlineMethod(
  ctx: MacroContext,
  method: DictMethod,
  callArgs: ts.Expression[],
  options?: InlineOptions
): ts.Expression | undefined {
  if (!method.node) return undefined;
  return inlineFromNode(ctx, method.node, callArgs, options);
}

/** How {@link inlineMethod} may bind a value it must not compute twice. */
export interface InlineOptions {
  /**
   * Declare `const <name> = <init>;` just before the statement the call is
   * in, which the caller has checked evaluates the call unconditionally,
   * once, and with nothing evaluated before it in that statement (see the
   * transformer's statement temporaries). Absent: such a value becomes a
   * parameter of an IIFE.
   */
  hoistConst?: (name: ts.Identifier, init: ts.Expression) => void;
}

/**
 * Inline a method from its AST node representation.
 */
function inlineFromNode(
  ctx: MacroContext,
  methodNode: ts.Expression | ts.Node,
  callArgs: ts.Expression[],
  options?: InlineOptions
): ts.Expression | undefined {
  const fn = asInlineableFunction(methodNode);
  const body = fn?.body;
  if (!fn || !body) return undefined;

  // Receiver/activation-dependent bodies can't move to the call site in any form.
  if (methodDependsOnReceiver(fn)) return undefined;

  // An object-literal argument read only as `p.name` (an operator chain:
  // `add(add(a, b), c)`, whose inner call inlined to `{ x: ..., y: ... }`):
  // read each property's initializer directly instead of building the object
  // and applying the method as an IIFE (see projectObjectLiteralArguments).
  const projected = projectObjectLiteralArguments(ctx, fn, body, callArgs, options);
  if (projected) return inlineFromNode(ctx, projected.fn, projected.args, options);

  let names = checkInlineSafety(ctx, fn, body, callArgs);
  if (!names && options?.hoistConst) {
    // In statement position, the arguments direct substitution can't take
    // (`mk() + mk()`: each read twice) are evaluated, in order, into `const`s
    // before the statement instead of into an IIFE's parameters: every
    // effectful argument, and every stable one to the left of the last of
    // those (read before it, as in the call).
    const hoisted = hoistArguments(ctx, fn, body, callArgs);
    if (hoisted) {
      for (const h of hoisted.consts) options.hoistConst(h.name, h.init);
      callArgs = hoisted.args;
      names = hoisted.names;
    }
  }
  // Direct substitution would change evaluation (duplicated/reordered/dropped
  // arguments, shadowing, missing/default/rest params …): apply the method
  // body as an IIFE instead — the arguments are evaluated exactly once, in
  // order, into the body's own parameter scope, which is exactly the call's
  // semantics without the dictionary lookup.
  if (!names) return isInlineableShape(fn.body) ? applyAsIIFE(ctx, fn, callArgs) : undefined;

  // Strip comments from the template body to prevent the printer from emitting
  // stray comments (e.g. JSDoc from the typeclass definition) into inlined code.
  const cleanBody = stripCommentsDeep(body);

  // For block bodies, handle inlining
  if (ts.isBlock(cleanBody)) {
    const substitutedBody = substituteParamRefs(ctx, cleanBody, names, callArgs);
    if (!ts.isBlock(substitutedBody)) {
      return undefined;
    }
    const substitutedBlock = substitutedBody;

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
            return createIIFE(ctx, [...statements.slice(0, i), stmt]);
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

    // Can't inline block body (loops, try, …) — keep the ordinary call.
    return undefined;
  }

  // Substitute parameters in the expression body
  return substituteParamRefs(ctx, cleanBody, names, callArgs) as ts.Expression;
}

/**
 * The arguments with each one that must be evaluated up front replaced by a
 * fresh name, the `const`s that bind those names, and the parameter names
 * {@link checkInlineSafety} accepts for the new arguments; undefined when it
 * still declines (shadowing, a default or rest parameter, ...) or nothing
 * needs hoisting. Nothing is declared until the caller commits to it.
 */
function hoistArguments(
  ctx: MacroContext,
  fn: InlineableFunction,
  body: ts.Node,
  callArgs: readonly ts.Expression[]
):
  | {
      args: ts.Expression[];
      consts: { name: ts.Identifier; init: ts.Expression }[];
      names: string[];
    }
  | undefined {
  if (typeof (ctx as Partial<MacroContext>).generateUniqueName !== "function") return undefined;
  if (callArgs.some((a) => ts.isSpreadElement(a))) return undefined;
  const classes = callArgs.map(classifyArgument);
  let last = -1;
  classes.forEach((c, i) => {
    if (c === "effectful") last = i;
  });
  if (last < 0) return undefined;
  const consts: { name: ts.Identifier; init: ts.Expression }[] = [];
  const args = callArgs.map((a, i) => {
    const c = classes[i];
    // A function argument stays (a `const` would give it a name).
    if (c === "literal" || c === "pure" || (c === "stable" && i > last)) return a;
    const name = ctx.generateUniqueName(`arg${i}`);
    consts.push({ name, init: cloneNodeDeep(unwrapParens(a)) });
    return ctx.factory.createIdentifier(name.text);
  });
  const names = checkInlineSafety(ctx, fn, body, args);
  return names ? { args, consts, names } : undefined;
}

/** Expression body, or a block simple enough to inline/flatten (no loops, try, …). */
function isInlineableShape(body: ts.Node): boolean {
  if (!ts.isBlock(body)) return true;
  const c = classifyInlineFailureDetailed(body);
  return c.reason === null || c.canFlatten;
}

/**
 * `((p1, p2) => <body>)(a1, a2)` — the method itself, as an arrow applied to
 * the call's arguments. Only for bodies that don't depend on their receiver
 * (the caller checks `methodDependsOnReceiver`). Type annotations are dropped:
 * they may name the instance module's types or the method's type parameters.
 */
function applyAsIIFE(
  ctx: MacroContext,
  fn: InlineableFunction,
  callArgs: readonly ts.Expression[]
): ts.Expression | undefined {
  if (!fn.body) return undefined;
  const f = ctx.factory;
  const params = fn.parameters.map((p) =>
    f.createParameterDeclaration(
      undefined,
      p.dotDotDotToken,
      cloneNodeDeep(p.name),
      undefined,
      undefined,
      p.initializer ? cloneNodeDeep(p.initializer) : undefined
    )
  );
  const body = stripCommentsDeep(cloneNodeDeep(fn.body));
  const arrow = f.createArrowFunction(
    undefined,
    undefined,
    params,
    undefined,
    f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    ts.isBlock(body) || !ts.isObjectLiteralExpression(body)
      ? (body as ts.ConciseBody)
      : f.createParenthesizedExpression(body)
  );
  return f.createCallExpression(
    f.createParenthesizedExpression(arrow),
    undefined,
    callArgs.map((a) => cloneNodeDeep(a))
  );
}

/** `(() => { ...statements })()` */
function createIIFE(ctx: MacroContext, statements: ts.Statement[]): ts.Expression {
  const arrowFn = ctx.factory.createArrowFunction(
    undefined,
    undefined,
    [],
    undefined,
    ctx.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    ctx.factory.createBlock(statements, true)
  );
  return ctx.factory.createCallExpression(
    ctx.factory.createParenthesizedExpression(arrowFn),
    undefined,
    []
  );
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
  // Prologue statements are wrapped in an arrow IIFE, which can't hold the
  // enclosing function's own `await`/`yield`.
  let suspends = false;
  walkNode(body, TOP_LEVEL_STATE, { suspend: () => (suspends = true) });
  if (suspends) return undefined;

  return flattenStatementList(ctx, body.statements);
}

/**
 * Flatten a statement list that ends in a return into one expression,
 * preserving evaluation order (tc#4):
 *
 * - `return expr;` → terminal expression
 * - `if (cond) return a;` (guard) / `if … else …` → nested ternary
 * - `const` bindings and expression statements → an IIFE prologue placed at
 *   the position they appear, i.e. only on the path that reaches them:
 *   `if (a == null) return 0; const n = a.length; return n;` becomes
 *   `a == null ? 0 : (() => { const n = a.length; return n; })()` — the
 *   binding is never hoisted above its guard, and side-effecting statements
 *   are kept rather than dropped.
 */
function flattenStatementList(
  ctx: MacroContext,
  statements: readonly ts.Statement[]
): ts.Expression | undefined {
  let result: ts.Expression | undefined;
  let prologue: ts.Statement[] = []; // collected in reverse
  const flushPrologue = (): void => {
    if (prologue.length === 0 || result === undefined) return;
    result = createIIFE(ctx, [...prologue.reverse(), ctx.factory.createReturnStatement(result)]);
    prologue = [];
  };

  for (let i = statements.length - 1; i >= 0; i--) {
    const stmt = statements[i];
    if (ts.isReturnStatement(stmt)) {
      // Anything after a return is unreachable — not a shape we flatten.
      if (result !== undefined || prologue.length > 0) return undefined;
      result = stmt.expression ?? ctx.factory.createIdentifier("undefined");
    } else if (
      (ts.isVariableStatement(stmt) && (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0) ||
      ts.isExpressionStatement(stmt)
    ) {
      // Must be followed by the code that produces the value.
      if (result === undefined) return undefined;
      prologue.push(stmt);
    } else if (ts.isIfStatement(stmt)) {
      flushPrologue();
      const flattened = flattenIfStatement(ctx, stmt, result);
      if (!flattened) return undefined;
      result = flattened;
    } else {
      return undefined;
    }
  }
  flushPrologue();
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
  if (ts.isReturnStatement(branch)) {
    return branch.expression ?? ctx.factory.createIdentifier("undefined");
  }
  if (ts.isBlock(branch)) {
    return flattenStatementList(ctx, branch.statements);
  }
  if (ts.isIfStatement(branch)) {
    return flattenIfStatement(ctx, branch, undefined);
  }
  return undefined;
}

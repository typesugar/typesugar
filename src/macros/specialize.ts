/**
 * specialize macro — Zero-cost typeclass abstraction via compile-time inlining
 *
 * The core philosophy of typemacro is zero-cost abstractions: you write generic,
 * typeclass-polymorphic code, and the macro system eliminates the abstraction
 * overhead at compile time — no dictionary passing, no indirect dispatch, no
 * closure allocation at runtime.
 *
 * ## How it works
 *
 * `specialize` is an expression macro that takes a generic function and a
 * concrete typeclass dictionary, and produces a specialized version where all
 * dictionary method calls are inlined.
 *
 * ```typescript
 * // Generic (has runtime cost: dictionary passing, indirect dispatch)
 * function double<F>(F: Functor<F>, fa: Kind<F, number>): Kind<F, number> {
 *   return F.map(fa, x => x * 2);
 * }
 *
 * // Specialized (zero cost: direct call, no dictionary)
 * const doubleArray = specialize(double, arrayFunctor);
 * // Expands to: (fa: number[]) => fa.map(x => x * 2)
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
 * ## What gets specialized
 *
 * - `specialize(fn, dict)` — Specialize a named function with a dictionary
 * - `specialize$(expr, dict)` — Specialize an inline expression/lambda
 * - `Functor.map$(arrayFunctor, fa, f)` — Direct specialized call (no wrapper)
 *
 * @module
 */

import * as ts from "typescript";
import { defineExpressionMacro, globalRegistry } from "../core/registry.js";
import { MacroContext } from "../core/types.js";
import { MacroContextImpl, markPure } from "../core/context.js";
import { HygieneContext } from "../core/hygiene.js";

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

/**
 * Check if a type name has a registered Result algebra.
 */
export function hasResultAlgebra(typeName: string): boolean {
  return resultAlgebraRegistry.has(typeName);
}

/**
 * Get all registered Result algebras.
 */
export function getAllResultAlgebras(): ResultAlgebra[] {
  // Return unique algebras (same algebra may be registered under multiple type names)
  const seen = new Set<string>();
  const algebras: ResultAlgebra[] = [];
  for (const algebra of resultAlgebraRegistry.values()) {
    if (!seen.has(algebra.name)) {
      seen.add(algebra.name);
      algebras.push(algebra);
    }
  }
  return algebras;
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
 * Unsafe algebra: ok(v) -> v, err(e) -> throw new Error(String(e))
 *
 * Specializes Result<E, T> to bare T.
 * Errors are converted to thrown exceptions.
 */
export const unsafeResultAlgebra: ResultAlgebra = {
  name: "Unsafe",
  targetTypes: [], // Bare T doesn't have a specific type name; detected by exclusion
  rewriteOk: (_ctx, value) => value,
  rewriteErr: (ctx, error) =>
    ctx.factory.createCallExpression(
      ctx.factory.createParenthesizedExpression(
        ctx.factory.createArrowFunction(
          undefined,
          undefined,
          [],
          undefined,
          ctx.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
          ctx.factory.createBlock(
            [
              ctx.factory.createThrowStatement(
                ctx.factory.createNewExpression(ctx.factory.createIdentifier("Error"), undefined, [
                  ctx.factory.createCallExpression(
                    ctx.factory.createIdentifier("String"),
                    undefined,
                    [error]
                  ),
                ])
              ),
            ],
            true
          )
        )
      ),
      undefined,
      []
    ),
  preservesError: false,
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
registerResultAlgebra(optionResultAlgebra);
registerResultAlgebra(eitherResultAlgebra);
registerResultAlgebra(promiseResultAlgebra);
// Note: unsafeResultAlgebra is not registered by default as it has no specific target type
// It's used as a fallback when the target type is the success type (bare T)

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
  /** The implementation as source code (for inlining) - used as fallback */
  source?: string;
  /** The implementation as an AST node (preferred for direct substitution) */
  node?: ts.Expression;
  /** Parameter names for the method */
  params: string[];
}

/**
 * Registry of known typeclass instances and their method implementations.
 * This is the compile-time knowledge base that enables specialization.
 */
const instanceMethodRegistry = new Map<string, DictMethodMap>();

/**
 * Register a typeclass instance's methods for specialization using source strings.
 * Called at macro registration time for built-in instances.
 *
 * Prefer `registerInstanceMethodsFromAST` when AST nodes are available.
 */
export function registerInstanceMethods(
  dictName: string,
  brand: string,
  methods: Record<string, { source: string; params: string[] }>
): void {
  const methodMap = new Map<string, DictMethod>();
  for (const [name, info] of Object.entries(methods)) {
    methodMap.set(name, { source: info.source, params: info.params });
  }
  instanceMethodRegistry.set(dictName, { brand, methods: methodMap });
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
  methods: Map<string, DictMethod>
): void {
  instanceMethodRegistry.set(dictName, { brand, methods });
}

/**
 * Extract method implementations from an object literal expression.
 * Used by @instance and @deriving to register instances for specialization.
 *
 * @param objLiteral - The object literal containing method implementations
 * @param hygiene - Optional hygiene context for generating safe placeholder names
 * @returns A map of method names to their DictMethod info
 */
export function extractMethodsFromObjectLiteral(
  objLiteral: ts.ObjectLiteralExpression,
  hygiene?: HygieneContext
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
      // Can't extract the implementation from shorthand - skip
      continue;
    }
  }

  return methods;
}

/**
 * Get the method map for a known dictionary.
 */
export function getInstanceMethods(dictName: string): DictMethodMap | undefined {
  return instanceMethodRegistry.get(dictName);
}

/**
 * Check if a name is a registered instance dictionary.
 */
export function isRegisteredInstance(name: string): boolean {
  return instanceMethodRegistry.has(name);
}

/**
 * Get all registered instance dictionary names.
 */
export function getRegisteredInstanceNames(): string[] {
  return Array.from(instanceMethodRegistry.keys());
}

// ============================================================================
// Core Specialization Logic (shared by macro and extension method)
// ============================================================================

/**
 * Options for creating a specialized function.
 */
export interface SpecializeOptions {
  /** The function expression to specialize */
  fnExpr: ts.Expression;
  /** Dictionary expressions (the typeclass instances) */
  dictExprs: readonly ts.Expression[];
  /** Original call expression (for error reporting) */
  callExpr: ts.CallExpression;
  /** Whether to suppress warning diagnostics */
  suppressWarnings?: boolean;
}

/**
 * Create a specialized function by removing dictionary parameters and inlining
 * dictionary method calls. This is the core logic shared by both the specialize()
 * macro and the fn.specialize() extension method.
 *
 * @returns The specialized function expression, or a fallback partial application
 */
export function createSpecializedFunction(
  ctx: MacroContext,
  options: SpecializeOptions
): ts.Expression {
  const { fnExpr, dictExprs, callExpr, suppressWarnings = false } = options;
  const fnName = getFunctionDisplayName(fnExpr);

  // Resolve all dictionaries
  const resolvedDicts: ResolvedDict[] = [];
  const unresolvedDicts: string[] = [];

  for (const dictArg of dictExprs) {
    const dictName = getDictName(dictArg);
    const dictMethods = dictName ? instanceMethodRegistry.get(dictName) : undefined;

    if (dictMethods) {
      resolvedDicts.push({
        name: dictName!,
        methods: dictMethods,
        argExpr: dictArg,
      });
    } else if (dictName) {
      unresolvedDicts.push(dictName);
    } else {
      unresolvedDicts.push("<unknown>");
    }
  }

  // If no dictionaries were resolved, fall back to partial application with the first dict
  if (resolvedDicts.length === 0) {
    if (!suppressWarnings) {
      const dictNames = unresolvedDicts.join(", ");
      ctx.reportWarning(
        callExpr,
        `[TS9601] specialize(${fnName}): falling back to dictionary passing — ` +
          `dictionary '${dictNames}' not registered. ` +
          `Help: Register with @instance or registerInstanceMethods()`
      );
    }
    return createPartialApplication(ctx, fnExpr, dictExprs[0], callExpr);
  }

  // Try to resolve the function body for full inlining
  const fnBody = resolveFunctionBody(ctx, fnExpr);
  if (fnBody) {
    // Check if the function body can be inlined
    const body = ts.isFunctionDeclaration(fnBody) ? fnBody.body : fnBody.body;

    if (body && ts.isBlock(body)) {
      const classification = classifyInlineFailureDetailed(body);
      // Only warn if there's a failure reason AND it's not flattenable
      if (classification.reason && !classification.canFlatten && !suppressWarnings) {
        const help = getInlineFailureHelp(classification.reason);
        ctx.reportWarning(
          callExpr,
          `[TS9601] specialize(${fnName}): falling back to dictionary passing — ` +
            `${classification.reason}. Help: ${help}`
        );
      }
    }

    if (resolvedDicts.length === 1) {
      // Single dictionary - use the simpler path
      return specializeFunction(ctx, fnBody, resolvedDicts[0].methods, resolvedDicts[0].name);
    } else {
      // Multiple dictionaries
      return specializeFunctionMulti(ctx, fnBody, resolvedDicts);
    }
  }

  // Fallback: partial application with all known dicts
  if (!suppressWarnings) {
    ctx.reportWarning(
      callExpr,
      `[TS9601] specialize(${fnName}): falling back to dictionary passing — ` +
        `function body not resolvable. ` +
        `Help: Declare as 'const fn = (...) => ...' or named 'function'`
    );
  }
  return createPartialApplicationMulti(ctx, fnExpr, dictExprs, callExpr);
}

// ============================================================================
// Built-in instance registrations
// ============================================================================

// Register Array instances
registerInstanceMethods("arrayFunctor", "Array", {
  map: {
    source: "(fa, f) => fa.map(f)",
    params: ["fa", "f"],
  },
});

registerInstanceMethods("arrayMonad", "Array", {
  map: {
    source: "(fa, f) => fa.map(f)",
    params: ["fa", "f"],
  },
  pure: {
    source: "(a) => [a]",
    params: ["a"],
  },
  ap: {
    source: "(fab, fa) => fab.flatMap(f => fa.map(a => f(a)))",
    params: ["fab", "fa"],
  },
  flatMap: {
    source: "(fa, f) => fa.flatMap(f)",
    params: ["fa", "f"],
  },
});

registerInstanceMethods("arrayFoldable", "Array", {
  reduce: {
    source: "(fa, b, f) => fa.reduce(f, b)",
    params: ["fa", "b", "f"],
  },
  foldLeft: {
    source: "(fa, b, f) => fa.reduce(f, b)",
    params: ["fa", "b", "f"],
  },
  foldRight: {
    source: "(fa, b, f) => fa.reduceRight((acc, a) => f(a, acc), b)",
    params: ["fa", "b", "f"],
  },
});

// Register Promise instances
registerInstanceMethods("promiseFunctor", "Promise", {
  map: {
    source: "(fa, f) => fa.then(f)",
    params: ["fa", "f"],
  },
});

registerInstanceMethods("promiseMonad", "Promise", {
  map: {
    source: "(fa, f) => fa.then(f)",
    params: ["fa", "f"],
  },
  pure: {
    source: "(a) => Promise.resolve(a)",
    params: ["a"],
  },
  ap: {
    source: "(fab, fa) => fab.then(f => fa.then(a => f(a)))",
    params: ["fab", "fa"],
  },
  flatMap: {
    source: "(fa, f) => fa.then(f)",
    params: ["fa", "f"],
  },
});

// ============================================================================
// Option Instances - Zero-cost specialization for Option<A>
// ============================================================================

/**
 * Option instances provide zero-cost specialization by inlining null checks.
 *
 * Option<A> is now represented as A | null:
 * - Some(x) = x (the value itself)
 * - None = null
 *
 * When `specialize(fn, optionMonad)` is called, all `F.map(opt, f)` calls become:
 *   opt !== null ? f(opt) : null
 *
 * This is true zero-cost: no wrapper objects, no tag discrimination.
 */
registerInstanceMethods("optionFunctor", "Option", {
  map: {
    source: "(fa, f) => fa !== null ? f(fa) : null",
    params: ["fa", "f"],
  },
});

registerInstanceMethods("optionMonad", "Option", {
  map: {
    source: "(fa, f) => fa !== null ? f(fa) : null",
    params: ["fa", "f"],
  },
  pure: {
    source: "(a) => a",
    params: ["a"],
  },
  ap: {
    source: "(fab, fa) => fab !== null && fa !== null ? fab(fa) : null",
    params: ["fab", "fa"],
  },
  flatMap: {
    source: "(fa, f) => fa !== null ? f(fa) : null",
    params: ["fa", "f"],
  },
});

registerInstanceMethods("optionFoldable", "Option", {
  foldLeft: {
    source: "(fa, b, f) => fa !== null ? f(b, fa) : b",
    params: ["fa", "b", "f"],
  },
  foldRight: {
    source: "(fa, b, f) => fa !== null ? f(fa, b) : b",
    params: ["fa", "b", "f"],
  },
});

registerInstanceMethods("optionSemigroupK", "Option", {
  combineK: {
    source: "(x, y) => x !== null ? x : y",
    params: ["x", "y"],
  },
});

// ============================================================================
// Either Instances - Zero-cost specialization for Either<E, A>
// ============================================================================

/**
 * Either instances provide zero-cost specialization by inlining pattern matches.
 */
registerInstanceMethods("eitherFunctor", "Either", {
  map: {
    source: '(fa, f) => fa._tag === "Right" ? { _tag: "Right", right: f(fa.right) } : fa',
    params: ["fa", "f"],
  },
});

registerInstanceMethods("eitherMonad", "Either", {
  map: {
    source: '(fa, f) => fa._tag === "Right" ? { _tag: "Right", right: f(fa.right) } : fa',
    params: ["fa", "f"],
  },
  pure: {
    source: '(a) => ({ _tag: "Right", right: a })',
    params: ["a"],
  },
  ap: {
    source:
      '(fab, fa) => fab._tag === "Right" && fa._tag === "Right" ? { _tag: "Right", right: fab.right(fa.right) } : fab._tag === "Left" ? fab : fa',
    params: ["fab", "fa"],
  },
  flatMap: {
    source: '(fa, f) => fa._tag === "Right" ? f(fa.right) : fa',
    params: ["fa", "f"],
  },
});

registerInstanceMethods("eitherFoldable", "Either", {
  foldLeft: {
    source: '(fa, b, f) => fa._tag === "Right" ? f(b, fa.right) : b',
    params: ["fa", "b", "f"],
  },
  foldRight: {
    source: '(fa, b, f) => fa._tag === "Right" ? f(fa.right, b) : b',
    params: ["fa", "b", "f"],
  },
});

registerInstanceMethods("eitherBifunctor", "Either", {
  bimap: {
    source:
      '(fa, f, g) => fa._tag === "Left" ? { _tag: "Left", left: f(fa.left) } : { _tag: "Right", right: g(fa.right) }',
    params: ["fa", "f", "g"],
  },
  mapLeft: {
    source: '(fa, f) => fa._tag === "Left" ? { _tag: "Left", left: f(fa.left) } : fa',
    params: ["fa", "f"],
  },
});

// ============================================================================
// Std FlatMap Instances - For @typesugar/std let:/yield: macro
// ============================================================================

/**
 * FlatMap instances from @typesugar/std, registered for specialize() support.
 * These are the same implementations used by the let:/yield: macro.
 *
 * stdFlatMapArray and stdFlatMapPromise mirror the arrayMonad/promiseMonad
 * implementations but are named distinctly for clarity when working with
 * the FlatMap typeclass specifically.
 */

// FlatMap instance for Array — uses native Array methods
registerInstanceMethods("stdFlatMapArray", "Array", {
  map: {
    source: "(fa, f) => fa.map(f)",
    params: ["fa", "f"],
  },
  flatMap: {
    source: "(fa, f) => fa.flatMap(f)",
    params: ["fa", "f"],
  },
});

// Also register under the canonical names used in @typesugar/std
registerInstanceMethods("flatMapArray", "Array", {
  map: {
    source: "(fa, f) => fa.map(f)",
    params: ["fa", "f"],
  },
  flatMap: {
    source: "(fa, f) => fa.flatMap(f)",
    params: ["fa", "f"],
  },
});

// FlatMap instance for Promise — uses Promise.then for both operations
registerInstanceMethods("stdFlatMapPromise", "Promise", {
  map: {
    source: "(fa, f) => fa.then(f)",
    params: ["fa", "f"],
  },
  flatMap: {
    source: "(fa, f) => fa.then(f)",
    params: ["fa", "f"],
  },
});

registerInstanceMethods("flatMapPromise", "Promise", {
  map: {
    source: "(fa, f) => fa.then(f)",
    params: ["fa", "f"],
  },
  flatMap: {
    source: "(fa, f) => fa.then(f)",
    params: ["fa", "f"],
  },
});

// FlatMap instance for Iterable — uses generator functions for lazy evaluation
registerInstanceMethods("stdFlatMapIterable", "Iterable", {
  map: {
    source: "(fa, f) => (function* () { for (const a of fa) yield f(a); })()",
    params: ["fa", "f"],
  },
  flatMap: {
    source: "(fa, f) => (function* () { for (const a of fa) yield* f(a); })()",
    params: ["fa", "f"],
  },
});

registerInstanceMethods("flatMapIterable", "Iterable", {
  map: {
    source: "(fa, f) => (function* () { for (const a of fa) yield f(a); })()",
    params: ["fa", "f"],
  },
  flatMap: {
    source: "(fa, f) => (function* () { for (const a of fa) yield* f(a); })()",
    params: ["fa", "f"],
  },
});

// FlatMap instance for AsyncIterable — uses async generator functions
registerInstanceMethods("stdFlatMapAsyncIterable", "AsyncIterable", {
  map: {
    source: "(fa, f) => (async function* () { for await (const a of fa) yield f(a); })()",
    params: ["fa", "f"],
  },
  flatMap: {
    source: "(fa, f) => (async function* () { for await (const a of fa) yield* f(a); })()",
    params: ["fa", "f"],
  },
});

registerInstanceMethods("flatMapAsyncIterable", "AsyncIterable", {
  map: {
    source: "(fa, f) => (async function* () { for await (const a of fa) yield f(a); })()",
    params: ["fa", "f"],
  },
  flatMap: {
    source: "(fa, f) => (async function* () { for await (const a of fa) yield* f(a); })()",
    params: ["fa", "f"],
  },
});

// ============================================================================
// specialize expression macro
// ============================================================================

/**
 * Information about a resolved dictionary for multi-dictionary specialization.
 */
interface ResolvedDict {
  name: string;
  methods: DictMethodMap;
  argExpr: ts.Expression;
}

/**
 * specialize(fn, dict1, dict2?, ...) — Produce a specialized version of a generic function.
 *
 * At compile time, this:
 * 1. Resolves each dictionary to its known method implementations
 * 2. Removes the dictionary parameters from the function
 * 3. Replaces all `Dict.method(...)` calls with direct implementations
 * 4. Returns the specialized function
 *
 * Supports multiple dictionaries for functions that need several typeclasses:
 *   specialize(sortAndShow, ordNumber, showNumber)
 *
 * If a dictionary is not known at compile time, falls back to partial
 * application: `(...args) => fn(dict, ...args)`.
 */
/**
 * Check if a call expression has an opt-out comment for specialization warnings.
 */
function hasSpecializeWarnOptOut(callExpr: ts.CallExpression, sourceFile: ts.SourceFile): boolean {
  // Synthetic nodes can't be checked
  if (callExpr.pos === -1 || callExpr.end === -1) return false;

  const sourceText = sourceFile.text;
  const nodeStart = callExpr.getStart(sourceFile);
  const lineStart = sourceText.lastIndexOf("\n", nodeStart) + 1;
  const lineText = sourceText.slice(lineStart, nodeStart);

  return lineText.includes("@no-specialize-warn");
}

/**
 * Get a display name for a function expression (for diagnostic messages).
 */
function getFunctionDisplayName(fnArg: ts.Expression): string {
  if (ts.isIdentifier(fnArg)) {
    return fnArg.text;
  }
  if (ts.isPropertyAccessExpression(fnArg)) {
    return fnArg.name.text;
  }
  return "<anonymous>";
}

export const specializeMacro = defineExpressionMacro({
  name: "specialize",
  module: "typemacro",
  description: "Specialize a generic function by inlining typeclass dictionaries at compile time",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    if (args.length < 2) {
      ctx.reportError(
        callExpr,
        "specialize expects at least 2 arguments: specialize(fn, dict, ...)"
      );
      return callExpr;
    }

    const fnArg = args[0];
    const dictArgs = args.slice(1);

    // Check for opt-out comment
    const suppressWarnings = hasSpecializeWarnOptOut(callExpr, ctx.sourceFile);

    // Use the shared core logic
    return createSpecializedFunction(ctx, {
      fnExpr: fnArg,
      dictExprs: dictArgs,
      callExpr,
      suppressWarnings,
    });
  },
});

// ============================================================================
// specialize$ expression macro — inline specialization of expressions
// ============================================================================

/**
 * specialize$(dict, expr) — Specialize an expression by replacing dictionary
 * method calls inline.
 *
 * ```typescript
 * // Before:
 * const result = specialize$(arrayMonad, F => F.map([1,2,3], x => x * 2));
 *
 * // After:
 * const result = [1,2,3].map(x => x * 2);
 * ```
 */
export const specializeInlineMacro = defineExpressionMacro({
  name: "specialize$",
  module: "typemacro",
  description: "Inline-specialize an expression by replacing dictionary method calls",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    if (args.length !== 2) {
      ctx.reportError(callExpr, "specialize$ expects 2 arguments: specialize$(dict, expr)");
      return callExpr;
    }

    const [dictArg, exprArg] = args;
    const dictName = getDictName(dictArg);
    const dictMethods = dictName ? instanceMethodRegistry.get(dictName) : undefined;

    if (!dictMethods) {
      // Can't specialize — just call the lambda with the dict
      if (ts.isArrowFunction(exprArg) || ts.isFunctionExpression(exprArg)) {
        return ctx.factory.createCallExpression(exprArg, undefined, [dictArg]);
      }
      return callExpr;
    }

    // If the expression is a lambda `F => body`, specialize the body
    if (ts.isArrowFunction(exprArg) && exprArg.parameters.length === 1) {
      const dictParamName = exprArg.parameters[0].name.getText();
      const body = ts.isBlock(exprArg.body) ? exprArg.body : exprArg.body;
      return rewriteDictCalls(ctx, body, dictParamName, dictMethods);
    }

    return callExpr;
  },
});

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract the name of a dictionary expression (identifier or property access).
 */
function getDictName(expr: ts.Expression): string | undefined {
  if (ts.isIdentifier(expr)) {
    return expr.text;
  }
  if (ts.isPropertyAccessExpression(expr)) {
    return expr.getText();
  }
  // Handle `X as any` casts
  if (ts.isAsExpression(expr)) {
    return getDictName(expr.expression);
  }
  return undefined;
}

/** Known typeclass names that indicate a dictionary parameter */
const TYPECLASS_NAMES = new Set([
  "Functor",
  "Apply",
  "Applicative",
  "FlatMap",
  "Monad",
  "Foldable",
  "Traverse",
  "Semigroup",
  "Monoid",
  "SemigroupK",
  "MonoidK",
  "Alternative",
  "MonadError",
  "ApplicativeError",
  "Eq",
  "Ord",
  "Show",
  "Hash",
  "Bifunctor",
  "Contravariant",
  "Profunctor",
]);

/**
 * Find the dictionary parameter by analyzing parameter types.
 * Returns the index and type parameter name of the dictionary parameter,
 * or undefined if no typeclass parameter is found.
 */
function findDictParamByType(
  ctx: MacroContext,
  params: readonly ts.ParameterDeclaration[],
  dictMethods: DictMethodMap
): { index: number; typeParamName: string | undefined } | undefined {
  for (let i = 0; i < params.length; i++) {
    const param = params[i];
    const typeNode = param.type;

    if (!typeNode) continue;

    // Check if this parameter's type is a known typeclass
    if (ts.isTypeReferenceNode(typeNode)) {
      const typeName = typeNode.typeName.getText();

      // Check against known typeclass names
      if (TYPECLASS_NAMES.has(typeName)) {
        const typeParamName = extractTypeParamFromDictType(typeNode);
        return { index: i, typeParamName };
      }

      // Also check if the type matches the registered brand in some way
      // This helps with custom typeclasses
      const typeArgs = typeNode.typeArguments;
      if (typeArgs && typeArgs.length > 0) {
        // Use the type checker to get more info about this type
        try {
          const type = ctx.typeChecker.getTypeFromTypeNode(typeNode);
          const props = ctx.typeChecker.getPropertiesOfType(type);

          // Check if this type has methods that match our dictionary's methods
          const methodNames = new Set(dictMethods.methods.keys());
          let matchCount = 0;

          for (const prop of props) {
            if (methodNames.has(prop.name)) {
              matchCount++;
            }
          }

          // If most of the dictionary methods are present, this is likely our dict
          if (matchCount >= Math.min(2, methodNames.size)) {
            const typeParamName = extractTypeParamFromDictType(typeNode);
            return { index: i, typeParamName };
          }
        } catch {
          // Type checker failed, continue checking other params
        }
      }
    }
  }

  return undefined;
}

/**
 * Try to resolve a function argument to its body AST.
 * Works for:
 * - Arrow functions passed directly
 * - Function expressions passed directly
 * - Identifiers referencing const declarations with function values
 */
function resolveFunctionBody(
  ctx: MacroContext,
  fnExpr: ts.Expression
): ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration | undefined {
  // Direct arrow/function expression
  if (ts.isArrowFunction(fnExpr) || ts.isFunctionExpression(fnExpr)) {
    return fnExpr;
  }

  // Identifier — resolve to declaration
  if (ts.isIdentifier(fnExpr)) {
    const symbol = ctx.typeChecker.getSymbolAtLocation(fnExpr);
    if (!symbol) return undefined;

    const declarations = symbol.getDeclarations();
    if (!declarations || declarations.length === 0) return undefined;

    for (const decl of declarations) {
      // const fn = (...) => { ... }
      if (ts.isVariableDeclaration(decl) && decl.initializer) {
        if (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) {
          return decl.initializer;
        }
      }
      // function fn(...) { ... }
      if (ts.isFunctionDeclaration(decl)) {
        return decl;
      }
    }
  }

  return undefined;
}

/**
 * Specialize a function by removing the dictionary parameter and inlining
 * dictionary method calls.
 */
function specializeFunction(
  ctx: MacroContext,
  fn: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration,
  dictMethods: DictMethodMap,
  dictName: string
): ts.Expression {
  const params = Array.from(fn.parameters);

  if (params.length === 0) {
    ctx.reportError(fn, "Cannot specialize a function with no parameters");
    return fn as ts.Expression;
  }

  // Find the dictionary parameter by type (not assuming first position)
  const dictParamInfo = findDictParamByType(ctx, params, dictMethods);

  // Fall back to first parameter if type-based detection fails
  const dictParamIndex = dictParamInfo?.index ?? 0;
  const dictParam = params[dictParamIndex];
  const dictParamName = dictParam.name.getText();
  const typeParamName =
    dictParamInfo?.typeParamName ?? extractTypeParamFromDictType(dictParam.type);

  // Remove the dictionary parameter, keeping all others
  const remainingParams = params.filter((_, i) => i !== dictParamIndex);

  // Get the function body
  const body = ts.isFunctionDeclaration(fn) ? fn.body : fn.body;
  if (!body) {
    return fn as ts.Expression;
  }

  // Rewrite dictionary calls in the body
  const specializedBody = rewriteDictCalls(ctx, body, dictParamName, dictMethods);

  // Create a new arrow function without the dictionary parameter
  if (remainingParams.length === 0) {
    // No remaining params — return the body directly if it's an expression
    if (ts.isExpression(specializedBody)) {
      return specializedBody;
    }
  }

  // Transform type annotations: replace Kind<F, A> with concrete types
  const cleanParams = remainingParams.map((p) => {
    const narrowedType = p.type
      ? narrowKindType(ctx, p.type, typeParamName, dictMethods.brand)
      : undefined;

    return ctx.factory.createParameterDeclaration(
      undefined,
      p.dotDotDotToken,
      p.name,
      p.questionToken,
      narrowedType,
      p.initializer
    );
  });

  // Also narrow the return type if present
  let narrowedReturnType: ts.TypeNode | undefined;
  if (ts.isArrowFunction(fn) && fn.type) {
    narrowedReturnType = narrowKindType(ctx, fn.type, typeParamName, dictMethods.brand);
  } else if (ts.isFunctionExpression(fn) && fn.type) {
    narrowedReturnType = narrowKindType(ctx, fn.type, typeParamName, dictMethods.brand);
  } else if (ts.isFunctionDeclaration(fn) && fn.type) {
    narrowedReturnType = narrowKindType(ctx, fn.type, typeParamName, dictMethods.brand);
  }

  return markPure(
    ctx.factory.createArrowFunction(
      undefined,
      undefined,
      cleanParams,
      narrowedReturnType,
      ctx.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      specializedBody as ts.ConciseBody
    )
  );
}

/**
 * Extract the type parameter name from a dictionary type annotation.
 * e.g., for `Functor<F>`, returns "F"
 */
function extractTypeParamFromDictType(typeNode: ts.TypeNode | undefined): string | undefined {
  if (!typeNode) return undefined;

  if (ts.isTypeReferenceNode(typeNode)) {
    // Check for type arguments like Functor<F>, Monad<M>, etc.
    const typeArgs = typeNode.typeArguments;
    if (typeArgs && typeArgs.length > 0) {
      const firstArg = typeArgs[0];
      if (ts.isTypeReferenceNode(firstArg)) {
        return firstArg.typeName.getText();
      }
    }
  }

  return undefined;
}

/**
 * Transform a type node by replacing Kind<F, A> with the concrete type.
 * e.g., Kind<F, number> with brand="Array" becomes Array<number>
 */
function narrowKindType(
  ctx: MacroContext,
  typeNode: ts.TypeNode,
  typeParamName: string | undefined,
  brand: string
): ts.TypeNode {
  // Visit the type node and transform Kind references
  function visit(node: ts.Node): ts.Node {
    if (ts.isTypeReferenceNode(node)) {
      const typeName = node.typeName.getText();

      // Check for Kind<F, A> or Kind2<F, E, A> patterns
      if ((typeName === "Kind" || typeName === "Kind2") && node.typeArguments) {
        const args = node.typeArguments;

        // Kind<F, A> - replace if F matches the type parameter
        if (typeName === "Kind" && args.length >= 2) {
          const fArg = args[0];
          if (
            ts.isTypeReferenceNode(fArg) &&
            (!typeParamName || fArg.typeName.getText() === typeParamName)
          ) {
            // Replace with concrete type: brand<A>
            // e.g., Array<number>
            const innerTypeArg = ts.visitNode(args[1], visit) as ts.TypeNode;
            return ctx.factory.createTypeReferenceNode(ctx.factory.createIdentifier(brand), [
              innerTypeArg,
            ]);
          }
        }

        // Kind2<F, E, A> - replace if F matches
        if (typeName === "Kind2" && args.length >= 3) {
          const fArg = args[0];
          if (
            ts.isTypeReferenceNode(fArg) &&
            (!typeParamName || fArg.typeName.getText() === typeParamName)
          ) {
            // Replace with concrete type: brand<E, A>
            // e.g., Either<string, number>
            const eArg = ts.visitNode(args[1], visit) as ts.TypeNode;
            const aArg = ts.visitNode(args[2], visit) as ts.TypeNode;
            return ctx.factory.createTypeReferenceNode(ctx.factory.createIdentifier(brand), [
              eArg,
              aArg,
            ]);
          }
        }
      }

      // Check if this is the type parameter itself (e.g., just "F")
      // In some cases, the type param appears raw and should be replaced with the brand
      if (typeParamName && typeName === typeParamName) {
        return ctx.factory.createTypeReferenceNode(
          ctx.factory.createIdentifier(brand),
          node.typeArguments
            ? (node.typeArguments.map((a) => ts.visitNode(a, visit)) as ts.TypeNode[])
            : undefined
        );
      }
    }

    return ts.visitEachChild(node, visit, ctx.transformContext);
  }

  return ts.visitNode(typeNode, visit) as ts.TypeNode;
}

/** Maximum recursion depth for transitive specialization */
const MAX_SPECIALIZATION_DEPTH = 5;

/**
 * Rewrite all dictionary method calls in an AST subtree.
 *
 * Transforms patterns like:
 *   F.map(fa, f)     → fa.map(f)           (for Array)
 *   F.flatMap(fa, f)  → fa.flatMap(f)       (for Array)
 *   F.pure(a)         → [a]                 (for Array)
 *   F.map(fa, f)     → fa.then(f)          (for Promise)
 *
 * Also supports transitive specialization:
 *   innerFn(F, args...) → specialized_innerFn(args...)
 *   When a function receives the dictionary as its first argument, we recursively
 *   specialize that function and replace the call.
 */
function rewriteDictCalls(
  ctx: MacroContext,
  node: ts.Node,
  dictParamName: string,
  dictMethods: DictMethodMap,
  depth: number = 0
): ts.Expression {
  const ctxImpl = ctx as MacroContextImpl;

  function visit(n: ts.Node): ts.Node {
    // Match: dictParam.method(args...)
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ts.isIdentifier(n.expression.expression) &&
      n.expression.expression.text === dictParamName
    ) {
      const methodName = n.expression.name.text;
      const method = dictMethods.methods.get(methodName);

      if (method) {
        // Inline the method implementation
        const inlined = inlineMethod(ctx, method, Array.from(n.arguments));
        if (inlined) {
          return ts.visitEachChild(inlined, visit, ctx.transformContext);
        }
      }
    }

    // Transitive specialization: Match someFunction(..., dictParam, ...)
    // When we see a function call where the dictionary is passed as any argument,
    // try to recursively specialize that function
    if (ts.isCallExpression(n) && n.arguments.length > 0 && depth < MAX_SPECIALIZATION_DEPTH) {
      // Find which argument (if any) is the dictionary
      const dictArgIndex = n.arguments.findIndex(
        (arg) => ts.isIdentifier(arg) && arg.text === dictParamName
      );

      if (dictArgIndex !== -1) {
        const calledFn = resolveFunctionBody(ctx, n.expression);
        if (calledFn) {
          // Recursively specialize the inner function
          const innerSpecialized = specializeFunctionTransitive(
            ctx,
            calledFn,
            dictMethods,
            depth + 1
          );

          if (innerSpecialized) {
            // Replace the call with: specializedFn(argsWithoutDict...)
            const remainingArgs = n.arguments.filter((_, i) => i !== dictArgIndex);
            const visitedArgs = remainingArgs.map(
              (arg) => ts.visitNode(arg, visit) as ts.Expression
            );

            return ctx.factory.createCallExpression(innerSpecialized, n.typeArguments, visitedArgs);
          }
        }
      }
    }

    return ts.visitEachChild(n, visit, ctx.transformContext);
  }

  const result = ts.visitNode(node, visit);
  return result as ts.Expression;
}

/**
 * Specialize a function for transitive specialization (called recursively).
 * Similar to specializeFunction but tracks depth to prevent infinite recursion.
 */
function specializeFunctionTransitive(
  ctx: MacroContext,
  fn: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration,
  dictMethods: DictMethodMap,
  depth: number
): ts.Expression | undefined {
  const params = Array.from(fn.parameters);

  if (params.length === 0) {
    return undefined;
  }

  // Find the dictionary parameter by type
  const dictParamInfo = findDictParamByType(ctx, params, dictMethods);
  const dictParamIndex = dictParamInfo?.index ?? 0;
  const dictParam = params[dictParamIndex];
  const dictParamName = dictParam.name.getText();
  const typeParamName =
    dictParamInfo?.typeParamName ?? extractTypeParamFromDictType(dictParam.type);
  const remainingParams = params.filter((_, i) => i !== dictParamIndex);

  const body = ts.isFunctionDeclaration(fn) ? fn.body : fn.body;
  if (!body) {
    return undefined;
  }

  // Recursively rewrite dictionary calls in the body, tracking depth
  const specializedBody = rewriteDictCalls(ctx, body, dictParamName, dictMethods, depth);

  if (remainingParams.length === 0) {
    if (ts.isExpression(specializedBody)) {
      return specializedBody;
    }
  }

  // Transform type annotations with narrowing
  const cleanParams = remainingParams.map((p) => {
    const narrowedType = p.type
      ? narrowKindType(ctx, p.type, typeParamName, dictMethods.brand)
      : undefined;

    return ctx.factory.createParameterDeclaration(
      undefined,
      p.dotDotDotToken,
      p.name,
      p.questionToken,
      narrowedType,
      p.initializer
    );
  });

  // Also narrow return type if present
  let narrowedReturnType: ts.TypeNode | undefined;
  if (ts.isArrowFunction(fn) && fn.type) {
    narrowedReturnType = narrowKindType(ctx, fn.type, typeParamName, dictMethods.brand);
  } else if (ts.isFunctionExpression(fn) && fn.type) {
    narrowedReturnType = narrowKindType(ctx, fn.type, typeParamName, dictMethods.brand);
  } else if (ts.isFunctionDeclaration(fn) && fn.type) {
    narrowedReturnType = narrowKindType(ctx, fn.type, typeParamName, dictMethods.brand);
  }

  return markPure(
    ctx.factory.createArrowFunction(
      undefined,
      undefined,
      cleanParams,
      narrowedReturnType,
      ctx.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      specializedBody as ts.ConciseBody
    )
  );
}

/**
 * Specialize a function with multiple typeclass dictionaries.
 *
 * For a function like:
 *   function sortAndShow<A>(Ord: Ord<A>, Show: Show<A>, xs: A[]): string
 *
 * With specialize(sortAndShow, ordNumber, showNumber), produces:
 *   (xs: number[]) => { ... with Ord.compare and Show.show inlined ... }
 */
function specializeFunctionMulti(
  ctx: MacroContext,
  fn: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration,
  dicts: ResolvedDict[]
): ts.Expression {
  const params = Array.from(fn.parameters);

  if (params.length === 0) {
    ctx.reportError(fn, "Cannot specialize a function with no parameters");
    return fn as ts.Expression;
  }

  // Find all dictionary parameters and build a map of param name -> dict methods
  const dictParamMap = new Map<
    string,
    { methods: DictMethodMap; typeParamName: string | undefined }
  >();
  const dictParamIndices = new Set<number>();

  // Try to match each resolved dict to a parameter
  for (const dict of dicts) {
    // Find a matching parameter by checking types
    for (let i = 0; i < params.length; i++) {
      if (dictParamIndices.has(i)) continue; // Already matched

      const param = params[i];
      const paramType = param.type;

      if (paramType && ts.isTypeReferenceNode(paramType)) {
        const typeName = paramType.typeName.getText();

        // Check if this param's type suggests it's a typeclass
        if (TYPECLASS_NAMES.has(typeName)) {
          // Use the type checker to verify the methods match
          try {
            const type = ctx.typeChecker.getTypeFromTypeNode(paramType);
            const props = ctx.typeChecker.getPropertiesOfType(type);
            const methodNames = new Set(dict.methods.methods.keys());

            let matchCount = 0;
            for (const prop of props) {
              if (methodNames.has(prop.name)) matchCount++;
            }

            if (matchCount >= Math.min(2, methodNames.size)) {
              const paramName = param.name.getText();
              const typeParamName = extractTypeParamFromDictType(paramType);
              dictParamMap.set(paramName, {
                methods: dict.methods,
                typeParamName,
              });
              dictParamIndices.add(i);
              break;
            }
          } catch {
            // Continue trying other params
          }
        }
      }
    }
  }

  // Fallback: if we couldn't match all dicts, try sequential assignment
  if (dictParamMap.size < dicts.length) {
    let dictIndex = 0;
    for (let i = 0; i < params.length && dictIndex < dicts.length; i++) {
      if (dictParamIndices.has(i)) continue;

      const param = params[i];
      const paramType = param.type;

      // Check if this looks like a typeclass parameter
      if (paramType && ts.isTypeReferenceNode(paramType)) {
        const typeName = paramType.typeName.getText();
        if (TYPECLASS_NAMES.has(typeName)) {
          const paramName = param.name.getText();
          const typeParamName = extractTypeParamFromDictType(paramType);
          dictParamMap.set(paramName, {
            methods: dicts[dictIndex].methods,
            typeParamName,
          });
          dictParamIndices.add(i);
          dictIndex++;
        }
      }
    }
  }

  // Get remaining parameters (those that aren't dictionaries)
  const remainingParams = params.filter((_, i) => !dictParamIndices.has(i));

  // Get the function body
  const body = ts.isFunctionDeclaration(fn) ? fn.body : fn.body;
  if (!body) {
    return fn as ts.Expression;
  }

  // Rewrite dictionary calls in the body for all dictionaries
  const specializedBody = rewriteDictCallsMulti(ctx, body, dictParamMap);

  // Create a new arrow function without the dictionary parameters
  if (remainingParams.length === 0) {
    if (ts.isExpression(specializedBody)) {
      return specializedBody;
    }
  }

  // Transform type annotations: narrow all Kind types
  // For multi-dict, we need to narrow based on all type params
  const cleanParams = remainingParams.map((p) => {
    let narrowedType = p.type;

    // Apply narrowing for each dictionary's type param
    if (narrowedType) {
      for (const [, dictInfo] of dictParamMap) {
        narrowedType = narrowKindType(
          ctx,
          narrowedType,
          dictInfo.typeParamName,
          dictInfo.methods.brand
        );
      }
    }

    return ctx.factory.createParameterDeclaration(
      undefined,
      p.dotDotDotToken,
      p.name,
      p.questionToken,
      narrowedType ?? undefined,
      p.initializer
    );
  });

  // Narrow return type
  let narrowedReturnType: ts.TypeNode | undefined;
  const fnType = ts.isArrowFunction(fn)
    ? fn.type
    : ts.isFunctionExpression(fn)
      ? fn.type
      : ts.isFunctionDeclaration(fn)
        ? fn.type
        : undefined;
  if (fnType) {
    narrowedReturnType = fnType;
    for (const [, dictInfo] of dictParamMap) {
      narrowedReturnType = narrowKindType(
        ctx,
        narrowedReturnType,
        dictInfo.typeParamName,
        dictInfo.methods.brand
      );
    }
  }

  return markPure(
    ctx.factory.createArrowFunction(
      undefined,
      undefined,
      cleanParams,
      narrowedReturnType,
      ctx.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      specializedBody as ts.ConciseBody
    )
  );
}

/**
 * Rewrite dictionary calls for multiple dictionaries.
 */
function rewriteDictCallsMulti(
  ctx: MacroContext,
  node: ts.Node,
  dictParamMap: Map<string, { methods: DictMethodMap; typeParamName: string | undefined }>
): ts.Expression {
  function visit(n: ts.Node): ts.Node {
    // Match: anyDictParam.method(args...) for any of our tracked dicts
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ts.isIdentifier(n.expression.expression)
    ) {
      const dictParamName = n.expression.expression.text;
      const dictInfo = dictParamMap.get(dictParamName);

      if (dictInfo) {
        const methodName = n.expression.name.text;
        const method = dictInfo.methods.methods.get(methodName);

        if (method) {
          const inlined = inlineMethod(ctx, method, Array.from(n.arguments));
          if (inlined) {
            return ts.visitEachChild(inlined, visit, ctx.transformContext);
          }
        }
      }
    }

    return ts.visitEachChild(n, visit, ctx.transformContext);
  }

  const result = ts.visitNode(node, visit);
  return result as ts.Expression;
}

/**
 * Create a partial application fallback for multiple dictionaries.
 */
function createPartialApplicationMulti(
  ctx: MacroContext,
  fnExpr: ts.Expression,
  dictExprs: readonly ts.Expression[],
  _callExpr: ts.CallExpression
): ts.Expression {
  const argsIdent = ctx.generateUniqueName("args");
  const argsParam = ctx.factory.createParameterDeclaration(
    undefined,
    ctx.factory.createToken(ts.SyntaxKind.DotDotDotToken),
    argsIdent,
    undefined,
    undefined,
    undefined
  );

  return markPure(
    ctx.factory.createArrowFunction(
      undefined,
      undefined,
      [argsParam],
      undefined,
      ctx.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      ctx.factory.createCallExpression(fnExpr, undefined, [
        ...dictExprs,
        ctx.factory.createSpreadElement(ctx.factory.createIdentifier(argsIdent.text)),
      ])
    )
  );
}

/**
 * Inline a dictionary method call with its concrete implementation.
 *
 * For a method like `(fa, f) => fa.map(f)` called with args `[myArr, myFn]`,
 * produces `myArr.map(myFn)`.
 *
 * Prefers using the AST node when available, falling back to source string parsing.
 */
function inlineMethod(
  ctx: MacroContext,
  method: DictMethod,
  callArgs: ts.Expression[]
): ts.Expression | undefined {
  const ctxImpl = ctx as MacroContextImpl;

  // Prefer AST node if available
  if (method.node) {
    return inlineFromNode(ctx, method.node, method.params, callArgs);
  }

  // Fall back to parsing source string
  if (method.source) {
    try {
      const methodExpr = ctxImpl.parseExpression(method.source);
      return inlineFromNode(ctx, methodExpr, method.params, callArgs);
    } catch {
      // Parse failed — skip inlining
      return undefined;
    }
  }

  return undefined;
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
 */
function substituteParams(
  ctx: MacroContext,
  node: ts.Node,
  substitutions: Map<string, ts.Expression>
): ts.Expression {
  function visit(n: ts.Node): ts.Node {
    // Replace identifier references to parameters
    if (ts.isIdentifier(n)) {
      const replacement = substitutions.get(n.text);
      if (replacement) {
        return replacement;
      }
    }
    return ts.visitEachChild(n, visit, ctx.transformContext);
  }

  const result = ts.visitNode(node, visit);
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

/**
 * Check if a block body can be flattened to an expression.
 * This is a quick check without performing the actual transformation.
 */
export function canFlattenToExpression(body: ts.Block): boolean {
  return analyzeForFlattening(body).canFlatten;
}

/**
 * Create a partial application as fallback when full specialization isn't possible.
 * `specialize(fn, dict)` → `(...args) => fn(dict, ...args)`
 */
function createPartialApplication(
  ctx: MacroContext,
  fnExpr: ts.Expression,
  dictExpr: ts.Expression,
  _callExpr: ts.CallExpression
): ts.Expression {
  const argsIdent = ctx.generateUniqueName("args");
  const argsParam = ctx.factory.createParameterDeclaration(
    undefined,
    ctx.factory.createToken(ts.SyntaxKind.DotDotDotToken),
    argsIdent,
    undefined,
    undefined,
    undefined
  );

  return markPure(
    ctx.factory.createArrowFunction(
      undefined,
      undefined,
      [argsParam],
      undefined,
      ctx.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      ctx.factory.createCallExpression(fnExpr, undefined, [
        dictExpr,
        ctx.factory.createSpreadElement(ctx.factory.createIdentifier(argsIdent.text)),
      ])
    )
  );
}

// ============================================================================
// Register macros
// ============================================================================

globalRegistry.register(specializeMacro);
globalRegistry.register(specializeInlineMacro);

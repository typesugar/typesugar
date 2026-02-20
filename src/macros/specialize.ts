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
import { MacroContextImpl } from "../core/context.js";
import { HygieneContext } from "../core/hygiene.js";

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
  methods: Record<string, { source: string; params: string[] }>,
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
  methods: Map<string, DictMethod>,
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
  hygiene?: HygieneContext,
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

      if (
        ts.isArrowFunction(initializer) ||
        ts.isFunctionExpression(initializer)
      ) {
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
export function getInstanceMethods(
  dictName: string,
): DictMethodMap | undefined {
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
    source:
      '(fa, f) => fa._tag === "Right" ? { _tag: "Right", right: f(fa.right) } : fa',
    params: ["fa", "f"],
  },
});

registerInstanceMethods("eitherMonad", "Either", {
  map: {
    source:
      '(fa, f) => fa._tag === "Right" ? { _tag: "Right", right: f(fa.right) } : fa',
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
    source:
      '(fa, f) => fa._tag === "Left" ? { _tag: "Left", left: f(fa.left) } : fa',
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
    source:
      "(fa, f) => (async function* () { for await (const a of fa) yield f(a); })()",
    params: ["fa", "f"],
  },
  flatMap: {
    source:
      "(fa, f) => (async function* () { for await (const a of fa) yield* f(a); })()",
    params: ["fa", "f"],
  },
});

registerInstanceMethods("flatMapAsyncIterable", "AsyncIterable", {
  map: {
    source:
      "(fa, f) => (async function* () { for await (const a of fa) yield f(a); })()",
    params: ["fa", "f"],
  },
  flatMap: {
    source:
      "(fa, f) => (async function* () { for await (const a of fa) yield* f(a); })()",
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
export const specializeMacro = defineExpressionMacro({
  name: "specialize",
  module: "typemacro",
  description:
    "Specialize a generic function by inlining typeclass dictionaries at compile time",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[],
  ): ts.Expression {
    if (args.length < 2) {
      ctx.reportError(
        callExpr,
        "specialize expects at least 2 arguments: specialize(fn, dict, ...)",
      );
      return callExpr;
    }

    const fnArg = args[0];
    const dictArgs = args.slice(1);

    // Resolve all dictionaries
    const resolvedDicts: ResolvedDict[] = [];
    for (const dictArg of dictArgs) {
      const dictName = getDictName(dictArg);
      const dictMethods = dictName
        ? instanceMethodRegistry.get(dictName)
        : undefined;

      if (dictMethods) {
        resolvedDicts.push({
          name: dictName!,
          methods: dictMethods,
          argExpr: dictArg,
        });
      }
    }

    // If no dictionaries were resolved, fall back to partial application with the first dict
    if (resolvedDicts.length === 0) {
      return createPartialApplication(ctx, fnArg, dictArgs[0], callExpr);
    }

    // Try to resolve the function body for full inlining
    const fnBody = resolveFunctionBody(ctx, fnArg);
    if (fnBody) {
      if (resolvedDicts.length === 1) {
        // Single dictionary - use the simpler path
        return specializeFunction(
          ctx,
          fnBody,
          resolvedDicts[0].methods,
          resolvedDicts[0].name,
        );
      } else {
        // Multiple dictionaries
        return specializeFunctionMulti(ctx, fnBody, resolvedDicts);
      }
    }

    // Fallback: partial application with all known dicts
    return createPartialApplicationMulti(ctx, fnArg, dictArgs, callExpr);
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
  description:
    "Inline-specialize an expression by replacing dictionary method calls",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[],
  ): ts.Expression {
    if (args.length !== 2) {
      ctx.reportError(
        callExpr,
        "specialize$ expects 2 arguments: specialize$(dict, expr)",
      );
      return callExpr;
    }

    const [dictArg, exprArg] = args;
    const dictName = getDictName(dictArg);
    const dictMethods = dictName
      ? instanceMethodRegistry.get(dictName)
      : undefined;

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
  dictMethods: DictMethodMap,
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
  fnExpr: ts.Expression,
):
  | ts.ArrowFunction
  | ts.FunctionExpression
  | ts.FunctionDeclaration
  | undefined {
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
        if (
          ts.isArrowFunction(decl.initializer) ||
          ts.isFunctionExpression(decl.initializer)
        ) {
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
  dictName: string,
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
    dictParamInfo?.typeParamName ??
    extractTypeParamFromDictType(dictParam.type);

  // Remove the dictionary parameter, keeping all others
  const remainingParams = params.filter((_, i) => i !== dictParamIndex);

  // Get the function body
  const body = ts.isFunctionDeclaration(fn) ? fn.body : fn.body;
  if (!body) {
    return fn as ts.Expression;
  }

  // Rewrite dictionary calls in the body
  const specializedBody = rewriteDictCalls(
    ctx,
    body,
    dictParamName,
    dictMethods,
  );

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
      p.initializer,
    );
  });

  // Also narrow the return type if present
  let narrowedReturnType: ts.TypeNode | undefined;
  if (ts.isArrowFunction(fn) && fn.type) {
    narrowedReturnType = narrowKindType(
      ctx,
      fn.type,
      typeParamName,
      dictMethods.brand,
    );
  } else if (ts.isFunctionExpression(fn) && fn.type) {
    narrowedReturnType = narrowKindType(
      ctx,
      fn.type,
      typeParamName,
      dictMethods.brand,
    );
  } else if (ts.isFunctionDeclaration(fn) && fn.type) {
    narrowedReturnType = narrowKindType(
      ctx,
      fn.type,
      typeParamName,
      dictMethods.brand,
    );
  }

  return ctx.factory.createArrowFunction(
    undefined,
    undefined,
    cleanParams,
    narrowedReturnType,
    ctx.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    specializedBody as ts.ConciseBody,
  );
}

/**
 * Extract the type parameter name from a dictionary type annotation.
 * e.g., for `Functor<F>`, returns "F"
 */
function extractTypeParamFromDictType(
  typeNode: ts.TypeNode | undefined,
): string | undefined {
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
  brand: string,
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
            return ctx.factory.createTypeReferenceNode(
              ctx.factory.createIdentifier(brand),
              [innerTypeArg],
            );
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
            return ctx.factory.createTypeReferenceNode(
              ctx.factory.createIdentifier(brand),
              [eArg, aArg],
            );
          }
        }
      }

      // Check if this is the type parameter itself (e.g., just "F")
      // In some cases, the type param appears raw and should be replaced with the brand
      if (typeParamName && typeName === typeParamName) {
        return ctx.factory.createTypeReferenceNode(
          ctx.factory.createIdentifier(brand),
          node.typeArguments
            ? (node.typeArguments.map((a) =>
                ts.visitNode(a, visit),
              ) as ts.TypeNode[])
            : undefined,
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
  depth: number = 0,
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
    if (
      ts.isCallExpression(n) &&
      n.arguments.length > 0 &&
      depth < MAX_SPECIALIZATION_DEPTH
    ) {
      // Find which argument (if any) is the dictionary
      const dictArgIndex = n.arguments.findIndex(
        (arg) => ts.isIdentifier(arg) && arg.text === dictParamName,
      );

      if (dictArgIndex !== -1) {
        const calledFn = resolveFunctionBody(ctx, n.expression);
        if (calledFn) {
          // Recursively specialize the inner function
          const innerSpecialized = specializeFunctionTransitive(
            ctx,
            calledFn,
            dictMethods,
            depth + 1,
          );

          if (innerSpecialized) {
            // Replace the call with: specializedFn(argsWithoutDict...)
            const remainingArgs = n.arguments.filter(
              (_, i) => i !== dictArgIndex,
            );
            const visitedArgs = remainingArgs.map(
              (arg) => ts.visitNode(arg, visit) as ts.Expression,
            );

            return ctx.factory.createCallExpression(
              innerSpecialized,
              n.typeArguments,
              visitedArgs,
            );
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
  depth: number,
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
    dictParamInfo?.typeParamName ??
    extractTypeParamFromDictType(dictParam.type);
  const remainingParams = params.filter((_, i) => i !== dictParamIndex);

  const body = ts.isFunctionDeclaration(fn) ? fn.body : fn.body;
  if (!body) {
    return undefined;
  }

  // Recursively rewrite dictionary calls in the body, tracking depth
  const specializedBody = rewriteDictCalls(
    ctx,
    body,
    dictParamName,
    dictMethods,
    depth,
  );

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
      p.initializer,
    );
  });

  // Also narrow return type if present
  let narrowedReturnType: ts.TypeNode | undefined;
  if (ts.isArrowFunction(fn) && fn.type) {
    narrowedReturnType = narrowKindType(
      ctx,
      fn.type,
      typeParamName,
      dictMethods.brand,
    );
  } else if (ts.isFunctionExpression(fn) && fn.type) {
    narrowedReturnType = narrowKindType(
      ctx,
      fn.type,
      typeParamName,
      dictMethods.brand,
    );
  } else if (ts.isFunctionDeclaration(fn) && fn.type) {
    narrowedReturnType = narrowKindType(
      ctx,
      fn.type,
      typeParamName,
      dictMethods.brand,
    );
  }

  return ctx.factory.createArrowFunction(
    undefined,
    undefined,
    cleanParams,
    narrowedReturnType,
    ctx.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    specializedBody as ts.ConciseBody,
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
  dicts: ResolvedDict[],
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
          dictInfo.methods.brand,
        );
      }
    }

    return ctx.factory.createParameterDeclaration(
      undefined,
      p.dotDotDotToken,
      p.name,
      p.questionToken,
      narrowedType ?? undefined,
      p.initializer,
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
        dictInfo.methods.brand,
      );
    }
  }

  return ctx.factory.createArrowFunction(
    undefined,
    undefined,
    cleanParams,
    narrowedReturnType,
    ctx.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    specializedBody as ts.ConciseBody,
  );
}

/**
 * Rewrite dictionary calls for multiple dictionaries.
 */
function rewriteDictCallsMulti(
  ctx: MacroContext,
  node: ts.Node,
  dictParamMap: Map<
    string,
    { methods: DictMethodMap; typeParamName: string | undefined }
  >,
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
  _callExpr: ts.CallExpression,
): ts.Expression {
  const argsIdent = ctx.generateUniqueName("args");
  const argsParam = ctx.factory.createParameterDeclaration(
    undefined,
    ctx.factory.createToken(ts.SyntaxKind.DotDotDotToken),
    argsIdent,
    undefined,
    undefined,
    undefined,
  );

  return ctx.factory.createArrowFunction(
    undefined,
    undefined,
    [argsParam],
    undefined,
    ctx.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    ctx.factory.createCallExpression(fnExpr, undefined, [
      ...dictExprs,
      ctx.factory.createSpreadElement(
        ctx.factory.createIdentifier(argsIdent.text),
      ),
    ]),
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
  callArgs: ts.Expression[],
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
  callArgs: ts.Expression[],
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

  // For block bodies, extract the return expression
  if (ts.isBlock(body)) {
    // Try to find a return statement with an expression
    for (const stmt of body.statements) {
      if (ts.isReturnStatement(stmt) && stmt.expression) {
        return substituteParams(ctx, stmt.expression, substitutions);
      }
    }
    // No simple return found — can't inline block body
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
  substitutions: Map<string, ts.Expression>,
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

/**
 * Create a partial application as fallback when full specialization isn't possible.
 * `specialize(fn, dict)` → `(...args) => fn(dict, ...args)`
 */
function createPartialApplication(
  ctx: MacroContext,
  fnExpr: ts.Expression,
  dictExpr: ts.Expression,
  _callExpr: ts.CallExpression,
): ts.Expression {
  const argsIdent = ctx.generateUniqueName("args");
  const argsParam = ctx.factory.createParameterDeclaration(
    undefined,
    ctx.factory.createToken(ts.SyntaxKind.DotDotDotToken),
    argsIdent,
    undefined,
    undefined,
    undefined,
  );

  return ctx.factory.createArrowFunction(
    undefined,
    undefined,
    [argsParam],
    undefined,
    ctx.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    ctx.factory.createCallExpression(fnExpr, undefined, [
      dictExpr,
      ctx.factory.createSpreadElement(
        ctx.factory.createIdentifier(argsIdent.text),
      ),
    ]),
  );
}

// ============================================================================
// Register macros
// ============================================================================

globalRegistry.register(specializeMacro);
globalRegistry.register(specializeInlineMacro);

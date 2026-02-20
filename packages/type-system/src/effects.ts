/**
 * Effect System Annotations Macro
 *
 * Compile-time tracking of side effects. Functions are annotated with their
 * effects, and the macro enforces that pure functions don't call effectful
 * ones — catching side-effect violations at compile time.
 *
 * This is NOT a full algebraic effect system (like Koka or Effect-TS).
 * It's a lightweight annotation system that catches common mistakes:
 * - Pure functions accidentally calling I/O
 * - Sync functions accidentally calling async code
 * - Functions with undeclared side effects
 *
 * Inspired by:
 * - Java's checked exceptions
 * - Koka's effect system
 * - Rust's unsafe blocks
 * - Effect-TS's Effect<A, E, R> type
 *
 * ## How it works
 *
 * 1. Annotate functions with `@pure`, `@effect("io")`, `@effect("async")`, etc.
 * 2. The macro walks the call graph at compile time
 * 3. Reports errors when a @pure function calls an @effect function
 * 4. Tracks effect propagation (if A calls B which has effect "io", A also has "io")
 *
 * @example
 * ```typescript
 * @pure
 * function add(a: number, b: number): number {
 *   return a + b;  // OK: no effects
 * }
 *
 * @effect("io")
 * function readFile(path: string): string {
 *   return fs.readFileSync(path, "utf-8");
 * }
 *
 * @effect("async")
 * async function fetchData(url: string): Promise<string> {
 *   const res = await fetch(url);
 *   return res.text();
 * }
 *
 * @pure
 * function process(data: string): number {
 *   readFile("config.json");  // Compile error! Pure function calling @effect("io")
 *   return data.length;
 * }
 *
 * @effect("io", "async")
 * async function loadAndProcess(path: string): Promise<number> {
 *   const data = readFile(path);   // OK: we declared "io"
 *   const extra = await fetchData("http://example.com"); // OK: we declared "async"
 *   return add(data.length, extra.length);  // OK: pure functions are always callable
 * }
 * ```
 */

import * as ts from "typescript";
import {
  defineAttributeMacro,
  defineExpressionMacro,
  globalRegistry,
  createGenericRegistry,
  type GenericRegistry,
} from "@typesugar/core";
import { MacroContext, AttributeTarget } from "@typesugar/core";

// ============================================================================
// Effect Types
// ============================================================================

/**
 * Known effect kinds.
 */
export type EffectKind =
  | "io" // File system, network, database
  | "async" // Asynchronous operations
  | "random" // Non-deterministic (Math.random, crypto)
  | "time" // Time-dependent (Date.now, setTimeout)
  | "console" // Console output
  | "dom" // DOM manipulation
  | "state" // Mutable state
  | "throw" // May throw exceptions
  | "unsafe" // Unsafe operations (type assertions, etc.)
  | string; // Custom effects

/**
 * Effect annotation for a function.
 *
 * This is a plain data interface. Consumers who want Show/Eq instances
 * can use `@deriving(Show, Eq)` from `@typesugar/typeclass` on their own types.
 *
 * @example
 * ```typescript
 * import { deriving } from "@typesugar/typeclass";
 * import type { EffectAnnotation } from "@typesugar/type-system";
 *
 * // Create a type alias and derive instances
 * @deriving(Show, Eq)
 * interface MyEffectAnnotation extends EffectAnnotation {}
 * ```
 */
export interface EffectAnnotation {
  /** The function name */
  readonly name: string;

  /** Whether the function is pure (no effects) */
  readonly pure: boolean;

  /** The effects this function may perform */
  readonly effects: ReadonlySet<EffectKind>;

  /** Source location for error messages */
  readonly location?: string;
}

// ============================================================================
// Effect Registry (compile-time state)
// ============================================================================

/**
 * Global registry of effect annotations.
 * Populated by @pure and @effect decorators during compilation.
 *
 * Uses the generic Registry<K,V> abstraction from @typesugar/core with "replace"
 * duplicate strategy for idempotent registration.
 */
export const effectRegistry: GenericRegistry<string, EffectAnnotation> = createGenericRegistry({
  name: "EffectRegistry",
  duplicateStrategy: "replace",
});

/**
 * Register a pure function.
 */
export function registerPure(name: string, location?: string): void {
  effectRegistry.set(name, {
    name,
    pure: true,
    effects: new Set(),
    location,
  });
}

/**
 * Register an effectful function.
 */
export function registerEffect(
  name: string,
  effects: EffectKind[],
  location?: string,
): void {
  effectRegistry.set(name, {
    name,
    pure: false,
    effects: new Set(effects),
    location,
  });
}

/**
 * Check if calling `callee` from `caller` is valid.
 * Returns an error message if invalid, undefined if OK.
 */
export function checkEffectCall(
  caller: string,
  callee: string,
): string | undefined {
  const callerAnnotation = effectRegistry.get(caller);
  const calleeAnnotation = effectRegistry.get(callee);

  if (!callerAnnotation || !calleeAnnotation) {
    return undefined; // Unknown functions are allowed (open world assumption)
  }

  // Pure functions can't call effectful functions
  if (callerAnnotation.pure && !calleeAnnotation.pure) {
    const effects = Array.from(calleeAnnotation.effects).join(", ");
    return (
      `@pure function '${caller}' cannot call @effect("${effects}") function '${callee}'. ` +
      `Either remove @pure from '${caller}' or add @effect("${effects}") to it.`
    );
  }

  // Effectful functions must declare all effects of their callees
  if (!callerAnnotation.pure && !calleeAnnotation.pure) {
    const missingEffects: EffectKind[] = [];
    for (const effect of calleeAnnotation.effects) {
      if (!callerAnnotation.effects.has(effect)) {
        missingEffects.push(effect);
      }
    }

    if (missingEffects.length > 0) {
      return (
        `Function '${caller}' calls '${callee}' which has effects [${missingEffects.join(", ")}] ` +
        `not declared in '${caller}'. Add @effect("${missingEffects.join('", "')}") to '${caller}'.`
      );
    }
  }

  return undefined;
}

// ============================================================================
// @pure Attribute Macro
// ============================================================================

/**
 * @pure decorator — marks a function as having no side effects.
 *
 * The macro:
 * 1. Registers the function as pure in the effect registry
 * 2. Walks the function body to find calls to other annotated functions
 * 3. Reports errors if any called function has effects
 */
export const pureAttribute = defineAttributeMacro({
  name: "pure",
  description:
    "Mark a function as pure (no side effects). Compile error if it calls effectful functions.",
  validTargets: ["function", "method"] as AttributeTarget[],

  expand(
    ctx: MacroContext,
    _decorator: ts.Decorator,
    target: ts.Declaration,
    _args: readonly ts.Expression[],
  ): ts.Node | ts.Node[] {
    if (!ts.isFunctionDeclaration(target) && !ts.isMethodDeclaration(target)) {
      ctx.reportError(
        target,
        "@pure can only be applied to functions and methods",
      );
      return target;
    }

    const name = target.name
      ? ts.isIdentifier(target.name)
        ? target.name.text
        : target.name.getText()
      : "anonymous";

    // Register as pure
    registerPure(
      name,
      `${ctx.sourceFile.fileName}:${ctx.sourceFile.getLineAndCharacterOfPosition(target.getStart()).line + 1}`,
    );

    // Walk the function body to check for effect violations
    if (target.body) {
      walkForEffectViolations(ctx, name, target.body);
    }

    // Return the function unchanged (decorator is consumed)
    return target;
  },
});

// ============================================================================
// @effect Attribute Macro
// ============================================================================

/**
 * @effect("io", "async", ...) decorator — marks a function as having effects.
 *
 * The macro:
 * 1. Registers the function with its declared effects
 * 2. Checks that all called functions' effects are covered
 */
export const effectAttribute = defineAttributeMacro({
  name: "effect",
  description:
    "Declare the side effects of a function. Enables compile-time effect checking.",
  validTargets: ["function", "method"] as AttributeTarget[],

  expand(
    ctx: MacroContext,
    _decorator: ts.Decorator,
    target: ts.Declaration,
    args: readonly ts.Expression[],
  ): ts.Node | ts.Node[] {
    if (!ts.isFunctionDeclaration(target) && !ts.isMethodDeclaration(target)) {
      ctx.reportError(
        target,
        "@effect can only be applied to functions and methods",
      );
      return target;
    }

    const name = target.name
      ? ts.isIdentifier(target.name)
        ? target.name.text
        : target.name.getText()
      : "anonymous";

    // Extract effect names from arguments
    const effects: EffectKind[] = [];
    for (const arg of args) {
      if (ts.isStringLiteral(arg)) {
        effects.push(arg.text as EffectKind);
      }
    }

    if (effects.length === 0) {
      ctx.reportWarning(
        target,
        '@effect requires at least one effect name, e.g. @effect("io")',
      );
    }

    // Register with effects
    registerEffect(
      name,
      effects,
      `${ctx.sourceFile.fileName}:${ctx.sourceFile.getLineAndCharacterOfPosition(target.getStart()).line + 1}`,
    );

    // Walk the function body to check for undeclared effects
    if (target.body) {
      walkForEffectViolations(ctx, name, target.body);
    }

    return target;
  },
});

// ============================================================================
// Effect Checking Helpers
// ============================================================================

/**
 * Walk a function body and check for effect violations.
 */
function walkForEffectViolations(
  ctx: MacroContext,
  callerName: string,
  body: ts.Node,
): void {
  const visitor = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      let calleeName: string | undefined;

      if (ts.isIdentifier(node.expression)) {
        calleeName = node.expression.text;
      } else if (ts.isPropertyAccessExpression(node.expression)) {
        calleeName = node.expression.name.text;
      }

      if (calleeName) {
        const error = checkEffectCall(callerName, calleeName);
        if (error) {
          ctx.reportError(node, error);
        }
      }
    }

    ts.forEachChild(node, visitor);
  };

  ts.forEachChild(body, visitor);
}

// ============================================================================
// Effect-Typed Function Wrappers
// ============================================================================

/**
 * Type-level effect tracking — encode effects in the return type.
 *
 * This provides an alternative to decorators: encode effects in the type
 * signature itself, similar to Effect-TS.
 */
export type Effectful<Effects extends string, T> = T & {
  readonly __effects__: Effects;
};

/**
 * A pure value — no effects.
 */
export type Pure<T> = Effectful<never, T>;

/**
 * IO effect — file system, network, database.
 */
export type IO<T> = Effectful<"io", T>;

/**
 * Async effect.
 */
export type Async<T> = Effectful<"async", T>;

/**
 * Extract effects from an effectful type.
 */
export type EffectsOf<T> = T extends Effectful<infer E, unknown> ? E : never;

/**
 * Check if a type has a specific effect.
 */
export type HasEffect<T, E extends string> =
  E extends EffectsOf<T> ? true : false;

/**
 * Combine effects from multiple types.
 */
export type CombineEffects<A, B> = Effectful<
  EffectsOf<A> | EffectsOf<B>,
  unknown
>;

// ============================================================================
// Runtime Helpers
// ============================================================================

/**
 * Mark a value as pure (identity at runtime).
 */
export function pure<T>(value: T): Pure<T> {
  return value as Pure<T>;
}

/**
 * Mark a value as having IO effects (identity at runtime).
 */
export function io<T>(value: T): IO<T> {
  return value as IO<T>;
}

/**
 * Mark a value as async (identity at runtime).
 */
export function async_<T>(value: T): Async<T> {
  return value as Async<T>;
}

/**
 * Assert that a function is pure at runtime (no-op, for documentation).
 */
export function assertPure<T extends (...args: any[]) => any>(fn: T): T {
  return fn;
}

// ============================================================================
// Register macros
// ============================================================================

globalRegistry.register(pureAttribute);

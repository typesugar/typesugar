/**
 * typemacro - Compile-time macros for TypeScript
 *
 * typemacro provides compile-time metaprogramming capabilities inspired by:
 * - Rust's proc_macro system
 * - Scala 3's inline/transparent macros
 * - Zig's comptime
 *
 * @example
 * ```typescript
 * import { comptime, derive, ops } from "ttfx";
 *
 * // Compile-time evaluation
 * const factorial5 = comptime(() => {
 *   let result = 1;
 *   for (let i = 1; i <= 5; i++) result *= i;
 *   return result;
 * }); // Expands to: const factorial5 = 120;
 *
 * // Derive macros
 * @derive(Eq, Clone, Debug)
 * interface Point {
 *   x: number;
 *   y: number;
 * }
 *
 * // Operator overloading
 * @operators({ "+": "add", "-": "sub" })
 * class Vector { ... }
 * const c = ops(a + b); // Expands to: a.add(b)
 * ```
 *
 * @packageDocumentation
 */

// ============================================================================
// Core Types
// ============================================================================

export type {
  MacroKind,
  MacroContext,
  ComptimeValue,
  MacroDefinitionBase,
  ExpressionMacro,
  AttributeMacro,
  DeriveMacro,
  AttributeTarget,
  DeriveTypeInfo,
  DeriveFieldInfo,
  TaggedTemplateMacroDef,
  MacroDefinition,
  MacroRegistry,
  MacroExpansionResult,
  MacroDiagnostic,
  TypeMacro,
} from "./core/types.js";

// ============================================================================
// Registry & Definition Helpers
// ============================================================================

export {
  globalRegistry,
  createRegistry,
  defineExpressionMacro,
  defineAttributeMacro,
  defineDeriveMacro,
  defineTaggedTemplateMacro,
  defineTypeMacro,
  registerMacros,
} from "./core/registry.js";

// ============================================================================
// Context
// ============================================================================

export { MacroContextImpl, createMacroContext } from "./core/context.js";

// ============================================================================
// Core Utilities
// ============================================================================

export { HygieneContext, globalHygiene } from "./core/hygiene.js";
export {
  MacroCapabilities,
  resolveCapabilities,
  createRestrictedContext,
} from "./core/capabilities.js";
export { MacroExpansionCache, InMemoryExpansionCache } from "./core/cache.js";
export { ExpansionTracker, globalExpansionTracker } from "./core/source-map.js";
export type { ExpansionRecord } from "./core/source-map.js";
export { pipeline } from "./core/pipeline.js";

// ============================================================================
// Configuration System
// ============================================================================

export {
  config,
  defineConfig,
  type TtfxConfig,
  type ContractsConfig,
} from "./core/config.js";

// ============================================================================
// Built-in Macros
// ============================================================================

export * from "./macros/index.js";

// ============================================================================
// Use Case Modules
// ============================================================================

// Note: These are imported separately to avoid circular dependencies
// Users should import from "typemacro/units", etc.

// ============================================================================
// Runtime Types (for use in source code)
// ============================================================================

// These are type-only exports that serve as markers in source code
// The transformer will process them at compile time

/**
 * Marker function for compile-time evaluation.
 * The expression passed to comptime() will be evaluated during compilation.
 *
 * @param fn - A function that will be evaluated at compile time
 * @returns The computed value (replaced at compile time)
 *
 * @example
 * ```typescript
 * const result = comptime(() => 5 * 5); // Becomes: const result = 25;
 * ```
 */
export function comptime<T>(fn: () => T): T {
  // This is a placeholder - the actual implementation is done by the transformer
  return fn();
}

/**
 * Decorator to generate implementations for a type.
 * Available derives: Eq, Ord, Clone, Debug, Hash, Default, Json, Builder
 *
 * @param derives - Names of the implementations to generate
 *
 * @example
 * ```typescript
 * @derive(Eq, Clone, Debug)
 * interface Point { x: number; y: number; }
 * // Generates: pointEq(), clonePoint(), debugPoint()
 * ```
 */
export function derive(
  ..._derives: string[]
): ClassDecorator & PropertyDecorator {
  // Placeholder decorator - processed by transformer
  return () => {};
}

/**
 * Decorator to define operator overloading for a class.
 *
 * @param mappings - Object mapping operators to method names
 *
 * @example
 * ```typescript
 * @operators({ "+": "add", "-": "sub", "*": "mul" })
 * class Vector { add(other: Vector): Vector { ... } }
 * ```
 */
export function operators(_mappings: Record<string, string>): ClassDecorator {
  // Placeholder decorator - processed by transformer
  return () => {};
}

/**
 * Transform operator expressions into method calls.
 * Used with classes that have @operators decorator.
 *
 * @param expr - Expression with operators to transform
 * @returns The result of the transformed expression
 *
 * @example
 * ```typescript
 * const c = ops(a + b * c); // Becomes: a.add(b.mul(c))
 * ```
 */
export function ops<T>(expr: T): T {
  // Placeholder - processed by transformer
  return expr;
}

/**
 * Pipe a value through a series of functions.
 *
 * @param value - Initial value
 * @param fns - Functions to apply in order
 * @returns The final result
 *
 * @example
 * ```typescript
 * const result = pipe(5, double, addOne, toString);
 * // Becomes: toString(addOne(double(5)))
 * ```
 */
export function pipe<T, R>(
  value: T,
  ...fns: Array<(arg: unknown) => unknown>
): R {
  // Placeholder - processed by transformer
  return fns.reduce((acc, fn) => fn(acc), value as unknown) as R;
}

/**
 * Compose functions right-to-left.
 *
 * @param fns - Functions to compose
 * @returns A new function that applies all functions
 *
 * @example
 * ```typescript
 * const process = compose(toString, addOne, double);
 * // Becomes: (x) => toString(addOne(double(x)))
 * ```
 */
export function compose<T, R>(
  ...fns: Array<(arg: unknown) => unknown>
): (value: T) => R {
  // Placeholder - processed by transformer
  return (value: T) =>
    fns.reduceRight((acc, fn) => fn(acc), value as unknown) as R;
}

// ============================================================================
// Typeclass System (Scala 3-like)
// ============================================================================

/**
 * Decorator to mark an interface as a typeclass.
 * Generates companion namespace with summon/register utilities.
 *
 * @example
 * ```typescript
 * @typeclass
 * interface Show<A> {
 *   show(a: A): string;
 * }
 * ```
 */
export function typeclass(target: any, _context?: ClassDecoratorContext): any {
  // Placeholder - processed by transformer
  return target;
}

/**
 * Decorator to register a typeclass instance for a specific type.
 *
 * @param typeName - The name of the type this instance is for
 *
 * @example
 * ```typescript
 * @instance("number")
 * const showNumber: Show<number> = {
 *   show: (a) => String(a),
 * };
 * ```
 */
export function instance(
  _typeName: string,
): PropertyDecorator & ClassDecorator {
  // Placeholder - processed by transformer
  return () => {};
}

/**
 * Decorator to auto-derive typeclass instances for a type.
 * Follows Scala 3 derivation rules:
 * - Product types: derive field-by-field if all fields have instances
 * - Sum types: derive variant-by-variant if all variants have instances
 *
 * @param typeclasses - Typeclass names to derive
 *
 * @example
 * ```typescript
 * @deriving(Show, Eq, Ord)
 * interface Point {
 *   x: number;
 *   y: number;
 * }
 * // Generates: showPoint, eqPoint, ordPoint instances
 * ```
 */
export function deriving(
  ..._typeclasses: string[]
): ClassDecorator & PropertyDecorator {
  // Placeholder - processed by transformer
  return () => {};
}

/**
 * Resolve a typeclass instance at compile time (Scala 3-like summon).
 *
 * @example
 * ```typescript
 * const showPoint = summon<Show<Point>>();
 * showPoint.show({ x: 1, y: 2 }); // "Point(x = 1, y = 2)"
 * ```
 */
export function summon<T>(): T {
  // Placeholder - processed by transformer
  throw new Error(
    "summon() must be processed by the typemacro transformer at compile time",
  );
}

/**
 * Call extension methods on a value via typeclass instances.
 * Scala 3-like extension method syntax.
 *
 * @example
 * ```typescript
 * extend(point).show();    // Uses Show<Point>
 * extend(point).eq(other); // Uses Eq<Point>
 * ```
 */
export function extend<T>(value: T): any {
  // Placeholder - processed by transformer
  return value;
}

// ============================================================================
// Tail-Call Optimization
// ============================================================================

/**
 * Decorator to verify and optimize tail-recursive functions into stack-safe
 * while loops at compile time. Follows Scala's @tailrec rules.
 *
 * **Rules:**
 * - The function must contain at least one self-recursive call in tail position.
 * - Every recursive call must be in tail position (the last operation before return).
 * - Recursive calls wrapped in operations (e.g., `n * f(n-1)`) are rejected.
 * - Recursive calls inside try/catch/finally are rejected.
 * - Mutual recursion is not supported — only direct self-recursion.
 *
 * If any rule is violated, the BUILD fails with a clear error message.
 *
 * @example
 * ```typescript
 * @tailrec
 * function factorial(n: number, acc: number = 1): number {
 *   if (n <= 1) return acc;
 *   return factorial(n - 1, n * acc);
 * }
 * // Compiles to a while(true) loop — O(1) stack space
 *
 * @tailrec
 * function gcd(a: number, b: number): number {
 *   if (b === 0) return a;
 *   return gcd(b, a % b);
 * }
 * ```
 *
 * @example Compile error — not tail-recursive:
 * ```typescript
 * @tailrec
 * function factorial(n: number): number {
 *   if (n <= 1) return 1;
 *   return n * factorial(n - 1); // ERROR: recursive call not in tail position
 * }
 * ```
 */
export function tailrec(
  target: any,
  _context?: ClassMethodDecoratorContext,
): any {
  // Placeholder decorator — the transformer replaces the entire function
  return target;
}

// ============================================================================
// Static Assert (compile-time type checking)
// ============================================================================

/**
 * Assert a condition at compile time.
 * If the condition is false, a compile error is generated.
 *
 * @example
 * ```typescript
 * static_assert<Equal<typeof result, number>>();
 * ```
 */
export function static_assert<_T extends true>(): void {
  // Type-level only - no runtime effect
}

/**
 * Type-level equality check
 */
export type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

/**
 * Type-level extends check
 */
export type Extends<A, B> = A extends B ? true : false;

/**
 * Runtime placeholder stubs for typesugar macros.
 *
 * These functions are replaced by the transformer at compile time.
 * They exist to:
 * 1. Provide type information to the IDE/type checker
 * 2. Give meaningful errors if the transformer isn't configured
 *
 * @module
 */

// ============================================================================
// Typeclass Runtime Stubs
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
 * Supports multiple syntaxes:
 * - @instance(Typeclass, Type) - identifier form
 * - @instance("Typeclass<Type>") - string form for HKT
 *
 * @example
 * ```typescript
 * @instance(Show, Number)
 * const numberShow: Show<number> = {
 *   show: (n) => String(n),
 * };
 *
 * // For HKT typeclasses:
 * @instance("FlatMap<Array>")
 * const flatMapArray: FlatMap<ArrayTag> = { ... };
 * ```
 */
export function instance(
  ..._args: unknown[]
): PropertyDecorator & ClassDecorator & MethodDecorator {
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
export function deriving(..._typeclasses: unknown[]): ClassDecorator & PropertyDecorator {
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
  throw new Error("summon() must be processed by the typesugar transformer at compile time");
}

/**
 * Call extension methods on a value via typeclass instances or standalone extensions.
 * Scala 3-like extension method syntax.
 *
 * Works with two kinds of extensions:
 * 1. Typeclass extensions — `extend(point).show()` resolves via Show<Point>
 * 2. Standalone extensions — `extend(42).clamp(0, 100)` resolves to a direct function call
 *
 * @example
 * ```typescript
 * // Typeclass extension
 * extend(point).show();    // Uses Show<Point>
 *
 * // Standalone extension (from @typesugar/std)
 * extend(42).clamp(0, 100);        // → NumberExt.clamp(42, 0, 100)
 * extend("hello").capitalize();     // → StringExt.capitalize("hello")
 * ```
 */
export function extend<T>(_value: T): T & Record<string, (...args: any[]) => any> {
  throw new Error("extend() must be processed by the typesugar transformer at compile time");
}

// ============================================================================
// Extension Registration Stubs
// ============================================================================

/**
 * Register all methods of a namespace object as extension methods for a concrete type.
 * This is the Scala 3-style `extension` block equivalent for TypeScript.
 *
 * The namespace must be imported at the call site for the extension to resolve.
 *
 * @param typeName - The type to extend (e.g., "number", "string", "Date")
 * @param namespace - An object whose methods become extension methods
 *
 * @example
 * ```typescript
 * const NumberExt = { clamp, isPrime, toHex };
 * registerExtensions("number", NumberExt);
 *
 * // Now works:
 * extend(42).clamp(0, 100); // → NumberExt.clamp(42, 0, 100)
 * ```
 */
export function registerExtensions<T extends Record<string, Function>>(
  _typeName: string,
  _namespace: T
): void {
  // Placeholder - processed by transformer at compile time
}

/**
 * Register a single function as an extension method for a concrete type.
 *
 * @param typeName - The type to extend (e.g., "number", "string")
 * @param fn - The function to register as an extension method
 *
 * @example
 * ```typescript
 * function clamp(value: number, min: number, max: number): number { ... }
 * registerExtension("number", clamp);
 *
 * extend(42).clamp(0, 100); // → clamp(42, 0, 100)
 * ```
 */
export function registerExtension<F extends Function>(_typeName: string, _fn: F): void {
  // Placeholder - processed by transformer at compile time
}

// ============================================================================
// Implicits Runtime Stub
// ============================================================================

/**
 * Decorator to mark a function as having implicit typeclass parameters.
 * The transformer auto-fills missing typeclass instance arguments at call sites.
 *
 * @param paramNames - Optional parameter names to treat as implicit. If omitted,
 *                     auto-detects parameters typed as `TypeclassName<T>`.
 *
 * @example
 * ```typescript
 * @implicits
 * function show<A>(a: A, S: Show<A>): string {
 *   return S.show(a);
 * }
 *
 * // Call site - implicit param auto-filled:
 * show(42);  // → show(42, Show.summon<number>("number"))
 *
 * // Explicit still works:
 * show(42, customShow);  // Uses customShow
 * ```
 */
export function implicits(...paramNames: string[]): (target: any, context?: any) => any {
  // Placeholder - processed by transformer
  return (target) => target;
}

// ============================================================================
// Comptime Stubs
// ============================================================================

/**
 * Execute code at compile time and inline the result.
 *
 * @example
 * ```typescript
 * const hash = comptime(() => computeHash(source));
 * // Result is computed at compile time and inlined as a literal
 * ```
 */
export function comptime<T>(_fn: () => T): T {
  throw new Error("comptime() must be processed by the typesugar transformer at compile time");
}

// ============================================================================
// Derive Stubs
// ============================================================================

/**
 * Decorator to derive implementations at compile time.
 *
 * @example
 * ```typescript
 * @derive(Eq, Debug, Clone)
 * class User {
 *   constructor(public id: number, public name: string) {}
 * }
 * ```
 */
export function derive(
  ..._derives: unknown[]
): ClassDecorator & PropertyDecorator & MethodDecorator {
  // Placeholder - processed by transformer
  return () => {};
}

// ============================================================================
// Operator Stubs
// ============================================================================

/**
 * Decorator to enable operator overloading on a class.
 *
 * @example
 * ```typescript
 * @operators({ "+": "add", "*": "mul" })
 * class Vec2 {
 *   add(other: Vec2): Vec2 { ... }
 *   mul(other: Vec2): Vec2 { ... }
 * }
 * ```
 */
export function operators(
  _config?: Record<string, string>
): ClassDecorator & PropertyDecorator & MethodDecorator {
  // Placeholder - processed by transformer
  return () => {};
}

/**
 * Transform operator expressions using registered mappings.
 *
 * @example
 * ```typescript
 * const result = ops(a + b * c);
 * // Compiles to: a.add(b.mul(c))
 * ```
 */
export function ops<T>(expr: T): T {
  return expr;
}

/**
 * Pipe a value through a series of functions.
 *
 * @example
 * ```typescript
 * const result = pipe(x, f, g, h);
 * // Compiles to: h(g(f(x)))
 * ```
 */
export function pipe<T, R>(value: T, ...fns: Function[]): R {
  return fns.reduce((acc, fn) => fn(acc), value as unknown) as R;
}

/**
 * Compose functions right-to-left.
 *
 * @example
 * ```typescript
 * const composed = compose(f, g, h);
 * // Equivalent to: (x) => f(g(h(x)))
 * ```
 */
export function compose<T extends Function[]>(...fns: T): Function {
  return (...args: unknown[]) =>
    fns
      .slice(0, -1)
      .reduceRight(
        (acc, fn) => fn(acc),
        (fns[fns.length - 1] as (...a: unknown[]) => unknown)(...args)
      );
}

/**
 * Compose functions left-to-right
 *
 * @example
 * ```typescript
 * const transform = flow(
 *   (x: number) => x * 2,
 *   x => x + 1,
 *   x => x.toString()
 * );
 * transform(5); // "11"
 * ```
 */
export function flow<A extends readonly unknown[], B>(ab: (...a: A) => B): (...a: A) => B;
export function flow<A extends readonly unknown[], B, C>(
  ab: (...a: A) => B,
  bc: (b: B) => C
): (...a: A) => C;
export function flow<A extends readonly unknown[], B, C, D>(
  ab: (...a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D
): (...a: A) => D;
export function flow<A extends readonly unknown[], B, C, D, E>(
  ab: (...a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E
): (...a: A) => E;
export function flow<A extends readonly unknown[], B, C, D, E, F>(
  ab: (...a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
  ef: (e: E) => F
): (...a: A) => F;
export function flow<A extends readonly unknown[], B, C, D, E, F, G>(
  ab: (...a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
  ef: (e: E) => F,
  fg: (f: F) => G
): (...a: A) => G;
export function flow<A extends readonly unknown[], B, C, D, E, F, G, H>(
  ab: (...a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
  ef: (e: E) => F,
  fg: (f: F) => G,
  gh: (g: G) => H
): (...a: A) => H;
export function flow<A extends readonly unknown[], B, C, D, E, F, G, H, I>(
  ab: (...a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
  ef: (e: E) => F,
  fg: (f: F) => G,
  gh: (g: G) => H,
  hi: (h: H) => I
): (...a: A) => I;
export function flow<A extends readonly unknown[], B, C, D, E, F, G, H, I, J>(
  ab: (...a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
  ef: (e: E) => F,
  fg: (f: F) => G,
  gh: (g: G) => H,
  hi: (h: H) => I,
  ij: (i: I) => J
): (...a: A) => J;
export function flow(
  ...fns: Array<(...args: unknown[]) => unknown>
): (...args: unknown[]) => unknown {
  return (...args: unknown[]) => {
    let result: unknown = fns[0](...args);
    for (let i = 1; i < fns.length; i++) {
      result = fns[i](result);
    }
    return result;
  };
}

// ============================================================================
// Specialize Stubs
// ============================================================================

/**
 * Create a specialized (monomorphized) version of a function.
 *
 * @example
 * ```typescript
 * const sortNumbers = specialize(sort, [numericOrd]);
 * // Creates a version specialized for numbers
 * ```
 */
export function specialize<T extends Function>(_fn: T, _dicts?: unknown[]): T {
  throw new Error("specialize() must be processed by the typesugar transformer at compile time");
}

/**
 * Monomorphize a generic function for specific type arguments.
 * Processed by transformer; stub returns the function.
 */
export function mono<T>(fn: (...args: unknown[]) => unknown): (...args: unknown[]) => unknown {
  return fn as (...args: unknown[]) => unknown;
}

/**
 * Inline a function call at compile time.
 * Processed by transformer; stub returns the expression result.
 */
export function inlineCall<T>(expr: T): T {
  return expr;
}

// ============================================================================
// Reflect Stubs
// ============================================================================

/**
 * Decorator to enable reflection on a type.
 *
 * @example
 * ```typescript
 * @reflect
 * interface User { name: string; age: number; }
 * ```
 */
export function reflect(target: any, _context?: ClassDecoratorContext): any {
  // Placeholder - processed by transformer
  return target;
}

/**
 * Get type information at compile time.
 *
 * @example
 * ```typescript
 * const info = typeInfo<User>();
 * // Returns: { name: "User", fields: [...], ... }
 * ```
 */
export function typeInfo<T>(): {
  name: string;
  fields: Array<{ name: string; type: string }>;
} {
  throw new Error("typeInfo() must be processed by the typesugar transformer at compile time");
}

/**
 * Get field names of a type at compile time.
 *
 * @example
 * ```typescript
 * const names = fieldNames<User>(); // ["name", "age"]
 * ```
 */
export function fieldNames<T>(): string[] {
  throw new Error("fieldNames() must be processed by the typesugar transformer at compile time");
}

/**
 * Generate a runtime type validator.
 *
 * @example
 * ```typescript
 * const isUser = validator<User>();
 * if (isUser(data)) { ... }
 * ```
 */
export function validator<T>(): (value: unknown) => value is T {
  throw new Error("validator() must be processed by the typesugar transformer at compile time");
}

// ============================================================================
// Conditional Compilation Stubs
// ============================================================================

/**
 * Conditional compilation based on configuration.
 *
 * @example
 * ```typescript
 * const impl = cfg("debug", debugImpl, releaseImpl);
 * ```
 */
export function cfg<T>(_condition: string, _ifTrue: T, _ifFalse: T): T {
  throw new Error("cfg() must be processed by the typesugar transformer at compile time");
}

// ============================================================================
// Include Stubs
// ============================================================================

/**
 * Include file contents as a string at compile time.
 *
 * @example
 * ```typescript
 * const template = includeStr("./template.html");
 * ```
 */
export function includeStr(_path: string): string {
  throw new Error("includeStr() must be processed by the typesugar transformer at compile time");
}

/**
 * Include and parse JSON file at compile time.
 *
 * @example
 * ```typescript
 * const config = includeJson("./config.json");
 * ```
 */
export function includeJson<T = unknown>(_path: string): T {
  throw new Error("includeJson() must be processed by the typesugar transformer at compile time");
}

// ============================================================================
// Static Assert Stubs
// ============================================================================

/**
 * Assert a condition at compile time.
 *
 * @example
 * ```typescript
 * static_assert(config.version > 0, "Version must be positive");
 * ```
 */
export function static_assert(_condition: boolean, _message: string): void {
  throw new Error("static_assert() must be processed by the typesugar transformer at compile time");
}

// ============================================================================
// Tail Recursion Stub
// ============================================================================

/**
 * Decorator to optimize tail-recursive functions.
 *
 * @example
 * ```typescript
 * @tailrec
 * function factorial(n: number, acc = 1): number {
 *   if (n <= 1) return acc;
 *   return factorial(n - 1, n * acc);
 * }
 * ```
 */
export function tailrec(target: any, _context?: ClassMethodDecoratorContext): any {
  // Placeholder - processed by transformer
  return target;
}

// ============================================================================
// HKT Stubs
// ============================================================================

/**
 * Decorator to enable HKT (higher-kinded type) syntax on an interface.
 *
 * @example
 * ```typescript
 * @hkt
 * interface Functor<F<_>> {
 *   map<A, B>(fa: F<A>, f: (a: A) => B): F<B>;
 * }
 * ```
 */
export function hkt(target: any, _context?: ClassDecoratorContext): any {
  // Placeholder - processed by transformer
  return target;
}

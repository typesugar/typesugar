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
 * Declare a typeclass interface.
 *
 * **Preferred JSDoc syntax (no preprocessor needed):**
 * ```typescript
 * /** @typeclass *\/
 * interface Eq<A> {
 *   /** @op === *\/
 *   eq(a: A, b: A): boolean;
 * }
 * ```
 *
 * **With transformer:** Extracts metadata (methods, @op tags, type params)
 * and registers in the typeclass registry for summon(), operator overloading,
 * and auto-derivation.
 *
 * **Without transformer (fallback):** No-op. The interface is unchanged.
 * Operator overloading and summon() won't work, but the interface is still
 * usable as a plain TypeScript type.
 *
 * @example
 * ```typescript
 * // JSDoc syntax (preferred, no preprocessor):
 * /** @typeclass *\/
 * interface Eq<A> {
 *   /** @op === *\/
 *   /** @op === *\/
 *   eq(a: A, b: A): boolean;
 * }
 * ```
 *
 * @param nameOrTarget - Typeclass name string OR decorator target (interface/class)
 * @param optionsOrContext - Optional configuration (expression form) or decorator context
 * @returns void (expression form) or the target unchanged (decorator form)
 */
export function typeclass(name: string, options?: object): void;
export function typeclass(target: any, context?: ClassDecoratorContext): any;
export function typeclass(
  nameOrTarget: string | any,
  optionsOrContext?: object | ClassDecoratorContext
): any {
  if (typeof nameOrTarget === "string") return; // Expression form: no-op
  return nameOrTarget; // Decorator form: return target unchanged
}

/**
 * Register a typeclass instance.
 *
 * **Preferred JSDoc syntax (no preprocessor needed):**
 * ```typescript
 * /** @impl Eq<Point> *\/
 * export const pointEq: Eq<Point> = {
 *   eq: (a, b) => a.x === b.x && a.y === b.y,
 * };
 * ```
 *
 * **With transformer:** Registers the instance in instanceRegistry, enables
 * summon<TC<T>>() resolution, operator overloading, and zero-cost
 * specialization via method extraction.
 *
 * **Without transformer (fallback):** Expression form returns the object
 * unchanged. Decorator form is a no-op. The instance is usable as a plain
 * value but won't be discovered by summon() or operator rewriting.
 *
 * @example
 * ```typescript
 * // JSDoc syntax (preferred, no preprocessor):
 * /** @impl Numeric<Complex> *\/
 * export const numericComplex: Numeric<Complex> = { ... };
 *
 * // Decorator on const (requires preprocessor):
 * @impl("Numeric<Complex>")
 * export const numericComplex: Numeric<Complex> = { ... };
 *
 * // Decorator on class (standard TS):
 * @impl("Show<MyClass>")
 * class MyClassShow implements Show<MyClass> { ... }
 *
 * // For HKT typeclasses:
 * /** @impl FlatMap<Array> *\/
 * const flatMapArray: FlatMap<ArrayTag> = { ... };
 * ```
 *
 * @param descOrTarget - Description string like "Numeric<Complex>" OR decorator target
 * @param obj - The instance object (expression form only)
 * @returns The instance object unchanged (expression form) or decorator function (decorator form)
 */
export function impl<T>(desc: string, obj: T): T;
export function impl(...args: unknown[]): PropertyDecorator & ClassDecorator & MethodDecorator;
export function impl(...args: unknown[]): any {
  if (args.length >= 2) return args[1]; // Expression form: return object unchanged
  return () => {}; // Decorator form: no-op
}

/**
 * @deprecated Use `impl` instead. This is an alias for backwards compatibility.
 */
export const instance: typeof impl = impl;

/**
 * @deprecated Renamed to `derive`. Use `@derive(Show, Eq, Ord)` instead.
 *
 * @param typeclasses - Typeclass names to derive
 */
export function deriving(..._typeclasses: unknown[]): ClassDecorator & PropertyDecorator {
  // Placeholder - processed by transformer
  return () => {};
}

/**
 * Mark a function as an extension method (first parameter becomes the receiver).
 *
 * @example
 * ```typescript
 * @extension
 * export function head<A>(arr: readonly A[]): A | undefined {
 *   return arr[0];
 * }
 *
 * // Now callable as: [1, 2, 3].head() -> 1
 * ```
 *
 * The decorator is metadata-only and compiles away. The function is unchanged.
 * Extension methods are resolved at import time — import the function to enable
 * the extension syntax in that file.
 */
export function extension(
  target: object,
  _propertyKey?: string | symbol,
  _descriptor?: PropertyDescriptor
): any {
  // Placeholder - processed by transformer
  return target;
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
 * Resolve several typeclass instances at once, as a tuple.
 *
 * @example
 * ```typescript
 * const [showPoint, eqPoint] = summonAll<[Show<Point>, Eq<Point>]>();
 * ```
 */
export function summonAll<T extends readonly unknown[]>(): T {
  throw new Error("summonAll() must be processed by the typesugar transformer at compile time");
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
// Implicit Parameter Resolution Stub
// ============================================================================

/**
 * Marker for implicit typeclass parameter resolution.
 *
 * Used as a default parameter value to indicate the transformer should
 * resolve and inject the appropriate typeclass instance at call sites.
 *
 * @deprecated This is a compile-time placeholder — if you see a strikethrough,
 * the typesugar transformer is not configured.
 *
 * @example
 * ```typescript
 * // Mark parameters as implicitly resolved:
 * function sort<T>(items: T[], ord: Ord<T> = implicit()): T[] {
 *   return items.sort(ord.compare);
 * }
 *
 * // Call site - implicit param auto-resolved:
 * sort(numbers);  // → sort(numbers, resolvedOrdInstance)
 *
 * // Explicit override still works:
 * sort(numbers, customOrd);
 * ```
 */
export function implicit<T>(): T {
  throw new Error(
    "implicit() requires the typesugar transformer.\n" +
      'Add to tsconfig.json: { "compilerOptions": { "plugins": ' +
      '[{ "transform": "@typesugar/transformer" }] } }'
  );
}

// ============================================================================
// Comptime Stubs
// ============================================================================

/**
 * Permissions that can be granted to comptime blocks.
 *
 * By default the provided `fs` / `process.env` helpers refuse access; these
 * flags enable them. They guard against accidents only: comptime code runs
 * with build-time privileges and is NOT a sandbox for untrusted code.
 */
export interface ComptimePermissions {
  fs?: boolean | "read" | "write";
  env?: boolean | "read";
  net?: boolean | string[];
  time?: boolean;
}

/**
 * Execute code at compile time and inline the result.
 *
 * Three calling conventions:
 * - `comptime(() => expr)` — evaluate a thunk at compile time
 * - `comptime(expr)` — evaluate a bare expression at compile time
 * - `comptime(permissions, () => expr)` — evaluate with fs/env helpers enabled
 *
 * **Security:** the code runs inside the compiler process with the build's
 * privileges. The `node:vm` context is hardened, but it is not a security
 * boundary — never build untrusted code containing comptime outside an
 * isolated environment. Editor integrations do not evaluate comptime unless
 * explicitly enabled.
 *
 * @example
 * ```typescript
 * const hash = comptime(() => computeHash(source));
 * const buildTime = comptime(new Date().toISOString());
 * const data = comptime({ fs: 'read' }, () => fs.readFileSync('./data.json', 'utf8'));
 * ```
 */
export function comptime<T>(fn: () => T): T;
export function comptime<T>(permissions: ComptimePermissions, fn: () => T): T;
export function comptime<T>(expr: T): T;
export function comptime(..._args: unknown[]): unknown {
  throw new Error("comptime() must be processed by the typesugar transformer at compile time");
}

// ============================================================================
// Derive Stubs
// ============================================================================

/**
 * Unified decorator to auto-derive typeclass instances for a type.
 * Follows Scala 3 derivation rules:
 * - Product types: derive field-by-field if all fields have instances
 * - Sum types: derive variant-by-variant if all variants have instances
 *
 * All derived instances integrate with `summon()` and operator overloading.
 *
 * @param typeclasses - Typeclass names to derive
 *
 * @example
 * ```typescript
 * @derive(Show, Eq, Ord, Clone, Debug, Json)
 * interface Point {
 *   x: number;
 *   y: number;
 * }
 * // Generates: showPoint, eqPoint, ordPoint, clonePoint, debugPoint, jsonPoint instances
 * ```
 */
export function derive(
  ..._derives: unknown[]
): ClassDecorator & PropertyDecorator & MethodDecorator {
  // Placeholder - processed by transformer
  return () => {};
}

/**
 * Pipe a value through a series of functions, left to right.
 *
 * Value-first overloads (2–10 functions) thread the type through each step, so
 * `pipe(5, x => x * 2, x => `${x}`)` infers `string` rather than `unknown`.
 *
 * @example
 * ```typescript
 * const result = pipe(x, f, g, h);
 * // Compiles to: h(g(f(x)))
 * ```
 */
export function pipe<A>(a: A): A;
export function pipe<A, B>(a: A, ab: (a: A) => B): B;
export function pipe<A, B, C>(a: A, ab: (a: A) => B, bc: (b: B) => C): C;
export function pipe<A, B, C, D>(a: A, ab: (a: A) => B, bc: (b: B) => C, cd: (c: C) => D): D;
export function pipe<A, B, C, D, E>(
  a: A,
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E
): E;
export function pipe<A, B, C, D, E, F>(
  a: A,
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
  ef: (e: E) => F
): F;
export function pipe<A, B, C, D, E, F, G>(
  a: A,
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
  ef: (e: E) => F,
  fg: (f: F) => G
): G;
export function pipe<A, B, C, D, E, F, G, H>(
  a: A,
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
  ef: (e: E) => F,
  fg: (f: F) => G,
  gh: (g: G) => H
): H;
export function pipe<A, B, C, D, E, F, G, H, I>(
  a: A,
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
  ef: (e: E) => F,
  fg: (f: F) => G,
  gh: (g: G) => H,
  hi: (h: H) => I
): I;
export function pipe<A, B, C, D, E, F, G, H, I, J>(
  a: A,
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
  ef: (e: E) => F,
  fg: (f: F) => G,
  gh: (g: G) => H,
  hi: (h: H) => I,
  ij: (i: I) => J
): J;
export function pipe(value: unknown, ...fns: Array<(a: unknown) => unknown>): unknown {
  return fns.reduce((acc, fn) => fn(acc), value);
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
 * Result of a validator generated by {@link validator}.
 */
export type ValidationResult<T> =
  | { success: true; value: T }
  | { success: false; errors: string[] };

/**
 * Generate a runtime validator for `T`.
 *
 * The returned function never throws; it returns a {@link ValidationResult}
 * (an object, so it is always truthy — check `.success`, not the result).
 * Only the top-level properties of `T` are checked (nested objects are only
 * checked to be non-null objects).
 *
 * @example
 * ```typescript
 * const validateUser = validator<User>();
 * const result = validateUser(data);
 * if (result.success) {
 *   result.value; // User
 * } else {
 *   console.error(result.errors);
 * }
 * ```
 */
export function validator<T>(): (value: unknown) => ValidationResult<T> {
  throw new Error("validator() must be processed by the typesugar transformer at compile time");
}

// ============================================================================
// Conditional Compilation Stubs
// ============================================================================

/** The value a `cfg` branch produces: inline thunks are invoked by the macro. */
export type CfgBranch<X> = X extends () => infer R ? R : X;

/**
 * Conditional compilation based on configuration.
 *
 * The condition supports dotted paths, `&&`, `||`, `!`, parentheses, and
 * `===`/`!==` (or `==`/`!=`) against quoted strings, numbers and
 * true/false/null/undefined. An inline arrow / function expression branch is
 * invoked: the selected branch becomes `(fn)()`. With no else branch the
 * inactive result is `undefined`.
 *
 * (Typing note: a zero-argument function passed by NAME is typed as if it were
 * invoked, but the macro only invokes inline function expressions — wrap it as
 * `() => fn` or call it yourself in that case.)
 *
 * @example
 * ```typescript
 * const impl = cfg("debug", debugImpl, releaseImpl);
 * const info = cfg("platform === 'node'", () => collectNodeInfo()); // Info | undefined
 * ```
 */
export function cfg<A, B = undefined>(
  condition: string,
  ifTrue: A,
  ifFalse?: B
): CfgBranch<A> | CfgBranch<B>;
export function cfg(_condition: string, _ifTrue: unknown, _ifFalse?: unknown): unknown {
  throw new Error("cfg() must be processed by the typesugar transformer at compile time");
}

/**
 * Decorator: keep the declaration only when the condition is true at compile
 * time (same condition syntax as {@link cfg}); otherwise it is removed.
 *
 * @example
 * ```typescript
 * class Service {
 *   @cfgAttr("debug")
 *   dumpState() { ... }
 * }
 * ```
 */
export function cfgAttr(_condition: string): (target: any, context?: unknown) => any {
  throw new Error("@cfgAttr must be processed by the typesugar transformer at compile time");
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
 * Include file contents as a string at compile time. Alias for {@link includeStr}.
 */
export function includeText(_path: string): string {
  throw new Error("includeText() must be processed by the typesugar transformer at compile time");
}

/**
 * Include a file's bytes at compile time, embedded as a `Uint8Array` literal.
 *
 * @example
 * ```typescript
 * const icon = includeBytes("./icon.png");
 * ```
 */
export function includeBytes(_path: string): Uint8Array {
  throw new Error("includeBytes() must be processed by the typesugar transformer at compile time");
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
 * staticAssert(config.version > 0, "Version must be positive");
 * ```
 */
export function staticAssert(_condition: boolean, _message?: string): void {
  throw new Error("staticAssert() must be processed by the typesugar transformer at compile time");
}

/**
 * Unconditionally fail compilation with `message` at this call site.
 *
 * @example
 * ```typescript
 * compileError("this platform is not supported");
 * ```
 */
export function compileError(_message: string): never {
  throw new Error("compileError() must be processed by the typesugar transformer at compile time");
}

/**
 * Emit a compile-time warning with `message` at this call site.
 *
 * @example
 * ```typescript
 * compileWarning("legacyApi() is deprecated");
 * ```
 */
export function compileWarning(_message: string): void {
  throw new Error(
    "compileWarning() must be processed by the typesugar transformer at compile time"
  );
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

// Derive name markers (`@derive(Eq, Ord, ...)`). derive.ts has no compile-time
// imports, so re-exporting it here keeps this entry free of the TypeScript compiler
// while preserving marker identity with the macros root.
export { Eq, Ord, Clone, Debug, Hash, Default, Json, Builder, TypeGuard, Show } from "./derive.js";

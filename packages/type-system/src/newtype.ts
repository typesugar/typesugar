/**
 * Zero-Cost Newtype - Branded types that compile away completely
 *
 * Newtypes provide type-safe wrappers around primitive types at zero runtime
 * cost. The brand exists only in the type system — at runtime, the value is
 * just the underlying primitive. The macro erases all wrap/unwrap calls.
 *
 * ## The Branding Spectrum
 *
 * This module provides `Newtype` — the simplest form of type branding:
 *
 * - **Newtype** (this module) — Pure branding, zero runtime cost.
 *   Use when you just need type-level discrimination.
 *   Example: `UserId`, `Meters`, `Seconds`
 *
 * - **Opaque** (./opaque.ts) — Module-scoped access control.
 *   Use when you need to hide representation details.
 *   Example: `Password` (can't be inspected outside auth module)
 *
 * - **Refined** (./refined.ts) — Runtime validation with predicates.
 *   Use when values must satisfy invariants.
 *   Example: `Email`, `Port`, `NonEmpty<string>`
 *
 * Inspired by Haskell's newtype and Rust's newtype pattern.
 *
 * @example
 * ```typescript
 * // Define branded types:
 * type UserId = Newtype<number, "UserId">;
 * type Email = Newtype<string, "Email">;
 * type Meters = Newtype<number, "Meters">;
 * type Seconds = Newtype<number, "Seconds">;
 *
 * // Source (what you write):
 * const id = wrap<UserId>(42);
 * const raw = unwrap(id);
 * const email = wrap<Email>("user@example.com");
 *
 * // Compiled output (what runs):
 * const id = 42;
 * const raw = id;
 * const email = "user@example.com";
 *
 * // Type errors at compile time:
 * function getUser(id: UserId): User { ... }
 * getUser(42);                    // Error: number is not UserId
 * getUser(wrap<UserId>(42));      // OK — compiles to getUser(42)
 *
 * // Prevent mixing up similar types:
 * function move(distance: Meters, duration: Seconds): void { ... }
 * const d = wrap<Meters>(100);
 * const t = wrap<Seconds>(10);
 * move(d, t);  // OK
 * move(t, d);  // Error: Seconds is not Meters
 * ```
 *
 * The `wrap`/`unwrap`/`newtypeCtor` macro definitions live in the package's
 * `./macros` entry (loaded by the transformer at build time). This module is
 * runtime-only and does NOT import `typescript`.
 */

// ============================================================================
// Type-Level API
// ============================================================================

/** Brand symbol for newtype discrimination */
declare const __brand: unique symbol;

/**
 * A branded type that wraps Base with a phantom Brand tag.
 * At runtime this is just Base — the brand exists only in the type system.
 */
export type Newtype<Base, Brand extends string> = Base & {
  readonly [__brand]: Brand;
};

/**
 * Extract the base type from a Newtype.
 */
export type UnwrapNewtype<T> = T extends Newtype<infer Base, string> ? Base : T;

/**
 * Wrap a value in a Newtype. Compiles away to nothing.
 *
 * @example
 * const userId = wrap<UserId>(42); // Compiles to: const userId = 42;
 */
export function wrap<T>(value: UnwrapNewtype<T>): T {
  return value as T;
}

/**
 * Unwrap a Newtype to its base value. Compiles away to nothing.
 *
 * @example
 * const raw = unwrap(userId); // Compiles to: const raw = userId;
 */
export function unwrap<T>(value: T): UnwrapNewtype<T> {
  return value as UnwrapNewtype<T>;
}

/**
 * Create a constructor function for a Newtype.
 * The constructor itself compiles away — it's just the identity function.
 *
 * @example
 * const UserId = newtypeCtor<UserId>();
 * const id = UserId(42); // Compiles to: const id = 42;
 */
export function newtypeCtor<T>(): (value: UnwrapNewtype<T>) => T {
  return (value) => value as T;
}

/**
 * Create a validated constructor for a Newtype.
 * The validation runs at runtime, but the wrapping is zero-cost.
 *
 * @example
 * const Email = validatedNewtype<Email>((s: string) => s.includes("@"));
 * const email = Email("user@example.com"); // Validates then returns the string
 */
export function validatedNewtype<T>(
  validate: (value: UnwrapNewtype<T>) => boolean,
  errorMessage?: string
): (value: UnwrapNewtype<T>) => T {
  return (value) => {
    if (!validate(value)) {
      throw new Error(errorMessage ?? `Invalid value for newtype: ${value}`);
    }
    return value as T;
  };
}

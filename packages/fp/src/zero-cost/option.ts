/**
 * Zero-Cost Option<T> - `T | null` with plain helper functions.
 *
 * Runtime-only module: it imports nothing from `typescript` or
 * `@typesugar/core`. The compile-time macro that inlines
 * `ZeroCostOptionOps.from/some/isSome/isNone` calls lives in
 * `@typesugar/fp/macros` (loaded by the transformer via this package's
 * `typesugar.macros` manifest entry), so importing this module at runtime does
 * not pull in the compiler.
 *
 * @example
 * ```typescript
 * const name = ZeroCostOptionOps.from(user.name); // string | null
 * if (ZeroCostOptionOps.isSome(name)) console.log(name.trim());
 * ```
 */

// ============================================================================
// Type-Level API
// ============================================================================

/** Represents an optional value — either Some(T) or None */
export type ZeroCostOption<T> = T | null;

/** Option namespace with constructors and utilities */
export const ZeroCostOptionOps = {
  /** Wrap a nullable value into an Option */
  from<T>(value: T | null | undefined): ZeroCostOption<T> {
    return value ?? null;
  },

  /** Create a Some value */
  some<T>(value: T): ZeroCostOption<T> {
    return value;
  },

  /** The None value */
  none: null as ZeroCostOption<never>,

  /** Check if an Option is Some */
  isSome<T>(opt: ZeroCostOption<T>): opt is T {
    return opt != null;
  },

  /** Check if an Option is None */
  isNone<T>(opt: ZeroCostOption<T>): opt is null {
    return opt == null;
  },
} as const;

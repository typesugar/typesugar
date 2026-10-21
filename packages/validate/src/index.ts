/**
 * @module @typesugar/validate — runtime entry (Case-1, PEP-050).
 *
 * This `.` entry is **runtime-only** and does NOT import `typescript`. It exposes
 * the macro stubs (which throw if the transformer didn't run) plus the runtime
 * schema/types modules. The macro *definitions* (which import `typescript`) live
 * in the `./macros` entry, loaded by the transformer at build time.
 */

const NEEDS_TRANSFORMER =
  "is a compile-time macro and requires the typesugar transformer. " +
  "See https://github.com/typesugar/typesugar for setup instructions.";

/**
 * `is<T>()` returns a type guard `(value: unknown) => value is T`;
 * `is<T>(value)` checks `value` immediately and returns a boolean that
 * narrows it (typia's `is<T>(input)` shape).
 */
export function is<T>(): (value: unknown) => value is T;
export function is<T>(value: unknown): value is T;
export function is(..._args: unknown[]): unknown {
  throw new Error(`is<T>() ${NEEDS_TRANSFORMER}`);
}

/**
 * `assert<T>()` returns an assertion `(value: unknown) => T` that throws on
 * failure; `assert<T>(value)` asserts `value` immediately and returns it.
 *
 * Also exported as {@link assertType}, which can sit next to
 * @typesugar/testing's `assert(cond)` in one file.
 */
export function assert<T>(): (value: unknown) => T;
export function assert<T>(value: unknown): T;
export function assert(..._args: unknown[]): unknown {
  throw new Error(`assert<T>() ${NEEDS_TRANSFORMER}`);
}

/** Alias of {@link assert}: `assertType<T>()` / `assertType<T>(value)`. */
export function assertType<T>(): (value: unknown) => T;
export function assertType<T>(value: unknown): T;
export function assertType(..._args: unknown[]): unknown {
  throw new Error(`assertType<T>() ${NEEDS_TRANSFORMER}`);
}

/**
 * `validate<T>()` returns a validator producing
 * `ValidatedNel<ValidationError, T>`; `validate<T>(value)` validates `value`
 * immediately.
 */
export function validate<T>(): (
  value: unknown
) => import("@typesugar/fp").ValidatedNel<import("./types").ValidationError, T>;
export function validate<T>(
  value: unknown
): import("@typesugar/fp").ValidatedNel<import("./types").ValidationError, T>;
export function validate(..._args: unknown[]): unknown {
  throw new Error(`validate<T>() ${NEEDS_TRANSFORMER}`);
}

export * from "./types";
export * from "./schema";

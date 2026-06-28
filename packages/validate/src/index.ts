/**
 * @module @typesugar/validate — runtime entry (Case-1, PEP-050).
 *
 * This `.` entry is **runtime-only** and does NOT import `typescript`. It exposes
 * the macro stubs (which throw if the transformer didn't run) plus the runtime
 * schema/types modules. The macro *definitions* (which import `typescript`) live
 * in the `./macros` entry, loaded by the transformer at build time.
 */

export function is<T>(): (value: unknown) => value is T {
  throw new Error(
    "is<T>() is a compile-time macro and requires the typesugar transformer. " +
      "See https://github.com/typesugar/typesugar for setup instructions."
  );
}

export function assert<T>(): (value: unknown) => T {
  throw new Error("assert<T>() is a compile-time macro and requires the typesugar transformer.");
}

export function validate<T>(): (
  value: unknown
) => import("@typesugar/fp").ValidatedNel<import("./types").ValidationError, T> {
  throw new Error("validate<T>() is a compile-time macro and requires the typesugar transformer.");
}

export * from "./types";
export * from "./schema";

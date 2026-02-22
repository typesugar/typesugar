/**
 * @module @typesugar/validate
 * Zero-cost validation and schema macros for typesugar.
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

// Register macros if this file is imported in a compiler context
import { globalRegistry } from "@typesugar/core";
try {
  // Use dynamic import so it doesn't fail in pure runtime environments
  // where the compiler API isn't present, but still registers in the transformer
  import("./macros.js")
    .then((m) => {
      m.register(globalRegistry);
    })
    .catch(() => {});
} catch (e) {
  // Runtime environment, ignore
}

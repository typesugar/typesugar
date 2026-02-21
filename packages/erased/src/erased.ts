/**
 * Core operations for creating and interacting with erased values.
 *
 * An erased value wraps a concrete value alongside a vtable of capability
 * methods. The concrete type is forgotten — all access goes through the
 * vtable. This enables heterogeneous collections where every element
 * shares a common set of capabilities.
 *
 * @module
 */

import type {
  Capability,
  Erased,
  UnionOfVtables,
  WithShow,
  WithEq,
  WithOrd,
  WithHash,
  WithClone,
  WithDebug,
} from "./types.js";
import type {
  ShowCapability,
  EqCapability,
} from "./capabilities.js";

/**
 * Create an erased value with an explicit vtable.
 *
 * @param value - The concrete value to erase.
 * @param vtable - A record of method implementations covering all `Caps`.
 * @returns An {@link Erased} value carrying the vtable.
 */
export function eraseWith<T, Caps extends readonly Capability[]>(
  value: T,
  vtable: UnionOfVtables<Caps>,
): Erased<Caps> {
  return { __erased__: true, __value: value, __vtable: vtable };
}

/**
 * Create an `Erased<[ShowCapability]>` from a value and a show function.
 *
 * @param value - The value to wrap.
 * @param showFn - Converts the value to a string.
 */
export function showable<T>(
  value: T,
  showFn: (v: T) => string,
): Erased<[ShowCapability]> {
  return eraseWith<T, [ShowCapability]>(value, {
    show: (v) => showFn(v as T),
  });
}

/**
 * Create an `Erased<[EqCapability]>` from a value and an equals function.
 *
 * @param value - The value to wrap.
 * @param equalsFn - Compares two values for equality.
 */
export function equatable<T>(
  value: T,
  equalsFn: (a: T, b: T) => boolean,
): Erased<[EqCapability]> {
  return eraseWith<T, [EqCapability]>(value, {
    equals: (a, b) => equalsFn(a as T, b as T),
  });
}

/**
 * Create an `Erased<[ShowCapability, EqCapability]>` with both show and
 * equals capabilities.
 *
 * @param value - The value to wrap.
 * @param showFn - Converts the value to a string.
 * @param equalsFn - Compares two values for equality.
 */
export function showableEq<T>(
  value: T,
  showFn: (v: T) => string,
  equalsFn: (a: T, b: T) => boolean,
): Erased<[ShowCapability, EqCapability]> {
  return eraseWith<T, [ShowCapability, EqCapability]>(value, {
    show: (v) => showFn(v as T),
    equals: (a, b) => equalsFn(a as T, b as T),
  });
}

/**
 * Extract the raw value from an erased wrapper.
 *
 * **Unsafe** — the caller is responsible for providing the correct type
 * parameter. If `T` does not match the actual wrapped value, behaviour is
 * undefined.
 *
 * @typeParam T - The expected concrete type.
 * @param erased - The erased value to unwrap.
 */
export function unwrapErased<T>(erased: Erased<any>): T {
  return erased.__value as T;
}

/**
 * Call a named method from the vtable of an erased value.
 *
 * @param erased - The erased value whose vtable to invoke.
 * @param method - The method name.
 * @param args - Additional arguments forwarded to the vtable method.
 * @returns The return value of the vtable method.
 * @throws {Error} If the method is not present in the vtable.
 */
export function callMethod(
  erased: Erased<readonly Capability[]>,
  method: string,
  ...args: unknown[]
): unknown {
  const fn = (erased.__vtable as Record<string, Function>)[method];
  if (typeof fn !== "function") {
    throw new Error(
      `Method "${method}" not found in erased vtable. ` +
        `Available: [${Object.keys(erased.__vtable).join(", ")}]`,
    );
  }
  return fn(...args);
}

// ---------------------------------------------------------------------------
// Convenience wrappers for common capabilities
// ---------------------------------------------------------------------------

/**
 * Show an erased value using its Show capability.
 *
 * Accepts any erased value whose vtable includes a `show` method.
 */
export function show(erased: WithShow): string {
  return erased.__vtable.show(erased.__value);
}

/**
 * Compare two erased values for equality using their Eq capability.
 *
 * Accepts any erased values whose vtables include an `equals` method.
 */
export function equals(a: WithEq, b: WithEq): boolean {
  return a.__vtable.equals(a.__value, b.__value);
}

/**
 * Compare the ordering of two erased values using their Ord capability.
 *
 * Returns a negative number if `a < b`, zero if equal, positive if `a > b`.
 */
export function compare(a: WithOrd, b: WithOrd): number {
  return a.__vtable.compare(a.__value, b.__value);
}

/**
 * Hash an erased value using its Hash capability.
 */
export function hash(erased: WithHash): number {
  return erased.__vtable.hash(erased.__value);
}

/**
 * Deep-copy an erased value using its Clone capability.
 *
 * The cloned value retains the same vtable (capabilities are structural,
 * not per-instance, so sharing is safe).
 */
export function clone<E extends WithClone>(erased: E): E {
  const cloneFn = (erased.__vtable as Record<string, unknown>)["clone"];
  if (typeof cloneFn !== "function") {
    throw new Error(
      "clone() requires CloneCapability in the erased value's vtable",
    );
  }
  const clonedValue = cloneFn(erased.__value);
  return { ...erased, __value: clonedValue } as E;
}

/**
 * Produce a debug/inspect representation using the Debug capability.
 *
 * Accepts any erased value whose vtable includes a `debug` method.
 */
export function debug(erased: WithDebug): string {
  return erased.__vtable.debug(erased.__value);
}

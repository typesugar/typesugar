/**
 * Capability widening and narrowing for erased values.
 *
 * - **Widen** drops capabilities from the type. This is always safe and
 *   zero-cost (identity at runtime).
 * - **Narrow** adds capabilities. This requires a runtime check that the
 *   vtable actually contains the required methods.
 *
 * @module
 */

import type { Capability, Erased, UnionOfVtables } from "./types.js";

/**
 * Widen an erased value by forgetting capabilities.
 *
 * Zero-cost at runtime — this is just a type-level cast. The vtable
 * still contains all original methods, but the type system no longer
 * exposes them.
 *
 * @typeParam Full - The original capability tuple.
 * @typeParam Sub - A subset of `Full` to retain in the type.
 * @param erased - The erased value to widen.
 */
export function widen<Full extends readonly Capability[], Sub extends readonly Capability[]>(
  erased: Erased<Full>
): Erased<Sub> {
  return erased as unknown as Erased<Sub>;
}

/**
 * Narrow an erased value by asserting additional capabilities.
 *
 * Returns the narrowed value if the vtable already contains all
 * required methods, or `null` if any method is missing.
 *
 * @typeParam From - The current capability tuple.
 * @typeParam To - The desired capability tuple (superset of `From`).
 * @param erased - The erased value to narrow.
 * @param requiredMethods - Method names that must exist in the vtable
 *   for the narrowing to succeed.
 */
export function narrow<From extends readonly Capability[], To extends readonly Capability[]>(
  erased: Erased<From>,
  requiredMethods: readonly string[]
): Erased<To> | null {
  const vtable = erased.__vtable as Record<string, unknown>;
  for (const method of requiredMethods) {
    if (typeof vtable[method] !== "function") {
      return null;
    }
  }
  return erased as unknown as Erased<To>;
}

/**
 * Narrow an erased value by providing additional vtable methods.
 *
 * Merges `additionalVtable` into the existing vtable, producing a
 * value with a wider capability set.
 *
 * @typeParam From - The current capability tuple.
 * @typeParam To - The desired capability tuple after adding methods.
 * @param erased - The erased value to extend.
 * @param additionalVtable - Extra method implementations to merge in.
 */
export function extendCapabilities<
  From extends readonly Capability[],
  To extends readonly Capability[],
>(erased: Erased<From>, additionalVtable: Partial<UnionOfVtables<To>>): Erased<To> {
  const merged = { ...erased.__vtable, ...additionalVtable } as unknown as UnionOfVtables<To>;
  return { __erased__: true, __value: erased.__value, __vtable: merged };
}

/**
 * Check whether an erased value's vtable contains a method by name.
 *
 * Useful for runtime capability detection without committing to a
 * full narrowing.
 *
 * @param erased - Any erased value.
 * @param methodName - The method name to probe for.
 */
export function hasCapability(erased: Erased<readonly Capability[]>, methodName: string): boolean {
  return typeof (erased.__vtable as Record<string, unknown>)[methodName] === "function";
}

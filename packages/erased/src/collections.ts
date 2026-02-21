/**
 * Heterogeneous collection utilities for erased values.
 *
 * These operate on arrays of {@link Erased} values that share a common
 * set of capabilities. Because every element carries its own vtable,
 * the concrete types can differ while operations remain type-safe.
 *
 * @module
 */

import type {
  Capability,
  Erased,
  WithShow,
  WithEq,
  WithOrd,
  WithHash,
} from "./types.js";
import { show, equals, compare, hash } from "./erased.js";

/** A heterogeneous list where all elements share the same capabilities. */
export type ErasedList<Caps extends readonly Capability[]> = ReadonlyArray<
  Erased<Caps>
>;

/**
 * Map a function over every element of an erased list.
 *
 * @param list - The erased list to map over.
 * @param f - A function applied to each erased element.
 */
export function mapErased<Caps extends readonly Capability[], R>(
  list: ErasedList<Caps>,
  f: (erased: Erased<Caps>) => R,
): R[] {
  return list.map(f);
}

/**
 * Filter elements of an erased list by a predicate.
 *
 * @param list - The erased list to filter.
 * @param predicate - Keep elements for which this returns `true`.
 */
export function filterErased<Caps extends readonly Capability[]>(
  list: ErasedList<Caps>,
  predicate: (erased: Erased<Caps>) => boolean,
): ErasedList<Caps> {
  return list.filter(predicate);
}

/**
 * Show every value in a list using the Show capability.
 *
 * @param list - Elements must have a `show` method in their vtable.
 */
export function showAll(list: readonly WithShow[]): string[] {
  return list.map((e) => show(e));
}

/**
 * Sort an erased list using the Ord capability.
 *
 * Returns a new sorted array — the input is not mutated.
 *
 * @param list - Elements must have a `compare` method in their vtable.
 */
export function sortErased<E extends WithOrd>(list: readonly E[]): E[] {
  return [...list].sort((a, b) => compare(a, b));
}

/**
 * Remove consecutive duplicates from an erased list using Eq.
 *
 * For full deduplication, sort the list first (or use {@link groupByHash}).
 *
 * @param list - Elements must have an `equals` method in their vtable.
 */
export function dedup<E extends WithEq>(list: readonly E[]): E[] {
  if (list.length === 0) return [];

  const result: E[] = [list[0]];
  for (let i = 1; i < list.length; i++) {
    const prev = result[result.length - 1];
    const curr = list[i];
    if (!equals(prev, curr)) {
      result.push(curr);
    }
  }
  return result;
}

/**
 * Group erased values by their hash code.
 *
 * Values with the same hash land in the same bucket. Within a bucket,
 * values are further distinguishable via Eq.
 *
 * @param list - Elements must have `hash` and `equals` methods.
 */
export function groupByHash<E extends WithHash & WithEq>(
  list: readonly E[],
): Map<number, E[]> {
  const groups = new Map<number, E[]>();
  for (const item of list) {
    const h = hash(item);
    let bucket = groups.get(h);
    if (bucket === undefined) {
      bucket = [];
      groups.set(h, bucket);
    }
    bucket.push(item);
  }
  return groups;
}

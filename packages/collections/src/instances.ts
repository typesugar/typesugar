/**
 * Typeclass instances for native JS types and hash-based collections.
 */

import type { Eq, Hash } from "@typesugar/std";
import type {
  IterableOnce,
  Iterable,
  Seq,
  SetLike,
  MapLike,
  MutableSetLike,
  MutableMapLike,
} from "./typeclasses.js";
import { HashSet } from "./hash-set.js";
import { HashMap } from "./hash-map.js";

// ============================================================================
// Array instances
// ============================================================================

export const arrayIterableOnce: IterableOnce<unknown[], unknown> = {
  fold: (i, z, f) => {
    let acc = z;
    for (let idx = 0; idx < i.length; idx++) acc = f(acc, i[idx]);
    return acc;
  },
};

export const arrayIterable: Iterable<unknown[], unknown> = {
  ...arrayIterableOnce,
  iterator: (i) => i[Symbol.iterator]() as IterableIterator<unknown>,
};

export const arraySeq: Seq<unknown[], unknown> = {
  ...arrayIterable,
  length: (s) => s.length,
  nth: (s, index) => s[index],
};

/** Typed factory for Array instances */
export function arraySeqOf<A>(): Seq<A[], A> {
  return arraySeq as unknown as Seq<A[], A>;
}

// ============================================================================
// Native Set instances
// ============================================================================

export function nativeSetLike<K>(): SetLike<Set<K>, K> {
  return {
    fold: (i, z, f) => {
      let acc = z;
      for (const k of i) acc = f(acc, k);
      return acc;
    },
    iterator: (i) => i.values(),
    has: (s, k) => s.has(k),
    size: (s) => s.size,
  };
}

export function nativeMutableSetLike<K>(): MutableSetLike<Set<K>, K> {
  return {
    ...nativeSetLike<K>(),
    create: () => new Set<K>(),
    add: (s, k) => { s.add(k); },
    delete: (s, k) => s.delete(k),
    clear: (s) => s.clear(),
  };
}

// ============================================================================
// Native Map instances
// ============================================================================

export function nativeMapLike<K, V>(): MapLike<Map<K, V>, K, V> {
  return {
    fold: (i, z, f) => {
      let acc = z;
      for (const entry of i) acc = f(acc, entry);
      return acc;
    },
    iterator: (i) => i.entries(),
    get: (m, k) => m.get(k),
    has: (m, k) => m.has(k),
    size: (m) => m.size,
    keys: (m) => m.keys(),
    values: (m) => m.values(),
  };
}

export function nativeMutableMapLike<K, V>(): MutableMapLike<Map<K, V>, K, V> {
  return {
    ...nativeMapLike<K, V>(),
    create: () => new Map<K, V>(),
    set: (m, k, v) => { m.set(k, v); },
    delete: (m, k) => m.delete(k),
    clear: (m) => m.clear(),
  };
}

// ============================================================================
// String instances
// ============================================================================

export const stringIterable: Iterable<string, string> = {
  fold: (i, z, f) => {
    let acc = z;
    for (let idx = 0; idx < i.length; idx++) acc = f(acc, i[idx]);
    return acc;
  },
  iterator: (i) => i[Symbol.iterator]() as IterableIterator<string>,
};

export const stringSeq: Seq<string, string> = {
  ...stringIterable,
  length: (s) => s.length,
  nth: (s, index) => (index >= 0 && index < s.length ? s[index] : undefined),
};

// ============================================================================
// HashSet instances
// ============================================================================

export function hashSetLike<K>(eq: Eq<K>, hash: Hash<K>): SetLike<HashSet<K>, K> {
  return {
    fold: (i, z, f) => {
      let acc = z;
      for (const k of i) acc = f(acc, k);
      return acc;
    },
    iterator: (i) => i.values(),
    has: (s, k) => s.has(k),
    size: (s) => s.size,
  };
}

export function hashMutableSetLike<K>(eq: Eq<K>, hash: Hash<K>): MutableSetLike<HashSet<K>, K> {
  return {
    ...hashSetLike(eq, hash),
    create: () => new HashSet<K>(eq, hash),
    add: (s, k) => { s.add(k); },
    delete: (s, k) => s.delete(k),
    clear: (s) => s.clear(),
  };
}

// ============================================================================
// HashMap instances
// ============================================================================

export function hashMapLike<K, V>(eq: Eq<K>, hash: Hash<K>): MapLike<HashMap<K, V>, K, V> {
  return {
    fold: (i, z, f) => {
      let acc = z;
      for (const entry of i) acc = f(acc, entry);
      return acc;
    },
    iterator: (i) => i.entries(),
    get: (m, k) => m.get(k),
    has: (m, k) => m.has(k),
    size: (m) => m.size,
    keys: (m) => m.keys(),
    values: (m) => m.values(),
  };
}

export function hashMutableMapLike<K, V>(
  eq: Eq<K>,
  hash: Hash<K>,
): MutableMapLike<HashMap<K, V>, K, V> {
  return {
    ...hashMapLike<K, V>(eq, hash),
    create: () => new HashMap<K, V>(eq, hash),
    set: (m, k, v) => { m.set(k, v); },
    delete: (m, k) => m.delete(k),
    clear: (m) => m.clear(),
  };
}

// ============================================================================
// Auto-derivation: Eq<K> + Hash<K> → MutableSetLike / MutableMapLike
// ============================================================================

/**
 * Given Eq<K> and Hash<K>, produce a MutableSetLike backed by HashSet<K>.
 * This is the auto-derivation entry point.
 */
export function mutableSetFor<K>(eq: Eq<K>, hash: Hash<K>): MutableSetLike<HashSet<K>, K> {
  return hashMutableSetLike(eq, hash);
}

/**
 * Given Eq<K> and Hash<K>, produce a MutableMapLike backed by HashMap<K, V>.
 * This is the auto-derivation entry point.
 */
export function mutableMapFor<K, V>(eq: Eq<K>, hash: Hash<K>): MutableMapLike<HashMap<K, V>, K, V> {
  return hashMutableMapLike<K, V>(eq, hash);
}

/**
 * Map & Set Extension Methods
 *
 * The best from:
 * - Scala (mapValues, filterKeys, collect, groupBy, toList, getOrElse, updated)
 * - Kotlin (getOrDefault, getOrPut, filterKeys, filterValues, mapKeys, mapValues, toList)
 * - Haskell (Data.Map: union, intersection, difference, mapWithKey, foldlWithKey)
 * - Ruby (merge, transform_keys, transform_values, select, reject, invert)
 * - Java (computeIfAbsent, merge, replaceAll)
 * - Most-requested JS/TS: getOrDefault, groupBy, invert, merge, toObject
 */

// ============================================================================
// Map Extensions
// ============================================================================

export function getOrDefault<K, V>(map: Map<K, V>, key: K, defaultValue: V): V {
  return map.has(key) ? map.get(key)! : defaultValue;
}

export function getOrPut<K, V>(map: Map<K, V>, key: K, factory: () => V): V {
  if (map.has(key)) return map.get(key)!;
  const value = factory();
  map.set(key, value);
  return value;
}

export function mapMapValues<K, V, U>(map: Map<K, V>, fn: (value: V, key: K) => U): Map<K, U> {
  const result = new Map<K, U>();
  for (const [k, v] of map) result.set(k, fn(v, k));
  return result;
}

export function mapMapKeys<K, V, K2>(map: Map<K, V>, fn: (key: K, value: V) => K2): Map<K2, V> {
  const result = new Map<K2, V>();
  for (const [k, v] of map) result.set(fn(k, v), v);
  return result;
}

export function filterMap<K, V>(map: Map<K, V>, pred: (value: V, key: K) => boolean): Map<K, V> {
  const result = new Map<K, V>();
  for (const [k, v] of map) {
    if (pred(v, k)) result.set(k, v);
  }
  return result;
}

export function filterMapKeys<K, V>(map: Map<K, V>, pred: (key: K) => boolean): Map<K, V> {
  return filterMap(map, (_, k) => pred(k));
}

export function filterMapValues<K, V>(map: Map<K, V>, pred: (value: V) => boolean): Map<K, V> {
  return filterMap(map, (v) => pred(v));
}

export function mergeMap<K, V>(
  a: Map<K, V>,
  b: Map<K, V>,
  resolve?: (va: V, vb: V, key: K) => V,
): Map<K, V> {
  const result = new Map(a);
  for (const [k, v] of b) {
    if (result.has(k) && resolve) {
      result.set(k, resolve(result.get(k)!, v, k));
    } else {
      result.set(k, v);
    }
  }
  return result;
}

export function mapUnion<K, V>(a: Map<K, V>, b: Map<K, V>): Map<K, V> {
  return mergeMap(a, b);
}

export function mapIntersection<K, V>(a: Map<K, V>, b: Map<K, V>): Map<K, V> {
  const result = new Map<K, V>();
  for (const [k, v] of a) {
    if (b.has(k)) result.set(k, v);
  }
  return result;
}

export function mapDifference<K, V>(a: Map<K, V>, b: Map<K, V>): Map<K, V> {
  const result = new Map<K, V>();
  for (const [k, v] of a) {
    if (!b.has(k)) result.set(k, v);
  }
  return result;
}

export function invertMap<K, V>(map: Map<K, V>): Map<V, K> {
  const result = new Map<V, K>();
  for (const [k, v] of map) result.set(v, k);
  return result;
}

export function groupMapBy<K, V, G>(
  map: Map<K, V>,
  fn: (value: V, key: K) => G,
): Map<G, Map<K, V>> {
  const result = new Map<G, Map<K, V>>();
  for (const [k, v] of map) {
    const group = fn(v, k);
    if (!result.has(group)) result.set(group, new Map());
    result.get(group)!.set(k, v);
  }
  return result;
}

export function mapToObject<V>(map: Map<string, V>): Record<string, V> {
  const result: Record<string, V> = {};
  for (const [k, v] of map) result[k] = v;
  return result;
}

export function mapToPairs<K, V>(map: Map<K, V>): [K, V][] {
  return [...map.entries()];
}

export function mapFromPairs<K, V>(pairs: readonly [K, V][]): Map<K, V> {
  return new Map(pairs);
}

export function mapFold<K, V, B>(map: Map<K, V>, init: B, fn: (acc: B, value: V, key: K) => B): B {
  let acc = init;
  for (const [k, v] of map) acc = fn(acc, v, k);
  return acc;
}

// ============================================================================
// Set Extensions
// ============================================================================

export function setUnion<A>(a: Set<A>, b: Set<A>): Set<A> {
  return new Set([...a, ...b]);
}

export function setIntersection<A>(a: Set<A>, b: Set<A>): Set<A> {
  const result = new Set<A>();
  for (const x of a) {
    if (b.has(x)) result.add(x);
  }
  return result;
}

export function setDifference<A>(a: Set<A>, b: Set<A>): Set<A> {
  const result = new Set<A>();
  for (const x of a) {
    if (!b.has(x)) result.add(x);
  }
  return result;
}

export function setSymmetricDifference<A>(a: Set<A>, b: Set<A>): Set<A> {
  const result = new Set<A>();
  for (const x of a) if (!b.has(x)) result.add(x);
  for (const x of b) if (!a.has(x)) result.add(x);
  return result;
}

export function isSubset<A>(a: Set<A>, b: Set<A>): boolean {
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

export function isSuperset<A>(a: Set<A>, b: Set<A>): boolean {
  return isSubset(b, a);
}

export function isDisjoint<A>(a: Set<A>, b: Set<A>): boolean {
  for (const x of a) if (b.has(x)) return false;
  return true;
}

export function setMap<A, B>(set: Set<A>, fn: (a: A) => B): Set<B> {
  const result = new Set<B>();
  for (const x of set) result.add(fn(x));
  return result;
}

export function setFilter<A>(set: Set<A>, pred: (a: A) => boolean): Set<A> {
  const result = new Set<A>();
  for (const x of set) if (pred(x)) result.add(x);
  return result;
}

export function setPartition<A>(set: Set<A>, pred: (a: A) => boolean): [Set<A>, Set<A>] {
  const yes = new Set<A>();
  const no = new Set<A>();
  for (const x of set) (pred(x) ? yes : no).add(x);
  return [yes, no];
}

export function setToArray<A>(set: Set<A>): A[] {
  return [...set];
}

export function powerSet<A>(set: Set<A>): Set<Set<A>> {
  const arr = [...set];
  const result = new Set<Set<A>>();
  const total = 1 << arr.length;
  for (let mask = 0; mask < total; mask++) {
    const subset = new Set<A>();
    for (let i = 0; i < arr.length; i++) {
      if (mask & (1 << i)) subset.add(arr[i]);
    }
    result.add(subset);
  }
  return result;
}

// ============================================================================
// Aggregate
// ============================================================================

export const MapExt = {
  getOrDefault,
  getOrPut,
  mapValues: mapMapValues,
  mapKeys: mapMapKeys,
  filter: filterMap,
  filterKeys: filterMapKeys,
  filterValues: filterMapValues,
  merge: mergeMap,
  union: mapUnion,
  intersection: mapIntersection,
  difference: mapDifference,
  invert: invertMap,
  groupBy: groupMapBy,
  toObject: mapToObject,
  toPairs: mapToPairs,
  fromPairs: mapFromPairs,
  fold: mapFold,
} as const;

export const SetExt = {
  union: setUnion,
  intersection: setIntersection,
  difference: setDifference,
  symmetricDifference: setSymmetricDifference,
  isSubset,
  isSuperset,
  isDisjoint,
  map: setMap,
  filter: setFilter,
  partition: setPartition,
  toArray: setToArray,
  powerSet,
} as const;

"use extension";
/**
 * Object/Record Extension Methods
 *
 * All exported functions take an object as their first argument,
 * enabling method-call syntax: `obj.pick(['a', 'b'])`, `obj.omit(['c'])`, etc.
 *
 * Inspired by:
 * - Lodash (pick, omit, mapValues, mapKeys, merge, defaults, invert, toPairs, fromPairs)
 * - Ramda (assoc, dissoc, evolve, mergeDeepRight, path, pathOr, lens)
 * - Kotlin (toList, toMap, filterKeys, filterValues, mapKeys, mapValues)
 * - Ruby (slice, except, transform_keys, transform_values, deep_merge)
 * - Most-requested JS/TS: deep clone, deep merge, deep equal, get/set path, diff
 */

/**
 * A fresh prototype-less record. The helpers that build a record from
 * caller-supplied keys (pickBy, mapValues, mapKeys, mapEntries, invert,
 * fromPairs, fromMap) use it, so a key like "constructor" or "__proto__" is
 * stored as plain data instead of hitting `Object.prototype`. Such results have
 * no inherited methods: use `Object.hasOwn(r, k)`, not `r.hasOwnProperty(k)`.
 */
function dict<V>(): Record<string, V> {
  return Object.create(null) as Record<string, V>;
}

// ============================================================================
// Selection (Lodash pick/omit, Ruby slice/except)
// ============================================================================

export function pick<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (key in obj) result[key] = obj[key];
  }
  return result;
}

export function omit<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Omit<T, K> {
  const result = { ...obj };
  for (const key of keys) delete (result as Record<string, unknown>)[key as string];
  return result as Omit<T, K>;
}

export function pickBy<V>(
  obj: Record<string, V>,
  pred: (value: V, key: string) => boolean
): Record<string, V> {
  const result = dict<V>();
  for (const [k, v] of Object.entries(obj)) {
    if (pred(v, k)) result[k] = v;
  }
  return result;
}

export function omitBy<V>(
  obj: Record<string, V>,
  pred: (value: V, key: string) => boolean
): Record<string, V> {
  return pickBy(obj, (v, k) => !pred(v, k));
}

// ============================================================================
// Transformation (Lodash mapValues/mapKeys, Ruby transform_keys/transform_values)
// ============================================================================

export function mapValues<V, U>(
  obj: Record<string, V>,
  fn: (value: V, key: string) => U
): Record<string, U> {
  const result = dict<U>();
  for (const [k, v] of Object.entries(obj)) result[k] = fn(v, k);
  return result;
}

export function mapKeys<V>(
  obj: Record<string, V>,
  fn: (key: string, value: V) => string
): Record<string, V> {
  const result = dict<V>();
  for (const [k, v] of Object.entries(obj)) result[fn(k, v)] = v;
  return result;
}

export function mapEntries<V, U>(
  obj: Record<string, V>,
  fn: (key: string, value: V) => [string, U]
): Record<string, U> {
  const result = dict<U>();
  for (const [k, v] of Object.entries(obj)) {
    const [newK, newV] = fn(k, v);
    result[newK] = newV;
  }
  return result;
}

export function filterKeys<V>(
  obj: Record<string, V>,
  pred: (key: string) => boolean
): Record<string, V> {
  return pickBy(obj, (_, k) => pred(k));
}

export function filterValues<V>(
  obj: Record<string, V>,
  pred: (value: V) => boolean
): Record<string, V> {
  return pickBy(obj, (v) => pred(v));
}

// ============================================================================
// Merging (Lodash merge/defaults, Ruby deep_merge)
// ============================================================================

export function defaults<T extends object>(obj: T, ...sources: Partial<T>[]): T {
  const result = { ...obj };
  for (const source of sources) {
    for (const key of Object.keys(source) as (keyof T)[]) {
      if (result[key] === undefined) {
        result[key] = source[key] as T[keyof T];
      }
    }
  }
  return result;
}

export function deepMerge<T extends Record<string, unknown>>(
  target: T,
  ...sources: Partial<T>[]
): T {
  const result = { ...target } as Record<string, unknown>;
  for (const source of sources) {
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
      if (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        result[key] !== null &&
        typeof result[key] === "object" &&
        !Array.isArray(result[key])
      ) {
        result[key] = deepMerge(
          result[key] as Record<string, unknown>,
          value as Record<string, unknown>
        );
      } else {
        result[key] = value;
      }
    }
  }
  return result as T;
}

// ============================================================================
// Path Access (Lodash get/set, Ramda path/pathOr)
// ============================================================================

export function getPath(obj: unknown, path: string | readonly string[]): unknown {
  const keys = typeof path === "string" ? path.split(".") : path;
  let current: unknown = obj;
  for (const key of keys) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export function getPathOr<T>(obj: unknown, path: string | readonly string[], defaultValue: T): T {
  const result = getPath(obj, path);
  return (result === undefined ? defaultValue : result) as T;
}

export function setPath<T extends Record<string, unknown>>(
  obj: T,
  path: string | readonly string[],
  value: unknown
): T {
  const keys = typeof path === "string" ? path.split(".") : [...path];
  if (keys.length === 0) return obj;

  const result = { ...obj } as Record<string, unknown>;
  let current = result;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    current[key] =
      current[key] != null && typeof current[key] === "object"
        ? { ...(current[key] as Record<string, unknown>) }
        : {};
    current = current[key] as Record<string, unknown>;
  }

  current[keys[keys.length - 1]] = value;
  return result as T;
}

// ============================================================================
// Inversion & Conversion (Lodash invert/toPairs/fromPairs)
// ============================================================================

export function invert(obj: Record<string, string>): Record<string, string> {
  const result = dict<string>();
  for (const [k, v] of Object.entries(obj)) result[v] = k;
  return result;
}

export function toPairs<V>(obj: Record<string, V>): [string, V][] {
  return Object.entries(obj);
}

export function fromPairs<V>(pairs: readonly [string, V][]): Record<string, V> {
  const result = dict<V>();
  for (const [k, v] of pairs) result[k] = v;
  return result;
}

export function toMap<V>(obj: Record<string, V>): Map<string, V> {
  return new Map(Object.entries(obj));
}

export function fromMap<V>(map: Map<string, V>): Record<string, V> {
  const result = dict<V>();
  for (const [k, v] of map) result[k] = v;
  return result;
}

// ============================================================================
// Deep Operations
// ============================================================================

export function deepClone<T>(obj: T): T {
  if (typeof structuredClone !== "undefined") return structuredClone(obj);
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Structural equality.
 *
 * - Primitives: `Object.is`, except `0` equals `-0` (so NaN equals NaN).
 * - Objects must share a prototype: `[1]` is not equal to `{ 0: 1 }`, and a
 *   class instance is not equal to a plain object with the same fields.
 * - Date (by time), RegExp (source + flags), boxed primitives (by value),
 *   Map (same keys by SameValueZero, deep-equal values), Set (same members by
 *   SameValueZero — members are not compared deeply), typed arrays / DataView
 *   (bytewise), arrays (element-wise), other objects (own enumerable string
 *   keys, deep-equal values).
 * - Cycles are handled.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  return deepEqualImpl(a, b, new Map());
}

function deepEqualImpl(a: unknown, b: unknown, seen: Map<object, Set<object>>): boolean {
  if (a === b || (a !== a && b !== b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;

  // Assume a pair already being compared is equal (cycle); a real difference
  // is found elsewhere in the walk.
  let partners = seen.get(a);
  if (partners?.has(b)) return true;
  if (!partners) seen.set(a, (partners = new Set()));
  partners.add(b);

  if (a instanceof Date) return Object.is(a.getTime(), (b as Date).getTime());
  if (a instanceof RegExp) {
    const rb = b as RegExp;
    return a.source === rb.source && a.flags === rb.flags;
  }
  if (a instanceof Number || a instanceof String || a instanceof Boolean) {
    const va = a.valueOf();
    const vb = (b as Number | String | Boolean).valueOf();
    if (!(va === vb || (va !== va && vb !== vb))) return false;
  }
  if (a instanceof Map) {
    const mb = b as Map<unknown, unknown>;
    if (a.size !== mb.size) return false;
    for (const [k, v] of a) {
      if (!mb.has(k) || !deepEqualImpl(v, mb.get(k), seen)) return false;
    }
    return true;
  }
  if (a instanceof Set) {
    const sb = b as Set<unknown>;
    if (a.size !== sb.size) return false;
    for (const v of a) if (!sb.has(v)) return false;
    return true;
  }
  if (ArrayBuffer.isView(a)) {
    const vb = b as ArrayBufferView;
    if (a.byteLength !== vb.byteLength) return false;
    const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const y = new Uint8Array(vb.buffer, vb.byteOffset, vb.byteLength);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
  }
  if (a instanceof ArrayBuffer) {
    const x = new Uint8Array(a);
    const y = new Uint8Array(b as ArrayBuffer);
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
  }
  if (Array.isArray(a)) {
    const ab = b as unknown[];
    if (a.length !== ab.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqualImpl(a[i], ab[i], seen)) return false;
    return true;
  }

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqualImpl((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], seen))
      return false;
  }
  return true;
}

export function deepFreeze<T extends object>(obj: T): Readonly<T> {
  Object.freeze(obj);
  for (const value of Object.values(obj)) {
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
      deepFreeze(value);
    }
  }
  return obj;
}

export function diff(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): Record<string, { from: unknown; to: unknown }> {
  const result: Record<string, { from: unknown; to: unknown }> = {};
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of allKeys) {
    if (!deepEqual(a[key], b[key])) {
      result[key] = { from: a[key], to: b[key] };
    }
  }
  return result;
}

// ============================================================================
// Predicates
// ============================================================================

export function isEmpty(obj: object): boolean {
  return Object.keys(obj).length === 0;
}

export function isNotEmpty(obj: object): boolean {
  return Object.keys(obj).length > 0;
}

export function hasKey(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export function size(obj: object): number {
  return Object.keys(obj).length;
}

// ============================================================================
// Aggregate
// ============================================================================

export const ObjectExt = {
  pick,
  omit,
  pickBy,
  omitBy,
  mapValues,
  mapKeys,
  mapEntries,
  filterKeys,
  filterValues,
  defaults,
  deepMerge,
  getPath,
  getPathOr,
  setPath,
  invert,
  toPairs,
  fromPairs,
  toMap,
  fromMap,
  deepClone,
  deepEqual,
  deepFreeze,
  diff,
  isEmpty,
  isNotEmpty,
  hasKey,
  size,
} as const;

/**
 * Object/Record Extension Methods
 *
 * The best from:
 * - Lodash (pick, omit, mapValues, mapKeys, merge, defaults, invert, toPairs, fromPairs)
 * - Ramda (assoc, dissoc, evolve, mergeDeepRight, path, pathOr, lens)
 * - Kotlin (toList, toMap, filterKeys, filterValues, mapKeys, mapValues)
 * - Ruby (slice, except, transform_keys, transform_values, deep_merge)
 * - Most-requested JS/TS: deep clone, deep merge, deep equal, get/set path, diff
 */

// ============================================================================
// Selection (Lodash pick/omit, Ruby slice/except)
// ============================================================================

export function pick<T extends object, K extends keyof T>(
  obj: T,
  keys: readonly K[],
): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (key in obj) result[key] = obj[key];
  }
  return result;
}

export function omit<T extends object, K extends keyof T>(
  obj: T,
  keys: readonly K[],
): Omit<T, K> {
  const result = { ...obj };
  for (const key of keys) delete (result as Record<string, unknown>)[key as string];
  return result as Omit<T, K>;
}

export function pickBy<V>(
  obj: Record<string, V>,
  pred: (value: V, key: string) => boolean,
): Record<string, V> {
  const result: Record<string, V> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (pred(v, k)) result[k] = v;
  }
  return result;
}

export function omitBy<V>(
  obj: Record<string, V>,
  pred: (value: V, key: string) => boolean,
): Record<string, V> {
  return pickBy(obj, (v, k) => !pred(v, k));
}

// ============================================================================
// Transformation (Lodash mapValues/mapKeys, Ruby transform_keys/transform_values)
// ============================================================================

export function mapValues<V, U>(
  obj: Record<string, V>,
  fn: (value: V, key: string) => U,
): Record<string, U> {
  const result: Record<string, U> = {};
  for (const [k, v] of Object.entries(obj)) result[k] = fn(v, k);
  return result;
}

export function mapKeys<V>(
  obj: Record<string, V>,
  fn: (key: string, value: V) => string,
): Record<string, V> {
  const result: Record<string, V> = {};
  for (const [k, v] of Object.entries(obj)) result[fn(k, v)] = v;
  return result;
}

export function mapEntries<V, U>(
  obj: Record<string, V>,
  fn: (key: string, value: V) => [string, U],
): Record<string, U> {
  const result: Record<string, U> = {};
  for (const [k, v] of Object.entries(obj)) {
    const [newK, newV] = fn(k, v);
    result[newK] = newV;
  }
  return result;
}

export function filterKeys<V>(
  obj: Record<string, V>,
  pred: (key: string) => boolean,
): Record<string, V> {
  return pickBy(obj, (_, k) => pred(k));
}

export function filterValues<V>(
  obj: Record<string, V>,
  pred: (value: V) => boolean,
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
          value as Record<string, unknown>,
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
  value: unknown,
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
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) result[v] = k;
  return result;
}

export function toPairs<V>(obj: Record<string, V>): [string, V][] {
  return Object.entries(obj);
}

export function fromPairs<V>(pairs: readonly [string, V][]): Record<string, V> {
  const result: Record<string, V> = {};
  for (const [k, v] of pairs) result[k] = v;
  return result;
}

export function toMap<V>(obj: Record<string, V>): Map<string, V> {
  return new Map(Object.entries(obj));
}

export function fromMap<V>(map: Map<string, V>): Record<string, V> {
  const result: Record<string, V> = {};
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

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }

  if (typeof a === "object" && typeof b === "object") {
    const keysA = Object.keys(a as object);
    const keysB = Object.keys(b as object);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((k) =>
      deepEqual(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
      ),
    );
  }

  return false;
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
  b: Record<string, unknown>,
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

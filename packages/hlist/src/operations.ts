/**
 * @typesugar/hlist — Runtime Operations
 *
 * Thin wrappers over array operations that maintain type-level tracking.
 * The runtime cost is minimal — all the value of HList lives in the types.
 */

import type {
  HList,
  HNil,
  Head,
  Tail,
  Last,
  Init,
  At,
  Reverse,
  Zip,
  SplitAt,
  LabeledField,
  LabeledHList,
  ValueByName,
  UpdateField,
  ProjectFields,
} from "./types.js";

// ============================================================================
// Construction
// ============================================================================

/**
 * Create an HList from positional arguments.
 *
 * @example
 * ```typescript
 * const list = hlist(1, "hello", true);
 * // HList<[number, string, boolean]>
 * ```
 */
export function hlist<T extends readonly unknown[]>(...args: T): HList<T> {
  return args as unknown as HList<T>;
}

/**
 * Create an empty HList.
 *
 * @example
 * ```typescript
 * const empty = hnil(); // HNil
 * ```
 */
export function hnil(): HNil {
  return [] as unknown as HNil;
}

/**
 * Create a `LabeledHList` from a record object.
 *
 * Labels are tracked at the type level; at runtime the values are stored
 * in a flat array in declaration order.
 *
 * @example
 * ```typescript
 * const rec = labeled({ x: 42, y: "hi" });
 * get(rec, "x"); // 42
 * ```
 */
export function labeled<R extends Record<string, unknown>>(
  record: R
): LabeledHList<_RecordToFields<R>> {
  const values = Object.values(record);
  const result = values as unknown as LabeledHList<_RecordToFields<R>>;
  (result as any).__keys = Object.keys(record);
  return result;
}

/**
 * Internal helper: convert a record type to an ordered tuple of LabeledFields.
 * Since object key order is not fully guaranteed at the type level, this relies
 * on the runtime key ordering matching `Object.keys()`.
 */
type _RecordToFields<R extends Record<string, unknown>> = {
  [K in keyof R & string]: LabeledField<K, R[K]>;
}[keyof R & string][];

// ============================================================================
// Element Access
// ============================================================================

/**
 * Get the first element.
 *
 * @example
 * ```typescript
 * head(hlist(1, "a", true)); // 1
 * ```
 */
export function head<H, T extends readonly unknown[]>(list: HList<[H, ...T]>): H {
  return (list as unknown as [H, ...T])[0];
}

/**
 * Get all elements except the first.
 *
 * @example
 * ```typescript
 * tail(hlist(1, "a", true)); // HList<[string, boolean]>
 * ```
 */
export function tail<H, T extends readonly unknown[]>(list: HList<[H, ...T]>): HList<T> {
  return (list as unknown as unknown[]).slice(1) as unknown as HList<T>;
}

/**
 * Get the last element.
 *
 * @example
 * ```typescript
 * last(hlist(1, "a", true)); // true
 * ```
 */
export function last<T extends readonly [unknown, ...unknown[]]>(list: HList<T>): Last<T> {
  const arr = list as unknown as unknown[];
  return arr[arr.length - 1] as Last<T>;
}

/**
 * Get all elements except the last.
 *
 * @example
 * ```typescript
 * init(hlist(1, "a", true)); // HList<[number, string]>
 * ```
 */
export function init<T extends readonly [unknown, ...unknown[]]>(list: HList<T>): HList<Init<T>> {
  const arr = list as unknown as unknown[];
  return arr.slice(0, -1) as unknown as HList<Init<T>>;
}

/**
 * Get the element at a specific index.
 *
 * @example
 * ```typescript
 * at(hlist(1, "a", true), 1); // "a"
 * ```
 */
export function at<T extends readonly unknown[], N extends number>(
  list: HList<T>,
  index: N
): At<T, N> {
  return (list as unknown as unknown[])[index] as At<T, N>;
}

/**
 * Get the length of an HList.
 *
 * @example
 * ```typescript
 * length(hlist(1, "a", true)); // 3
 * ```
 */
export function length<T extends readonly unknown[]>(list: HList<T>): number {
  return (list as unknown as unknown[]).length;
}

// ============================================================================
// Structural Operations
// ============================================================================

/**
 * Append an element to the end.
 *
 * @example
 * ```typescript
 * append(hlist(1, "a"), true); // HList<[number, string, boolean]>
 * ```
 */
export function append<T extends readonly unknown[], V>(
  list: HList<T>,
  value: V
): HList<[...T, V]> {
  return [...(list as unknown as T), value] as unknown as HList<[...T, V]>;
}

/**
 * Prepend an element to the front.
 *
 * @example
 * ```typescript
 * prepend(true, hlist(1, "a")); // HList<[boolean, number, string]>
 * ```
 */
export function prepend<V, T extends readonly unknown[]>(
  value: V,
  list: HList<T>
): HList<[V, ...T]> {
  return [value, ...(list as unknown as T)] as unknown as HList<[V, ...T]>;
}

/**
 * Concatenate two HLists.
 *
 * @example
 * ```typescript
 * concat(hlist(1, 2), hlist("a", "b")); // HList<[number, number, string, string]>
 * ```
 */
export function concat<A extends readonly unknown[], B extends readonly unknown[]>(
  a: HList<A>,
  b: HList<B>
): HList<[...A, ...B]> {
  return [...(a as unknown as A), ...(b as unknown as B)] as unknown as HList<[...A, ...B]>;
}

/**
 * Reverse an HList.
 *
 * @example
 * ```typescript
 * reverse(hlist(1, "a", true)); // HList<[boolean, string, number]>
 * ```
 */
export function reverse<T extends readonly unknown[]>(list: HList<T>): HList<Reverse<T>> {
  return [...(list as unknown as T)].reverse() as unknown as HList<Reverse<T>>;
}

/**
 * Pairwise zip two HLists. Result length = min of the two lengths.
 *
 * @example
 * ```typescript
 * zip(hlist(1, 2), hlist("a", "b")); // HList<[[number, string], [number, string]]>
 * ```
 */
export function zip<A extends readonly unknown[], B extends readonly unknown[]>(
  a: HList<A>,
  b: HList<B>
): HList<Zip<A, B>> {
  const arrA = a as unknown as unknown[];
  const arrB = b as unknown as unknown[];
  const len = Math.min(arrA.length, arrB.length);
  const result: [unknown, unknown][] = [];
  for (let i = 0; i < len; i++) {
    result.push([arrA[i], arrB[i]]);
  }
  return result as unknown as HList<Zip<A, B>>;
}

/**
 * Split an HList at a given index into `[left, right]`.
 *
 * @example
 * ```typescript
 * splitAt(hlist(1, "a", true), 1); // [HList<[number]>, HList<[string, boolean]>]
 * ```
 */
export function splitAt<T extends readonly unknown[], N extends number>(
  list: HList<T>,
  index: N
): [HList<SplitAt<T, N>[0]>, HList<SplitAt<T, N>[1]>] {
  const arr = list as unknown as unknown[];
  return [
    arr.slice(0, index) as unknown as HList<SplitAt<T, N>[0]>,
    arr.slice(index) as unknown as HList<SplitAt<T, N>[1]>,
  ];
}

// ============================================================================
// Labeled Operations
// ============================================================================

/**
 * Get a field value by label name.
 *
 * @example
 * ```typescript
 * const rec = labeled({ x: 42, y: "hi" });
 * get(rec, "x"); // 42
 * ```
 */
export function get<Fields extends readonly LabeledField[], Name extends string>(
  list: LabeledHList<Fields>,
  name: Name
): ValueByName<Fields, Name> {
  const keys = (list as any).__keys as string[];
  const idx = keys.indexOf(name);
  if (idx === -1) {
    throw new Error(`LabeledHList: no field named "${name}"`);
  }
  return (list as unknown as unknown[])[idx] as ValueByName<Fields, Name>;
}

/**
 * Return a new LabeledHList with one field's value replaced.
 *
 * @example
 * ```typescript
 * const rec = labeled({ x: 42, y: "hi" });
 * set(rec, "x", 99); // { x: 99, y: "hi" }
 * ```
 */
export function set<Fields extends readonly LabeledField[], Name extends string, V>(
  list: LabeledHList<Fields>,
  name: Name,
  value: V
): LabeledHList<UpdateField<Fields, Name, V>> {
  const keys = (list as any).__keys as string[];
  const idx = keys.indexOf(name);
  if (idx === -1) {
    throw new Error(`LabeledHList: no field named "${name}"`);
  }
  const arr = [...(list as unknown as unknown[])];
  arr[idx] = value;
  const result = arr as unknown as LabeledHList<UpdateField<Fields, Name, V>>;
  (result as any).__keys = [...keys];
  return result;
}

/**
 * Get the labels (field names) of a LabeledHList.
 *
 * @example
 * ```typescript
 * labels(labeled({ x: 42, y: "hi" })); // ["x", "y"]
 * ```
 */
export function labels<Fields extends readonly LabeledField[]>(
  list: LabeledHList<Fields>
): string[] {
  return [...((list as any).__keys as string[])];
}

/**
 * Project (select) a subset of fields by name.
 *
 * @example
 * ```typescript
 * const rec = labeled({ x: 1, y: 2, z: 3 });
 * project(rec, "x", "z"); // labeled with x=1, z=3
 * ```
 */
export function project<Fields extends readonly LabeledField[], Names extends string[]>(
  list: LabeledHList<Fields>,
  ...names: Names
): LabeledHList<ProjectFields<Fields, Names>> {
  const keys = (list as any).__keys as string[];
  const arr = list as unknown as unknown[];
  const newValues: unknown[] = [];
  const newKeys: string[] = [];
  for (const name of names) {
    const idx = keys.indexOf(name);
    if (idx === -1) {
      throw new Error(`LabeledHList: no field named "${name}"`);
    }
    newValues.push(arr[idx]);
    newKeys.push(name);
  }
  const result = newValues as unknown as LabeledHList<ProjectFields<Fields, Names>>;
  (result as any).__keys = newKeys;
  return result;
}

/**
 * Merge two LabeledHLists. Fields from `b` are appended after `a`.
 *
 * @example
 * ```typescript
 * merge(labeled({ x: 1 }), labeled({ y: "hi" }));
 * // labeled with x=1, y="hi"
 * ```
 */
export function merge<A extends readonly LabeledField[], B extends readonly LabeledField[]>(
  a: LabeledHList<A>,
  b: LabeledHList<B>
): LabeledHList<[...A, ...B]> {
  const arrA = a as unknown as unknown[];
  const arrB = b as unknown as unknown[];
  const keysA = (a as any).__keys as string[];
  const keysB = (b as any).__keys as string[];
  const merged = [...arrA, ...arrB] as unknown as LabeledHList<[...A, ...B]>;
  (merged as any).__keys = [...keysA, ...keysB];
  return merged;
}

// ============================================================================
// Higher-Order Operations
// ============================================================================

/**
 * Map a function over each element of an HList.
 *
 * Note: TypeScript cannot express heterogeneous map result types without
 * type-level lambdas, so the result is typed as `HList<unknown[]>`.
 * Use a type assertion if you know the output types.
 *
 * @example
 * ```typescript
 * map(hlist(1, 2, 3), x => String(x)); // HList containing ["1", "2", "3"]
 * ```
 */
export function map<T extends readonly unknown[]>(
  list: HList<T>,
  f: (elem: T[number], index: number) => unknown
): HList<unknown[]> {
  return (list as unknown as unknown[]).map((elem, i) => f(elem, i)) as unknown as HList<unknown[]>;
}

/**
 * Left fold over the elements of an HList.
 *
 * @example
 * ```typescript
 * foldLeft(hlist(1, 2, 3), 0, (acc, x) => acc + (x as number)); // 6
 * ```
 */
export function foldLeft<T extends readonly unknown[], Acc>(
  list: HList<T>,
  init: Acc,
  f: (acc: Acc, elem: T[number], index: number) => Acc
): Acc {
  const arr = list as unknown as unknown[];
  let acc: Acc = init;
  for (let i = 0; i < arr.length; i++) {
    acc = f(acc, arr[i], i);
  }
  return acc;
}

/**
 * Execute a side-effecting function for each element.
 *
 * @example
 * ```typescript
 * forEach(hlist(1, "a", true), (elem, i) => console.log(i, elem));
 * ```
 */
export function forEach<T extends readonly unknown[]>(
  list: HList<T>,
  f: (elem: T[number], index: number) => void
): void {
  (list as unknown as unknown[]).forEach((elem, i) => f(elem, i));
}

/**
 * Extract the underlying array from an HList.
 *
 * @example
 * ```typescript
 * toArray(hlist(1, "a", true)); // [1, "a", true]
 * ```
 */
export function toArray<T extends readonly unknown[]>(list: HList<T>): T {
  return [...(list as unknown as T)] as unknown as T;
}

/**
 * Create an HList from an existing array (or tuple).
 *
 * @example
 * ```typescript
 * fromArray([1, "a", true] as const); // HList<readonly [1, "a", true]>
 * ```
 */
export function fromArray<T extends readonly unknown[]>(arr: T): HList<T> {
  return [...arr] as unknown as HList<T>;
}

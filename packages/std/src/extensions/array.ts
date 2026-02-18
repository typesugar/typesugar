/**
 * Array Extension Methods
 *
 * The best from:
 * - Scala (head, tail, init, last, take, drop, zip, unzip, groupBy, partition,
 *          sliding, grouped, span, splitAt, foldRight, scanLeft, scanRight,
 *          collect, flatMap, distinct, intersperse, mkString, corresponds,
 *          forall, exists, count, minBy, maxBy, sortBy, tails, inits)
 * - Haskell (head, tail, init, last, take, drop, zip, unzip, group, groupBy,
 *            partition, span, break, splitAt, foldl, foldr, scanl, scanr,
 *            intercalate, intersperse, transpose, subsequences, permutations,
 *            nub, nubBy, sort, sortBy, sortOn, tails, inits, isPrefixOf, isSuffixOf)
 * - Ruby (each_cons, each_slice, flatten, compact, zip, uniq, rotate, sample, tally, sum)
 * - Kotlin (chunked, windowed, zipWithNext, associate, associateBy, distinctBy,
 *           flatten, flatMap, groupBy, partition, none, all, any, count, sumOf,
 *           minByOrNull, maxByOrNull, sortedBy, first, last, firstOrNull, lastOrNull)
 * - Rust (chunks, windows, dedup, flatten, chain, enumerate, zip, unzip, partition,
 *         fold, scan, take_while, skip_while, peekable, collect)
 * - Lodash (chunk, compact, difference, intersection, union, uniq, uniqBy, zip,
 *           zipObject, groupBy, keyBy, partition, sortBy, orderBy, flatten, flattenDeep)
 * - Python (enumerate, zip, reversed, sorted, all, any, sum, min, max, filter, map)
 * - Most-requested JS/TS: groupBy, unique, chunk, shuffle, sample, range, zip, compact
 */

// ============================================================================
// Access (Scala/Haskell head/tail/init/last)
// ============================================================================

export function head<A>(arr: readonly A[]): A | undefined {
  return arr[0];
}

export function tail<A>(arr: readonly A[]): A[] {
  return arr.slice(1);
}

export function init<A>(arr: readonly A[]): A[] {
  return arr.slice(0, -1);
}

export function last<A>(arr: readonly A[]): A | undefined {
  return arr[arr.length - 1];
}

export function headOrThrow<A>(arr: readonly A[]): A {
  if (arr.length === 0) throw new Error("headOrThrow on empty array");
  return arr[0];
}

export function lastOrThrow<A>(arr: readonly A[]): A {
  if (arr.length === 0) throw new Error("lastOrThrow on empty array");
  return arr[arr.length - 1];
}

export function nth<A>(arr: readonly A[], n: number): A | undefined {
  return n < 0 ? arr[arr.length + n] : arr[n];
}

// ============================================================================
// Slicing (Scala take/drop/splitAt/span, Haskell takeWhile/dropWhile)
// ============================================================================

export function take<A>(arr: readonly A[], n: number): A[] {
  return arr.slice(0, n);
}

export function drop<A>(arr: readonly A[], n: number): A[] {
  return arr.slice(n);
}

export function takeRight<A>(arr: readonly A[], n: number): A[] {
  return arr.slice(-n);
}

export function dropRight<A>(arr: readonly A[], n: number): A[] {
  return arr.slice(0, -n || undefined);
}

export function takeWhile<A>(arr: readonly A[], pred: (a: A) => boolean): A[] {
  const result: A[] = [];
  for (const x of arr) {
    if (!pred(x)) break;
    result.push(x);
  }
  return result;
}

export function dropWhile<A>(arr: readonly A[], pred: (a: A) => boolean): A[] {
  let i = 0;
  while (i < arr.length && pred(arr[i])) i++;
  return arr.slice(i);
}

export function splitAt<A>(arr: readonly A[], n: number): [A[], A[]] {
  return [arr.slice(0, n), arr.slice(n)];
}

export function span<A>(arr: readonly A[], pred: (a: A) => boolean): [A[], A[]] {
  const taken = takeWhile(arr, pred);
  return [taken, arr.slice(taken.length)];
}

// ============================================================================
// Grouping (Lodash/Kotlin/Scala groupBy, Haskell group, Ruby each_slice/each_cons)
// ============================================================================

export function groupBy<A, K extends string | number | symbol>(
  arr: readonly A[],
  fn: (a: A) => K,
): Record<K, A[]> {
  const result = {} as Record<K, A[]>;
  for (const x of arr) {
    const key = fn(x);
    (result[key] ??= []).push(x);
  }
  return result;
}

export function keyBy<A, K extends string | number | symbol>(
  arr: readonly A[],
  fn: (a: A) => K,
): Record<K, A> {
  const result = {} as Record<K, A>;
  for (const x of arr) result[fn(x)] = x;
  return result;
}

export function countBy<A, K extends string | number | symbol>(
  arr: readonly A[],
  fn: (a: A) => K,
): Record<K, number> {
  const result = {} as Record<K, number>;
  for (const x of arr) {
    const key = fn(x);
    result[key] = (result[key] ?? 0) + 1;
  }
  return result;
}

export function chunk<A>(arr: readonly A[], size: number): A[][] {
  if (size <= 0) throw new RangeError("chunk size must be positive");
  const result: A[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

export function sliding<A>(arr: readonly A[], size: number, step: number = 1): A[][] {
  if (size <= 0 || step <= 0) throw new RangeError("sliding size and step must be positive");
  const result: A[][] = [];
  for (let i = 0; i + size <= arr.length; i += step) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

export function partition<A>(arr: readonly A[], pred: (a: A) => boolean): [A[], A[]] {
  const yes: A[] = [];
  const no: A[] = [];
  for (const x of arr) (pred(x) ? yes : no).push(x);
  return [yes, no];
}

// ============================================================================
// Zipping (Scala/Haskell/Python zip, Kotlin zipWithNext)
// ============================================================================

export function zip<A, B>(a: readonly A[], b: readonly B[]): [A, B][] {
  const len = Math.min(a.length, b.length);
  const result: [A, B][] = [];
  for (let i = 0; i < len; i++) result.push([a[i], b[i]]);
  return result;
}

export function zip3<A, B, C>(
  a: readonly A[],
  b: readonly B[],
  c: readonly C[],
): [A, B, C][] {
  const len = Math.min(a.length, b.length, c.length);
  const result: [A, B, C][] = [];
  for (let i = 0; i < len; i++) result.push([a[i], b[i], c[i]]);
  return result;
}

export function zipWith<A, B, C>(
  a: readonly A[],
  b: readonly B[],
  fn: (a: A, b: B) => C,
): C[] {
  const len = Math.min(a.length, b.length);
  const result: C[] = [];
  for (let i = 0; i < len; i++) result.push(fn(a[i], b[i]));
  return result;
}

export function zipWithIndex<A>(arr: readonly A[]): [A, number][] {
  return arr.map((x, i) => [x, i]);
}

export function zipWithNext<A>(arr: readonly A[]): [A, A][] {
  const result: [A, A][] = [];
  for (let i = 0; i < arr.length - 1; i++) result.push([arr[i], arr[i + 1]]);
  return result;
}

export function unzip<A, B>(arr: readonly [A, B][]): [A[], B[]] {
  const as: A[] = [];
  const bs: B[] = [];
  for (const [a, b] of arr) {
    as.push(a);
    bs.push(b);
  }
  return [as, bs];
}

// ============================================================================
// Uniqueness (Lodash uniq/uniqBy, Haskell nub, Scala distinct)
// ============================================================================

export function unique<A>(arr: readonly A[]): A[] {
  return [...new Set(arr)];
}

export function uniqueBy<A, K>(arr: readonly A[], fn: (a: A) => K): A[] {
  const seen = new Set<K>();
  const result: A[] = [];
  for (const x of arr) {
    const key = fn(x);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(x);
    }
  }
  return result;
}

export function duplicates<A>(arr: readonly A[]): A[] {
  const seen = new Set<A>();
  const dups = new Set<A>();
  for (const x of arr) {
    if (seen.has(x)) dups.add(x);
    seen.add(x);
  }
  return [...dups];
}

export function frequencies<A>(arr: readonly A[]): Map<A, number> {
  const map = new Map<A, number>();
  for (const x of arr) map.set(x, (map.get(x) ?? 0) + 1);
  return map;
}

// ============================================================================
// Set Operations (Lodash difference/intersection/union)
// ============================================================================

export function difference<A>(a: readonly A[], b: readonly A[]): A[] {
  const set = new Set(b);
  return a.filter((x) => !set.has(x));
}

export function intersection<A>(a: readonly A[], b: readonly A[]): A[] {
  const set = new Set(b);
  return unique(a.filter((x) => set.has(x)));
}

export function union<A>(a: readonly A[], b: readonly A[]): A[] {
  return unique([...a, ...b]);
}

export function symmetricDifference<A>(a: readonly A[], b: readonly A[]): A[] {
  const setA = new Set(a);
  const setB = new Set(b);
  return [
    ...a.filter((x) => !setB.has(x)),
    ...b.filter((x) => !setA.has(x)),
  ];
}

export function isSubsetOf<A>(a: readonly A[], b: readonly A[]): boolean {
  const set = new Set(b);
  return a.every((x) => set.has(x));
}

export function isSupersetOf<A>(a: readonly A[], b: readonly A[]): boolean {
  return isSubsetOf(b, a);
}

// ============================================================================
// Folding & Scanning (Haskell foldl/foldr/scanl/scanr, Scala)
// ============================================================================

export function foldRight<A, B>(arr: readonly A[], init: B, fn: (a: A, acc: B) => B): B {
  let acc = init;
  for (let i = arr.length - 1; i >= 0; i--) acc = fn(arr[i], acc);
  return acc;
}

export function scanLeft<A, B>(arr: readonly A[], init: B, fn: (acc: B, a: A) => B): B[] {
  const result: B[] = [init];
  let acc = init;
  for (const x of arr) {
    acc = fn(acc, x);
    result.push(acc);
  }
  return result;
}

export function scanRight<A, B>(arr: readonly A[], init: B, fn: (a: A, acc: B) => B): B[] {
  const result: B[] = new Array(arr.length + 1);
  result[arr.length] = init;
  let acc = init;
  for (let i = arr.length - 1; i >= 0; i--) {
    acc = fn(arr[i], acc);
    result[i] = acc;
  }
  return result;
}

export function reduceRight<A>(arr: readonly A[], fn: (a: A, acc: A) => A): A {
  if (arr.length === 0) throw new Error("reduceRight on empty array");
  return arr.slice(0, -1).reduceRight((acc, x) => fn(x, acc), arr[arr.length - 1]);
}

// ============================================================================
// Aggregation (Kotlin sumOf/minBy/maxBy, Scala)
// ============================================================================

export function sumBy<A>(arr: readonly A[], fn: (a: A) => number): number {
  let sum = 0;
  for (const x of arr) sum += fn(x);
  return sum;
}

export function minBy<A>(arr: readonly A[], fn: (a: A) => number): A | undefined {
  if (arr.length === 0) return undefined;
  let best = arr[0];
  let bestVal = fn(best);
  for (let i = 1; i < arr.length; i++) {
    const val = fn(arr[i]);
    if (val < bestVal) {
      best = arr[i];
      bestVal = val;
    }
  }
  return best;
}

export function maxBy<A>(arr: readonly A[], fn: (a: A) => number): A | undefined {
  if (arr.length === 0) return undefined;
  let best = arr[0];
  let bestVal = fn(best);
  for (let i = 1; i < arr.length; i++) {
    const val = fn(arr[i]);
    if (val > bestVal) {
      best = arr[i];
      bestVal = val;
    }
  }
  return best;
}

export function average(arr: readonly number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function median(arr: readonly number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function product(arr: readonly number[]): number {
  return arr.reduce((a, b) => a * b, 1);
}

// ============================================================================
// Sorting (Scala sortBy, Haskell sortOn, Kotlin sortedBy)
// ============================================================================

export function sortBy<A, K>(arr: readonly A[], fn: (a: A) => K): A[] {
  return [...arr].sort((a, b) => {
    const ka = fn(a);
    const kb = fn(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

export function sortByDesc<A, K>(arr: readonly A[], fn: (a: A) => K): A[] {
  return [...arr].sort((a, b) => {
    const ka = fn(a);
    const kb = fn(b);
    return ka > kb ? -1 : ka < kb ? 1 : 0;
  });
}

// ============================================================================
// Transformation (Scala intersperse, Haskell intercalate, Lodash flatten)
// ============================================================================

export function intersperse<A>(arr: readonly A[], sep: A): A[] {
  if (arr.length <= 1) return [...arr];
  const result: A[] = [arr[0]];
  for (let i = 1; i < arr.length; i++) {
    result.push(sep, arr[i]);
  }
  return result;
}

export function intercalate<A>(arr: readonly A[][], sep: readonly A[]): A[] {
  if (arr.length === 0) return [];
  const result: A[] = [...arr[0]];
  for (let i = 1; i < arr.length; i++) {
    result.push(...sep, ...arr[i]);
  }
  return result;
}

export function compact<A>(arr: readonly (A | null | undefined | false | 0 | "")[]): A[] {
  return arr.filter(Boolean) as A[];
}

export function flatten<A>(arr: readonly (A | A[])[]): A[] {
  return arr.flat() as A[];
}

export function flattenDeep(arr: readonly unknown[]): unknown[] {
  return arr.flat(Infinity);
}

export function rotate<A>(arr: readonly A[], n: number): A[] {
  if (arr.length === 0) return [];
  const k = ((n % arr.length) + arr.length) % arr.length;
  return [...arr.slice(k), ...arr.slice(0, k)];
}

export function transpose<A>(arr: readonly (readonly A[])[]): A[][] {
  if (arr.length === 0) return [];
  const maxLen = Math.max(...arr.map((r) => r.length));
  const result: A[][] = [];
  for (let i = 0; i < maxLen; i++) {
    result.push(arr.map((r) => r[i]).filter((x) => x !== undefined));
  }
  return result;
}

export function interleave<A>(a: readonly A[], b: readonly A[]): A[] {
  const result: A[] = [];
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (i < a.length) result.push(a[i]);
    if (i < b.length) result.push(b[i]);
  }
  return result;
}

// ============================================================================
// Random & Sampling (Ruby sample, Lodash shuffle/sample)
// ============================================================================

export function shuffle<A>(arr: readonly A[]): A[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function sample<A>(arr: readonly A[]): A | undefined {
  if (arr.length === 0) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

export function sampleN<A>(arr: readonly A[], n: number): A[] {
  return shuffle(arr).slice(0, n);
}

// ============================================================================
// Predicates (Kotlin none/all/any, Haskell all/any)
// ============================================================================

export function none<A>(arr: readonly A[], pred: (a: A) => boolean): boolean {
  return !arr.some(pred);
}

export function isPrefixOf<A>(prefix: readonly A[], arr: readonly A[]): boolean {
  if (prefix.length > arr.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (prefix[i] !== arr[i]) return false;
  }
  return true;
}

export function isSuffixOf<A>(suffix: readonly A[], arr: readonly A[]): boolean {
  if (suffix.length > arr.length) return false;
  const offset = arr.length - suffix.length;
  for (let i = 0; i < suffix.length; i++) {
    if (suffix[i] !== arr[offset + i]) return false;
  }
  return true;
}

export function isSorted<A>(arr: readonly A[], compare?: (a: A, b: A) => number): boolean {
  const cmp = compare ?? ((a: A, b: A) => (a < b ? -1 : a > b ? 1 : 0));
  for (let i = 1; i < arr.length; i++) {
    if (cmp(arr[i - 1], arr[i]) > 0) return false;
  }
  return true;
}

// ============================================================================
// Haskell tails/inits, Scala combinations/permutations
// ============================================================================

export function tails<A>(arr: readonly A[]): A[][] {
  const result: A[][] = [];
  for (let i = 0; i <= arr.length; i++) result.push(arr.slice(i));
  return result;
}

export function inits<A>(arr: readonly A[]): A[][] {
  const result: A[][] = [];
  for (let i = 0; i <= arr.length; i++) result.push(arr.slice(0, i));
  return result;
}

// ============================================================================
// String-like (Scala mkString)
// ============================================================================

export function mkString<A>(
  arr: readonly A[],
  sep: string = "",
  prefix: string = "",
  suffix: string = "",
): string {
  return prefix + arr.join(sep) + suffix;
}

// ============================================================================
// Conversion (Kotlin associate/associateBy, Lodash zipObject)
// ============================================================================

export function associate<A, K extends string | number | symbol, V>(
  arr: readonly A[],
  fn: (a: A) => [K, V],
): Record<K, V> {
  const result = {} as Record<K, V>;
  for (const x of arr) {
    const [k, v] = fn(x);
    result[k] = v;
  }
  return result;
}

export function toMap<A, K, V>(arr: readonly A[], fn: (a: A) => [K, V]): Map<K, V> {
  return new Map(arr.map(fn));
}

export function toSet<A>(arr: readonly A[]): Set<A> {
  return new Set(arr);
}

export function zipObject<K extends string | number | symbol, V>(
  keys: readonly K[],
  values: readonly V[],
): Record<K, V> {
  const result = {} as Record<K, V>;
  for (let i = 0; i < keys.length; i++) {
    result[keys[i]] = values[i];
  }
  return result;
}

// ============================================================================
// Aggregate
// ============================================================================

export const ArrayExt = {
  head,
  tail,
  init,
  last,
  headOrThrow,
  lastOrThrow,
  nth,
  take,
  drop,
  takeRight,
  dropRight,
  takeWhile,
  dropWhile,
  splitAt,
  span,
  groupBy,
  keyBy,
  countBy,
  chunk,
  sliding,
  partition,
  zip,
  zip3,
  zipWith,
  zipWithIndex,
  zipWithNext,
  unzip,
  unique,
  uniqueBy,
  duplicates,
  frequencies,
  difference,
  intersection,
  union,
  symmetricDifference,
  isSubsetOf,
  isSupersetOf,
  foldRight,
  scanLeft,
  scanRight,
  reduceRight,
  sumBy,
  minBy,
  maxBy,
  average,
  median,
  product,
  sortBy,
  sortByDesc,
  intersperse,
  intercalate,
  compact,
  flatten,
  flattenDeep,
  rotate,
  transpose,
  interleave,
  shuffle,
  sample,
  sampleN,
  none,
  isPrefixOf,
  isSuffixOf,
  isSorted,
  tails,
  inits,
  mkString,
  associate,
  toMap,
  toSet,
  zipObject,
} as const;

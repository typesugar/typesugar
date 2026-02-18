/**
 * Tuple Utilities
 *
 * Inspired by:
 * - Scala (Tuple2..Tuple22, swap, map, productIterator)
 * - Haskell (fst, snd, swap, curry, uncurry, both, bimap)
 * - Kotlin (Pair, Triple, toList, first, second, third)
 * - Rust ((A, B) with .0, .1, swap)
 * - Python (namedtuple, tuple unpacking)
 */

// ============================================================================
// Pair (2-tuple)
// ============================================================================

export type Pair<A, B> = readonly [A, B];

export function pair<A, B>(a: A, b: B): Pair<A, B> {
  return [a, b] as const;
}

export function fst<A, B>(p: Pair<A, B>): A {
  return p[0];
}

export function snd<A, B>(p: Pair<A, B>): B {
  return p[1];
}

export function swap<A, B>(p: Pair<A, B>): Pair<B, A> {
  return [p[1], p[0]] as const;
}

export function mapFst<A, B, C>(p: Pair<A, B>, fn: (a: A) => C): Pair<C, B> {
  return [fn(p[0]), p[1]] as const;
}

export function mapSnd<A, B, C>(p: Pair<A, B>, fn: (b: B) => C): Pair<A, C> {
  return [p[0], fn(p[1])] as const;
}

export function bimap<A, B, C, D>(p: Pair<A, B>, f: (a: A) => C, g: (b: B) => D): Pair<C, D> {
  return [f(p[0]), g(p[1])] as const;
}

/** Apply the same function to both elements. Haskell's `both`. */
export function both<A, B>(p: Pair<A, A>, fn: (a: A) => B): Pair<B, B> {
  return [fn(p[0]), fn(p[1])] as const;
}

export function pairToArray<A>(p: Pair<A, A>): A[] {
  return [p[0], p[1]];
}

/** Haskell's `curry`: converts a function on pairs to a curried function. */
export function curryPair<A, B, C>(fn: (p: Pair<A, B>) => C): (a: A) => (b: B) => C {
  return (a) => (b) => fn([a, b] as const);
}

/** Haskell's `uncurry`: converts a curried function to one on pairs. */
export function uncurryPair<A, B, C>(fn: (a: A, b: B) => C): (p: Pair<A, B>) => C {
  return (p) => fn(p[0], p[1]);
}

// ============================================================================
// Triple (3-tuple)
// ============================================================================

export type Triple<A, B, C> = readonly [A, B, C];

export function triple<A, B, C>(a: A, b: B, c: C): Triple<A, B, C> {
  return [a, b, c] as const;
}

export function tripleFirst<A, B, C>(t: Triple<A, B, C>): A {
  return t[0];
}

export function tripleSecond<A, B, C>(t: Triple<A, B, C>): B {
  return t[1];
}

export function tripleThird<A, B, C>(t: Triple<A, B, C>): C {
  return t[2];
}

export function tripleToArray<A>(t: Triple<A, A, A>): A[] {
  return [t[0], t[1], t[2]];
}

export function tripleMap<A, B, C, D, E, F>(
  t: Triple<A, B, C>,
  f: (a: A) => D,
  g: (b: B) => E,
  h: (c: C) => F,
): Triple<D, E, F> {
  return [f(t[0]), g(t[1]), h(t[2])] as const;
}

// ============================================================================
// Generic tuple helpers
// ============================================================================

/** Zip two arrays into an array of pairs. */
export function zipToPairs<A, B>(as: readonly A[], bs: readonly B[]): Pair<A, B>[] {
  const len = Math.min(as.length, bs.length);
  const result: Pair<A, B>[] = [];
  for (let i = 0; i < len; i++) result.push([as[i], bs[i]] as const);
  return result;
}

/** Unzip an array of pairs into a pair of arrays. */
export function unzipPairs<A, B>(pairs: readonly Pair<A, B>[]): Pair<A[], B[]> {
  const as: A[] = [];
  const bs: B[] = [];
  for (const [a, b] of pairs) {
    as.push(a);
    bs.push(b);
  }
  return [as, bs] as const;
}

// ============================================================================
// Aggregate
// ============================================================================

export const TupleExt = {
  pair,
  fst,
  snd,
  swap,
  mapFst,
  mapSnd,
  bimap,
  both,
  toArray: pairToArray,
  curry: curryPair,
  uncurry: uncurryPair,
  triple,
  tripleFirst,
  tripleSecond,
  tripleThird,
  tripleToArray,
  tripleMap,
  zipToPairs,
  unzipPairs,
} as const;

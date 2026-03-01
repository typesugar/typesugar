/**
 * Derived operations — free functions built on the typeclass interfaces.
 */

import type { Eq, Ord } from "@typesugar/std";
import type {
  IterableOnce,
  Iterable,
  Seq,
  SetLike,
  MapLike,
  MutableSetLike,
  MutableMapLike,
} from "./typeclasses.js";

// ============================================================================
// From IterableOnce
// ============================================================================

export function forEach<I, A>(i: I, f: (a: A) => void, IO: IterableOnce<I, A>): void {
  IO.fold(i, undefined as void, (_, a) => f(a));
}

export function toArray<I, A>(i: I, IO: IterableOnce<I, A>): A[] {
  return IO.fold<A[]>(i, [], (acc, a) => {
    acc.push(a);
    return acc;
  });
}

export function find<I, A>(i: I, p: (a: A) => boolean, IO: IterableOnce<I, A>): A | undefined {
  return IO.fold<A | undefined>(i, undefined, (acc, a) =>
    acc !== undefined ? acc : p(a) ? a : undefined
  );
}

export function exists<I, A>(i: I, p: (a: A) => boolean, IO: IterableOnce<I, A>): boolean {
  return IO.fold(i, false, (acc, a) => acc || p(a));
}

export function forAll<I, A>(i: I, p: (a: A) => boolean, IO: IterableOnce<I, A>): boolean {
  return IO.fold(i, true, (acc, a) => acc && p(a));
}

export function count<I, A>(i: I, IO: IterableOnce<I, A>): number {
  return IO.fold(i, 0, (acc) => acc + 1);
}

export function sum(i: unknown, IO: IterableOnce<unknown, number>): number {
  return IO.fold(i, 0, (acc, a) => acc + a);
}

// ============================================================================
// From Seq
// ============================================================================

export function head<S, A>(s: S, SQ: Seq<S, A>): A | undefined {
  return SQ.nth(s, 0);
}

export function last<S, A>(s: S, SQ: Seq<S, A>): A | undefined {
  const len = SQ.length(s);
  return len > 0 ? SQ.nth(s, len - 1) : undefined;
}

export function take<S, A>(s: S, n: number, SQ: Seq<S, A>): A[] {
  const result: A[] = [];
  const len = Math.min(n, SQ.length(s));
  for (let i = 0; i < len; i++) result.push(SQ.nth(s, i)!);
  return result;
}

export function drop<S, A>(s: S, n: number, SQ: Seq<S, A>): A[] {
  const result: A[] = [];
  const len = SQ.length(s);
  for (let i = n; i < len; i++) result.push(SQ.nth(s, i)!);
  return result;
}

export function sorted<S, A>(s: S, SQ: Seq<S, A>, ord: Ord<A>): A[] {
  return toArray(s, SQ).sort((a, b) => ord.compare(a, b));
}

export function seqContains<S, A>(s: S, a: A, SQ: Seq<S, A>, eq: Eq<A>): boolean {
  const len = SQ.length(s);
  for (let i = 0; i < len; i++) {
    if (eq.equals(SQ.nth(s, i)!, a)) return true;
  }
  return false;
}

// ============================================================================
// From SetLike
// ============================================================================

export function union<S, K>(a: S, b: S, SL: SetLike<S, K>, MSL: MutableSetLike<S, K>): S {
  const result = MSL.create();
  for (const k of SL.iterator(a)) MSL.add(result, k);
  for (const k of SL.iterator(b)) MSL.add(result, k);
  return result;
}

export function intersection<S, K>(a: S, b: S, SL: SetLike<S, K>, MSL: MutableSetLike<S, K>): S {
  const result = MSL.create();
  for (const k of SL.iterator(a)) {
    if (SL.has(b, k)) MSL.add(result, k);
  }
  return result;
}

export function difference<S, K>(a: S, b: S, SL: SetLike<S, K>, MSL: MutableSetLike<S, K>): S {
  const result = MSL.create();
  for (const k of SL.iterator(a)) {
    if (!SL.has(b, k)) MSL.add(result, k);
  }
  return result;
}

export function isSubsetOf<S, K>(a: S, b: S, SL: SetLike<S, K>): boolean {
  for (const k of SL.iterator(a)) {
    if (!SL.has(b, k)) return false;
  }
  return true;
}

// ============================================================================
// From MapLike
// ============================================================================

export function getOrElse<M, K, V>(m: M, k: K, fallback: V, ML: MapLike<M, K, V>): V {
  const v = ML.get(m, k);
  return v !== undefined ? v : ML.has(m, k) ? (v as V) : fallback;
}

export function mapValues<M, K, V, V2>(
  m: M,
  f: (v: V, k: K) => V2,
  ML: MapLike<M, K, V>,
  MML: MutableMapLike<M, K, V2>
): M {
  const result = MML.create();
  for (const [k, v] of ML.iterator(m)) {
    MML.set(result, k, f(v, k));
  }
  return result;
}

export function filterEntries<M, K, V>(
  m: M,
  p: (k: K, v: V) => boolean,
  ML: MapLike<M, K, V>,
  MML: MutableMapLike<M, K, V>
): M {
  const result = MML.create();
  for (const [k, v] of ML.iterator(m)) {
    if (p(k, v)) MML.set(result, k, v);
  }
  return result;
}

export function mapEntries<M, K, V>(m: M, ML: MapLike<M, K, V>): [K, V][] {
  const result: [K, V][] = [];
  for (const entry of ML.iterator(m)) result.push(entry);
  return result;
}

import type { IterableOnce } from "../typeclasses/iterable-once.js";
import type { Iterable } from "../typeclasses/iterable.js";
import type { Seq } from "../typeclasses/seq.js";
import type { SetLike } from "../typeclasses/set-like.js";
import type { MapLike } from "../typeclasses/map-like.js";
import type { $ } from "../hkt.js";
import * as IO from "../typeclasses/iterable-once.js";
import * as I from "../typeclasses/iterable.js";
import * as S from "../typeclasses/seq.js";

export function iterator<F>(
  F: IterableOnce<F>,
  fa: $<F, any>,
): IterableIterator<any> {
  return F.iterator(fa);
}
export function foldLeft<F, A, B>(
  F: IterableOnce<F>,
  fa: $<F, A>,
  z: B,
  f: (b: B, a: A) => B,
): B {
  return F.foldLeft(fa, z, f);
}
export function forEach<F, A>(
  F: IterableOnce<F>,
  fa: $<F, A>,
  f: (a: A) => void,
): void {
  IO.forEach(F)(fa, f);
}
export function toArray<F, A>(F: IterableOnce<F>, fa: $<F, A>): A[] {
  return IO.toArray(F)(fa);
}
export function size<F, A>(F: IterableOnce<F>, fa: $<F, A>): number {
  return IO.size(F)(fa);
}
export function isEmpty<F, A>(F: IterableOnce<F>, fa: $<F, A>): boolean {
  return IO.isEmpty(F)(fa);
}
export function sum<F>(F: IterableOnce<F>, fa: $<F, number>): number {
  return IO.sum(F)(fa);
}
export function mkString<F, A>(
  F: IterableOnce<F>,
  fa: $<F, A>,
  sep?: string,
  prefix?: string,
  suffix?: string,
): string {
  return IO.mkString(F)(fa, sep, prefix, suffix);
}

export function map<F, A, B>(
  F: Iterable<F>,
  fa: $<F, A>,
  f: (a: A) => B,
): $<F, B> {
  return F.map(fa, f);
}
export function filter<F, A>(
  F: Iterable<F>,
  fa: $<F, A>,
  p: (a: A) => boolean,
): $<F, A> {
  return F.filter(fa, p);
}
export function flatMap<F, A, B>(
  F: Iterable<F>,
  fa: $<F, A>,
  f: (a: A) => $<F, B>,
): $<F, B> {
  return F.flatMap(fa, f);
}
export function concat<F, A>(
  F: Iterable<F>,
  fa: $<F, A>,
  fb: $<F, A>,
): $<F, A> {
  return F.concat(fa, fb);
}
export function from<F, A>(
  F: Iterable<F>,
  elements: globalThis.Iterable<A>,
): $<F, A> {
  return F.from(elements);
}
export function empty<F, A>(F: Iterable<F>): $<F, A> {
  return F.empty<A>();
}
export function take<F, A>(F: Iterable<F>, fa: $<F, A>, n: number): $<F, A> {
  return I.take(F)(fa, n);
}
export function drop<F, A>(F: Iterable<F>, fa: $<F, A>, n: number): $<F, A> {
  return I.drop(F)(fa, n);
}
export function zip<F, A, B>(
  F: Iterable<F>,
  fa: $<F, A>,
  fb: $<F, B>,
): $<F, [A, B]> {
  return I.zip(F)(fa, fb);
}
export function zipWithIndex<F, A>(
  F: Iterable<F>,
  fa: $<F, A>,
): $<F, [A, number]> {
  return I.zipWithIndex(F)(fa);
}
export function groupBy<F, A, K>(
  F: Iterable<F>,
  fa: $<F, A>,
  f: (a: A) => K,
): Map<K, $<F, A>> {
  return I.groupBy(F)(fa, f);
}

export function apply<F, A>(F: Seq<F>, fa: $<F, A>, index: number): A {
  return F.apply(fa, index);
}
export function reverse<F, A>(F: Seq<F>, fa: $<F, A>): $<F, A> {
  return F.reverse(fa);
}
export function sorted<F, A>(
  F: Seq<F>,
  fa: $<F, A>,
  cmp?: (a: A, b: A) => number,
): $<F, A> {
  return F.sorted(fa, cmp);
}
export function updated<F, A>(
  F: Seq<F>,
  fa: $<F, A>,
  index: number,
  value: A,
): $<F, A> {
  return F.updated(fa, index, value);
}
export function head<F, A>(F: Seq<F>, fa: $<F, A>): A | undefined {
  return S.head(F)(fa);
}
export function tail<F, A>(F: Seq<F>, fa: $<F, A>): $<F, A> {
  return S.tail(F)(fa);
}
export function last<F, A>(F: Seq<F>, fa: $<F, A>): A | undefined {
  return S.last(F)(fa);
}

export function contains<F, A>(F: SetLike<F>, fa: $<F, A>, value: A): boolean {
  return F.contains(fa, value);
}
export function add<F, A>(F: SetLike<F>, fa: $<F, A>, value: A): $<F, A> {
  return F.add(fa, value);
}
export function remove<F, A>(F: SetLike<F>, fa: $<F, A>, value: A): $<F, A> {
  return F.remove(fa, value);
}

export function get<F, K, V>(
  F: MapLike<F, K>,
  fa: $<F, V>,
  key: K,
): V | undefined {
  return F.get(fa, key);
}
export function has<F, K, V>(F: MapLike<F, K>, fa: $<F, V>, key: K): boolean {
  return F.has(fa, key);
}
export function keys<F, K, V>(
  F: MapLike<F, K>,
  fa: $<F, V>,
): IterableIterator<K> {
  return F.keys(fa);
}
export function values<F, K, V>(
  F: MapLike<F, K>,
  fa: $<F, V>,
): IterableIterator<V> {
  return F.values(fa);
}
export function mapSize<F, K, V>(F: MapLike<F, K>, fa: $<F, V>): number {
  return F.size(fa);
}
export function mapUpdated<F, K, V>(
  F: MapLike<F, K>,
  fa: $<F, V>,
  key: K,
  value: V,
): $<F, V> {
  return F.updated(fa, key, value);
}
export function mapRemoved<F, K, V>(
  F: MapLike<F, K>,
  fa: $<F, V>,
  key: K,
): $<F, V> {
  return F.removed(fa, key);
}

import type { IterableOnce } from "../typeclasses/iterable-once.js";
import type { Iterable } from "../typeclasses/iterable.js";
import type { Seq } from "../typeclasses/seq.js";
import type { SetLike } from "../typeclasses/set-like.js";
import type { MapLike } from "../typeclasses/map-like.js";
import type { $ } from "../hkt.js";

export function foldLeft<F>(
  F: IterableOnce<F>,
): <A, B>(z: B, f: (b: B, a: A) => B) => (fa: $<F, A>) => B {
  return <A, B>(z: B, f: (b: B, a: A) => B) =>
    (fa: $<F, A>) =>
      F.foldLeft(fa, z, f);
}

export function map<F>(
  F: Iterable<F>,
): <A, B>(f: (a: A) => B) => (fa: $<F, A>) => $<F, B> {
  return <A, B>(f: (a: A) => B) =>
    (fa: $<F, A>) =>
      F.map(fa, f);
}

export function filter<F>(
  F: Iterable<F>,
): <A>(p: (a: A) => boolean) => (fa: $<F, A>) => $<F, A> {
  return <A>(p: (a: A) => boolean) =>
    (fa: $<F, A>) =>
      F.filter(fa, p);
}

export function flatMap<F>(
  F: Iterable<F>,
): <A, B>(f: (a: A) => $<F, B>) => (fa: $<F, A>) => $<F, B> {
  return <A, B>(f: (a: A) => $<F, B>) =>
    (fa: $<F, A>) =>
      F.flatMap(fa, f);
}

export function concat<F>(
  F: Iterable<F>,
): <A>(fb: $<F, A>) => (fa: $<F, A>) => $<F, A> {
  return <A>(fb: $<F, A>) =>
    (fa: $<F, A>) =>
      F.concat(fa, fb);
}

import { take as _take, drop as _drop } from "../typeclasses/iterable.js";

export function take<F>(
  F: Iterable<F>,
): (n: number) => <A>(fa: $<F, A>) => $<F, A> {
  return (n: number) =>
    <A>(fa: $<F, A>) =>
      _take(F)(fa, n);
}

export function drop<F>(
  F: Iterable<F>,
): (n: number) => <A>(fa: $<F, A>) => $<F, A> {
  return (n: number) =>
    <A>(fa: $<F, A>) =>
      _drop(F)(fa, n);
}

export function apply<F>(F: Seq<F>): (index: number) => <A>(fa: $<F, A>) => A {
  return (index: number) =>
    <A>(fa: $<F, A>) =>
      F.apply(fa, index);
}

export function reverse<F>(F: Seq<F>): <A>(fa: $<F, A>) => $<F, A> {
  return <A>(fa: $<F, A>) => F.reverse(fa);
}

export function sorted<F>(
  F: Seq<F>,
): <A>(cmp?: (a: A, b: A) => number) => (fa: $<F, A>) => $<F, A> {
  return <A>(cmp?: (a: A, b: A) => number) =>
    (fa: $<F, A>) =>
      F.sorted(fa, cmp);
}

export function contains<F>(
  F: SetLike<F>,
): <A>(value: A) => (fa: $<F, A>) => boolean {
  return <A>(value: A) =>
    (fa: $<F, A>) =>
      F.contains(fa, value);
}

export function add<F>(
  F: SetLike<F>,
): <A>(value: A) => (fa: $<F, A>) => $<F, A> {
  return <A>(value: A) =>
    (fa: $<F, A>) =>
      F.add(fa, value);
}

export function remove<F>(
  F: SetLike<F>,
): <A>(value: A) => (fa: $<F, A>) => $<F, A> {
  return <A>(value: A) =>
    (fa: $<F, A>) =>
      F.remove(fa, value);
}

export function get<F, K>(
  F: MapLike<F, K>,
): <V>(key: K) => (fa: $<F, V>) => V | undefined {
  return <V>(key: K) =>
    (fa: $<F, V>) =>
      F.get(fa, key);
}

export function has<F, K>(
  F: MapLike<F, K>,
): <V>(key: K) => (fa: $<F, V>) => boolean {
  return <V>(key: K) =>
    (fa: $<F, V>) =>
      F.has(fa, key);
}

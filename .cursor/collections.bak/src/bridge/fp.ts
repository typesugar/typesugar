import type {
  Foldable,
  Functor,
  Monad,
  SemigroupK,
  MonoidK,
  Monoid,
} from "@typesugar/fp";
import type { IterableOnce } from "../typeclasses/iterable-once.js";
import type { Iterable } from "../typeclasses/iterable.js";
import type { $ } from "../hkt.js";

export function foldableFromIterableOnce<F>(F: IterableOnce<F>): Foldable<F> {
  return {
    foldLeft: <A, B>(fa: $<F, A>, b: B, f: (b: B, a: A) => B) =>
      F.foldLeft(fa, b, f),
    foldRight: <A, B>(fa: $<F, A>, b: B, f: (a: A, b: B) => B) => {
      const arr: A[] = [];
      for (const a of F.iterator(fa)) arr.push(a);
      let acc = b;
      for (let i = arr.length - 1; i >= 0; i--) acc = f(arr[i], acc);
      return acc;
    },
  };
}

export function functorFromIterable<F>(F: Iterable<F>): Functor<F> {
  return { map: <A, B>(fa: $<F, A>, f: (a: A) => B) => F.map(fa, f) };
}

export function monadFromIterable<F>(F: Iterable<F>): Monad<F> {
  return {
    map: <A, B>(fa: $<F, A>, f: (a: A) => B) => F.map(fa, f),
    pure: <A>(a: A) => F.from([a]),
    ap: <A, B>(ff: $<F, (a: A) => B>, fa: $<F, A>) =>
      F.flatMap(ff, (f: (a: A) => B) => F.map(fa, f)),
    flatMap: <A, B>(fa: $<F, A>, f: (a: A) => $<F, B>) => F.flatMap(fa, f),
  };
}

export function semigroupKFromIterable<F>(F: Iterable<F>): SemigroupK<F> {
  return { combineK: <A>(x: $<F, A>, y: $<F, A>) => F.concat(x, y) };
}

export function monoidKFromIterable<F>(F: Iterable<F>): MonoidK<F> {
  return {
    combineK: <A>(x: $<F, A>, y: $<F, A>) => F.concat(x, y),
    emptyK: <A>() => F.empty<A>(),
  };
}

export function collectionMonoid<F, A>(F: Iterable<F>): Monoid<$<F, A>> {
  return {
    combine: (x: $<F, A>, y: $<F, A>) => F.concat(x, y),
    empty: F.empty<A>(),
  };
}

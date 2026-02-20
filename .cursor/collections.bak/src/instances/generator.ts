import type { IterableOnce } from "../typeclasses/iterable-once.js";
import type { IteratorF, IterableF } from "../hkt.js";

export const iteratorIterableOnce: IterableOnce<IteratorF> = {
  iterator: <A>(fa: IterableIterator<A>) => fa,
  foldLeft: <A, B>(fa: IterableIterator<A>, z: B, f: (b: B, a: A) => B) => {
    let acc = z;
    for (const a of fa) acc = f(acc, a);
    return acc;
  },
};

export const iterableIterableOnce: IterableOnce<IterableF> = {
  iterator: <A>(fa: globalThis.Iterable<A>) =>
    fa[Symbol.iterator]() as IterableIterator<A>,
  foldLeft: <A, B>(fa: globalThis.Iterable<A>, z: B, f: (b: B, a: A) => B) => {
    let acc = z;
    for (const a of fa) acc = f(acc, a);
    return acc;
  },
};

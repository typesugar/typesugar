import type { Seq } from "../typeclasses/seq.js";
import type { Growable, Builder } from "../typeclasses/growable.js";
import type { ArrayF } from "../hkt.js";

export const arraySeq: Seq<ArrayF> = {
  iterator: <A>(fa: A[]) => fa[Symbol.iterator](),
  foldLeft: <A, B>(fa: A[], z: B, f: (b: B, a: A) => B) => fa.reduce(f, z),
  map: <A, B>(fa: A[], f: (a: A) => B) => fa.map(f),
  filter: <A>(fa: A[], p: (a: A) => boolean) => fa.filter(p),
  flatMap: <A, B>(fa: A[], f: (a: A) => B[]) => fa.flatMap(f),
  from: <A>(elements: globalThis.Iterable<A>) => Array.from(elements),
  empty: <A>() => [] as A[],
  concat: <A>(fa: A[], fb: A[]) => [...fa, ...fb],
  apply: <A>(fa: A[], index: number) => fa[index],
  reverse: <A>(fa: A[]) => [...fa].reverse(),
  sorted: <A>(fa: A[], cmp?: (a: A, b: A) => number) => [...fa].sort(cmp),
  updated: <A>(fa: A[], index: number, value: A) => {
    const r = [...fa];
    r[index] = value;
    return r;
  },
};

export const arrayGrowable: Growable<ArrayF> = {
  newBuilder: <A>(): Builder<A, A[]> => {
    const arr: A[] = [];
    return {
      addOne: (element: A) => {
        arr.push(element);
      },
      result: () => arr,
    };
  },
};

import type { SetLike } from "../typeclasses/set-like.js";
import type { Growable, Builder } from "../typeclasses/growable.js";
import type { SetF } from "../hkt.js";

export const setSetLike: SetLike<SetF> = {
  iterator: <A>(fa: Set<A>) => fa[Symbol.iterator](),
  foldLeft: <A, B>(fa: Set<A>, z: B, f: (b: B, a: A) => B) => {
    let acc = z;
    for (const a of fa) acc = f(acc, a);
    return acc;
  },
  map: <A, B>(fa: Set<A>, f: (a: A) => B) => {
    const r = new Set<B>();
    for (const a of fa) r.add(f(a));
    return r;
  },
  filter: <A>(fa: Set<A>, p: (a: A) => boolean) => {
    const r = new Set<A>();
    for (const a of fa) if (p(a)) r.add(a);
    return r;
  },
  flatMap: <A, B>(fa: Set<A>, f: (a: A) => Set<B>) => {
    const r = new Set<B>();
    for (const a of fa) for (const b of f(a)) r.add(b);
    return r;
  },
  from: <A>(elements: globalThis.Iterable<A>) => new Set(elements),
  empty: <A>() => new Set<A>(),
  concat: <A>(fa: Set<A>, fb: Set<A>) => new Set([...fa, ...fb]),
  contains: <A>(fa: Set<A>, value: A) => fa.has(value),
  add: <A>(fa: Set<A>, value: A) => new Set(fa).add(value),
  remove: <A>(fa: Set<A>, value: A) => {
    const r = new Set(fa);
    r.delete(value);
    return r;
  },
};

export const setGrowable: Growable<SetF> = {
  newBuilder: <A>(): Builder<A, Set<A>> => {
    const s = new Set<A>();
    return {
      addOne: (element: A) => {
        s.add(element);
      },
      result: () => s,
    };
  },
};

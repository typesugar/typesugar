import type { $ } from "../hkt.js";
import type { Iterable } from "./iterable.js";
import { toArray } from "./iterable-once.js";

export interface SetLike<F> extends Iterable<F> {
  readonly contains: <A>(fa: F<A>, value: A) => boolean;
  readonly add: <A>(fa: F<A>, value: A) => F<A>;
  readonly remove: <A>(fa: F<A>, value: A) => F<A>;
}

export function union<F>(
  F: SetLike<F>,
): <A>(fa: $<F, A>, fb: $<F, A>) => $<F, A> {
  return <A>(fa: $<F, A>, fb: $<F, A>): $<F, A> => {
    let r = fa;
    for (const b of F.iterator(fb)) r = F.add(r, b);
    return r;
  };
}

export function intersect<F>(
  F: SetLike<F>,
): <A>(fa: $<F, A>, fb: $<F, A>) => $<F, A> {
  return <A>(fa: $<F, A>, fb: $<F, A>): $<F, A> =>
    F.filter(fa, (a) => F.contains(fb, a));
}

export function diff<F>(
  F: SetLike<F>,
): <A>(fa: $<F, A>, fb: $<F, A>) => $<F, A> {
  return <A>(fa: $<F, A>, fb: $<F, A>): $<F, A> =>
    F.filter(fa, (a) => !F.contains(fb, a));
}

export function symmetricDiff<F>(
  F: SetLike<F>,
): <A>(fa: $<F, A>, fb: $<F, A>) => $<F, A> {
  return <A>(fa: $<F, A>, fb: $<F, A>): $<F, A> => {
    const inA = diff(F)(fa, fb);
    const inB = diff(F)(fb, fa);
    return union(F)(inA, inB);
  };
}

export function subsetOf<F>(
  F: SetLike<F>,
): <A>(fa: $<F, A>, fb: $<F, A>) => boolean {
  return <A>(fa: $<F, A>, fb: $<F, A>): boolean => {
    for (const a of F.iterator(fa)) {
      if (!F.contains(fb, a)) return false;
    }
    return true;
  };
}

export function supersetOf<F>(
  F: SetLike<F>,
): <A>(fa: $<F, A>, fb: $<F, A>) => boolean {
  return <A>(fa: $<F, A>, fb: $<F, A>): boolean => subsetOf(F)(fb, fa);
}

export function isDisjoint<F>(
  F: SetLike<F>,
): <A>(fa: $<F, A>, fb: $<F, A>) => boolean {
  return <A>(fa: $<F, A>, fb: $<F, A>): boolean => {
    for (const a of F.iterator(fa)) {
      if (F.contains(fb, a)) return false;
    }
    return true;
  };
}

export function powerSet<F>(F: SetLike<F>): <A>(fa: $<F, A>) => Set<$<F, A>> {
  return <A>(fa: $<F, A>): Set<$<F, A>> => {
    const arr = toArray(F)(fa);
    const result = new Set<$<F, A>>();
    const n = arr.length;
    for (let mask = 0; mask < 1 << n; mask++) {
      const subset: A[] = [];
      for (let i = 0; i < n; i++) {
        if (mask & (1 << i)) subset.push(arr[i]);
      }
      result.add(F.from(subset));
    }
    return result;
  };
}

export function addAll<F>(
  F: SetLike<F>,
): <A>(fa: $<F, A>, elements: globalThis.Iterable<A>) => $<F, A> {
  return <A>(fa: $<F, A>, elements: globalThis.Iterable<A>): $<F, A> => {
    let r = fa;
    for (const e of elements) r = F.add(r, e);
    return r;
  };
}

export function removeAll<F>(
  F: SetLike<F>,
): <A>(fa: $<F, A>, elements: globalThis.Iterable<A>) => $<F, A> {
  return <A>(fa: $<F, A>, elements: globalThis.Iterable<A>): $<F, A> => {
    let r = fa;
    for (const e of elements) r = F.remove(r, e);
    return r;
  };
}

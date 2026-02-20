import type { Sized, Searchable } from "@typesugar/std";
import type { IterableOnce } from "../typeclasses/iterable-once.js";
import type { $ } from "../hkt.js";

export function sizedFromIterableOnce<F, A>(
  F: IterableOnce<F>,
): Sized<$<F, A>> {
  return {
    size: (fa: $<F, A>) => F.foldLeft(fa, 0, (n) => n + 1),
    isEmpty: (fa: $<F, A>) => F.iterator(fa).next().done === true,
  };
}

export function searchableFromIterableOnce<F, A>(
  F: IterableOnce<F>,
): Searchable<$<F, A>> {
  return {
    find: (fa: $<F, A>, pred: (a: A) => boolean) => {
      for (const a of F.iterator(fa)) if (pred(a)) return a;
      return undefined;
    },
    contains: (fa: $<F, A>, elem: A) => {
      for (const a of F.iterator(fa)) if (a === elem) return true;
      return false;
    },
    indexOf: (fa: $<F, A>, elem: A) => {
      let i = 0;
      for (const a of F.iterator(fa)) {
        if (a === elem) return i;
        i++;
      }
      return -1;
    },
  };
}

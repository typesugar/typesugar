import type { $ } from "../hkt.js";
import type { Iterable } from "./iterable.js";
import { toArray } from "./iterable-once.js";

export interface Seq<F> extends Iterable<F> {
  readonly apply: <A>(fa: F<A>, index: number) => A;
  readonly reverse: <A>(fa: F<A>) => F<A>;
  readonly sorted: <A>(fa: F<A>, cmp?: (a: A, b: A) => number) => F<A>;
  readonly updated: <A>(fa: F<A>, index: number, value: A) => F<A>;
}

export function head<F>(F: Seq<F>): <A>(fa: $<F, A>) => A | undefined {
  return <A>(fa: $<F, A>): A | undefined => {
    const it = F.iterator(fa);
    const r = it.next();
    return r.done ? undefined : r.value;
  };
}

export function tail<F>(F: Seq<F>): <A>(fa: $<F, A>) => $<F, A> {
  return <A>(fa: $<F, A>): $<F, A> => F.from(toArray(F)(fa).slice(1));
}

export function last<F>(F: Seq<F>): <A>(fa: $<F, A>) => A | undefined {
  return <A>(fa: $<F, A>): A | undefined => {
    const arr = toArray(F)(fa);
    return arr.length > 0 ? arr[arr.length - 1] : undefined;
  };
}

export function init<F>(F: Seq<F>): <A>(fa: $<F, A>) => $<F, A> {
  return <A>(fa: $<F, A>): $<F, A> => F.from(toArray(F)(fa).slice(0, -1));
}

export function indexOf<F>(F: Seq<F>): <A>(fa: $<F, A>, elem: A) => number {
  return <A>(fa: $<F, A>, elem: A): number => {
    let i = 0;
    for (const a of F.iterator(fa)) {
      if (a === elem) return i;
      i++;
    }
    return -1;
  };
}

export function lastIndexOf<F>(F: Seq<F>): <A>(fa: $<F, A>, elem: A) => number {
  return <A>(fa: $<F, A>, elem: A): number => {
    const arr = toArray(F)(fa);
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i] === elem) return i;
    }
    return -1;
  };
}

export function sortBy<F>(
  F: Seq<F>,
): <A, B>(fa: $<F, A>, f: (a: A) => B) => $<F, A> {
  return <A, B>(fa: $<F, A>, f: (a: A) => B): $<F, A> => {
    const arr = toArray(F)(fa);
    arr.sort((a, b) => {
      const fa_ = f(a),
        fb_ = f(b);
      return fa_ < fb_ ? -1 : fa_ > fb_ ? 1 : 0;
    });
    return F.from(arr);
  };
}

export function distinct<F>(F: Seq<F>): <A>(fa: $<F, A>) => $<F, A> {
  return <A>(fa: $<F, A>): $<F, A> => {
    const seen = new Set<A>();
    const r: A[] = [];
    for (const a of F.iterator(fa)) {
      if (!seen.has(a)) {
        seen.add(a);
        r.push(a);
      }
    }
    return F.from(r);
  };
}

export function distinctBy<F>(
  F: Seq<F>,
): <A, K>(fa: $<F, A>, f: (a: A) => K) => $<F, A> {
  return <A, K>(fa: $<F, A>, f: (a: A) => K): $<F, A> => {
    const seen = new Set<K>();
    const r: A[] = [];
    for (const a of F.iterator(fa)) {
      const k = f(a);
      if (!seen.has(k)) {
        seen.add(k);
        r.push(a);
      }
    }
    return F.from(r);
  };
}

export function sliding<F>(
  F: Seq<F>,
): <A>(fa: $<F, A>, windowSize: number, step?: number) => $<F, A>[] {
  return <A>(fa: $<F, A>, windowSize: number, step = 1): $<F, A>[] => {
    const arr = toArray(F)(fa);
    const r: $<F, A>[] = [];
    for (let i = 0; i <= arr.length - windowSize; i += step)
      r.push(F.from(arr.slice(i, i + windowSize)));
    return r;
  };
}

export function splitAt<F>(
  F: Seq<F>,
): <A>(fa: $<F, A>, n: number) => [$<F, A>, $<F, A>] {
  return <A>(fa: $<F, A>, n: number): [$<F, A>, $<F, A>] => {
    const arr = toArray(F)(fa);
    return [F.from(arr.slice(0, n)), F.from(arr.slice(n))];
  };
}

export function span<F>(
  F: Seq<F>,
): <A>(fa: $<F, A>, p: (a: A) => boolean) => [$<F, A>, $<F, A>] {
  return <A>(fa: $<F, A>, p: (a: A) => boolean): [$<F, A>, $<F, A>] => {
    const arr = toArray(F)(fa);
    let i = 0;
    while (i < arr.length && p(arr[i])) i++;
    return [F.from(arr.slice(0, i)), F.from(arr.slice(i))];
  };
}

export function scanLeft<F>(
  F: Seq<F>,
): <A, B>(fa: $<F, A>, z: B, f: (b: B, a: A) => B) => $<F, B> {
  return <A, B>(fa: $<F, A>, z: B, f: (b: B, a: A) => B): $<F, B> => {
    const r: B[] = [z];
    let acc = z;
    for (const a of F.iterator(fa)) {
      acc = f(acc, a);
      r.push(acc);
    }
    return F.from(r) as $<F, B>;
  };
}

export function corresponds<F>(
  F: Seq<F>,
): <A, B>(fa: $<F, A>, fb: $<F, B>, p: (a: A, b: B) => boolean) => boolean {
  return <A, B>(
    fa: $<F, A>,
    fb: $<F, B>,
    p: (a: A, b: B) => boolean,
  ): boolean => {
    const ia = F.iterator(fa),
      ib = F.iterator(fb);
    while (true) {
      const a = ia.next(),
        b = ib.next();
      if (a.done && b.done) return true;
      if (a.done || b.done) return false;
      if (!p(a.value, b.value)) return false;
    }
  };
}

export function tails<F>(F: Seq<F>): <A>(fa: $<F, A>) => $<F, A>[] {
  return <A>(fa: $<F, A>): $<F, A>[] => {
    const arr = toArray(F)(fa);
    const r: $<F, A>[] = [];
    for (let i = 0; i <= arr.length; i++) r.push(F.from(arr.slice(i)));
    return r;
  };
}

export function inits<F>(F: Seq<F>): <A>(fa: $<F, A>) => $<F, A>[] {
  return <A>(fa: $<F, A>): $<F, A>[] => {
    const arr = toArray(F)(fa);
    const r: $<F, A>[] = [];
    for (let i = arr.length; i >= 0; i--) r.push(F.from(arr.slice(0, i)));
    return r;
  };
}

import type { $ } from "../hkt.js";
import type { IterableOnce } from "./iterable-once.js";
import { toArray } from "./iterable-once.js";

export interface Iterable<F> extends IterableOnce<F> {
  readonly map: <A, B>(fa: F<A>, f: (a: A) => B) => F<B>;
  readonly filter: <A>(fa: F<A>, p: (a: A) => boolean) => F<A>;
  readonly flatMap: <A, B>(fa: F<A>, f: (a: A) => F<B>) => F<B>;
  readonly from: <A>(elements: globalThis.Iterable<A>) => F<A>;
  readonly empty: <A>() => F<A>;
  readonly concat: <A>(fa: F<A>, fb: F<A>) => F<A>;
}

export function partition<F>(
  F: Iterable<F>,
): <A>(fa: $<F, A>, p: (a: A) => boolean) => [$<F, A>, $<F, A>] {
  return <A>(fa: $<F, A>, p: (a: A) => boolean): [$<F, A>, $<F, A>] => {
    const yes: A[] = [];
    const no: A[] = [];
    for (const a of F.iterator(fa)) {
      (p(a) ? yes : no).push(a);
    }
    return [F.from(yes), F.from(no)];
  };
}

export function groupBy<F>(
  F: Iterable<F>,
): <A, K>(fa: $<F, A>, f: (a: A) => K) => Map<K, $<F, A>> {
  return <A, K>(fa: $<F, A>, f: (a: A) => K): Map<K, $<F, A>> => {
    const groups = new Map<K, A[]>();
    for (const a of F.iterator(fa)) {
      const key = f(a);
      const arr = groups.get(key);
      if (arr) arr.push(a);
      else groups.set(key, [a]);
    }
    const result = new Map<K, $<F, A>>();
    for (const [k, v] of groups) result.set(k, F.from(v));
    return result;
  };
}

export function take<F>(
  F: Iterable<F>,
): <A>(fa: $<F, A>, n: number) => $<F, A> {
  return <A>(fa: $<F, A>, n: number): $<F, A> =>
    F.from(toArray(F)(fa).slice(0, n));
}

export function drop<F>(
  F: Iterable<F>,
): <A>(fa: $<F, A>, n: number) => $<F, A> {
  return <A>(fa: $<F, A>, n: number): $<F, A> =>
    F.from(toArray(F)(fa).slice(n));
}

export function takeWhile<F>(
  F: Iterable<F>,
): <A>(fa: $<F, A>, p: (a: A) => boolean) => $<F, A> {
  return <A>(fa: $<F, A>, p: (a: A) => boolean): $<F, A> => {
    const result: A[] = [];
    for (const a of F.iterator(fa)) {
      if (!p(a)) break;
      result.push(a);
    }
    return F.from(result);
  };
}

export function dropWhile<F>(
  F: Iterable<F>,
): <A>(fa: $<F, A>, p: (a: A) => boolean) => $<F, A> {
  return <A>(fa: $<F, A>, p: (a: A) => boolean): $<F, A> => {
    const result: A[] = [];
    let dropping = true;
    for (const a of F.iterator(fa)) {
      if (dropping && p(a)) continue;
      dropping = false;
      result.push(a);
    }
    return F.from(result);
  };
}

export function zip<F>(
  F: Iterable<F>,
): <A, B>(fa: $<F, A>, fb: $<F, B>) => $<F, [A, B]> {
  return <A, B>(fa: $<F, A>, fb: $<F, B>): $<F, [A, B]> => {
    const ia = F.iterator(fa),
      ib = F.iterator(fb);
    const result: [A, B][] = [];
    while (true) {
      const a = ia.next(),
        b = ib.next();
      if (a.done || b.done) break;
      result.push([a.value, b.value]);
    }
    return F.from(result) as $<F, [A, B]>;
  };
}

export function zipWithIndex<F>(
  F: Iterable<F>,
): <A>(fa: $<F, A>) => $<F, [A, number]> {
  return <A>(fa: $<F, A>): $<F, [A, number]> => {
    const result: [A, number][] = [];
    let i = 0;
    for (const a of F.iterator(fa)) result.push([a, i++]);
    return F.from(result) as $<F, [A, number]>;
  };
}

export function collect<F>(
  F: Iterable<F>,
): <A, B>(fa: $<F, A>, pf: (a: A) => B | undefined) => $<F, B> {
  return <A, B>(fa: $<F, A>, pf: (a: A) => B | undefined): $<F, B> => {
    const result: B[] = [];
    for (const a of F.iterator(fa)) {
      const b = pf(a);
      if (b !== undefined) result.push(b);
    }
    return F.from(result) as $<F, B>;
  };
}

export function intersperse<F>(
  F: Iterable<F>,
): <A>(fa: $<F, A>, sep: A) => $<F, A> {
  return <A>(fa: $<F, A>, sep: A): $<F, A> => {
    const result: A[] = [];
    let first = true;
    for (const a of F.iterator(fa)) {
      if (!first) result.push(sep);
      result.push(a);
      first = false;
    }
    return F.from(result);
  };
}

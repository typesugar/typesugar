import type { $ } from "../hkt.js";

export interface IterableOnce<F> {
  readonly iterator: <A>(fa: F<A>) => IterableIterator<A>;
  readonly foldLeft: <A, B>(fa: F<A>, z: B, f: (b: B, a: A) => B) => B;
}

export function foldRight<F>(
  F: IterableOnce<F>,
): <A, B>(fa: $<F, A>, z: B, f: (a: A, b: B) => B) => B {
  return <A, B>(fa: $<F, A>, z: B, f: (a: A, b: B) => B): B => {
    const arr = toArray(F)(fa);
    let acc = z;
    for (let i = arr.length - 1; i >= 0; i--) acc = f(arr[i], acc);
    return acc;
  };
}

export function forEach<F>(
  F: IterableOnce<F>,
): <A>(fa: $<F, A>, f: (a: A) => void) => void {
  return <A>(fa: $<F, A>, f: (a: A) => void): void => {
    for (const a of F.iterator(fa)) f(a);
  };
}

export function reduce<F>(
  F: IterableOnce<F>,
): <A>(fa: $<F, A>, f: (a: A, b: A) => A) => A | undefined {
  return <A>(fa: $<F, A>, f: (a: A, b: A) => A): A | undefined => {
    const it = F.iterator(fa);
    const first = it.next();
    if (first.done) return undefined;
    let acc = first.value;
    for (const a of { [Symbol.iterator]: () => it }) acc = f(acc, a);
    return acc;
  };
}

export function size<F>(F: IterableOnce<F>): <A>(fa: $<F, A>) => number {
  return <A>(fa: $<F, A>): number => F.foldLeft(fa, 0, (n, _) => n + 1);
}

export function isEmpty<F>(F: IterableOnce<F>): <A>(fa: $<F, A>) => boolean {
  return <A>(fa: $<F, A>): boolean => F.iterator(fa).next().done === true;
}

export function nonEmpty<F>(F: IterableOnce<F>): <A>(fa: $<F, A>) => boolean {
  return <A>(fa: $<F, A>): boolean => !isEmpty(F)(fa);
}

export function toArray<F>(F: IterableOnce<F>): <A>(fa: $<F, A>) => A[] {
  return <A>(fa: $<F, A>): A[] => Array.from(F.iterator(fa));
}

export function count<F>(
  F: IterableOnce<F>,
): <A>(fa: $<F, A>, p: (a: A) => boolean) => number {
  return <A>(fa: $<F, A>, p: (a: A) => boolean): number =>
    F.foldLeft(fa, 0, (n, a) => (p(a) ? n + 1 : n));
}

export function exists<F>(
  F: IterableOnce<F>,
): <A>(fa: $<F, A>, p: (a: A) => boolean) => boolean {
  return <A>(fa: $<F, A>, p: (a: A) => boolean): boolean => {
    for (const a of F.iterator(fa)) if (p(a)) return true;
    return false;
  };
}

export function forall<F>(
  F: IterableOnce<F>,
): <A>(fa: $<F, A>, p: (a: A) => boolean) => boolean {
  return <A>(fa: $<F, A>, p: (a: A) => boolean): boolean => {
    for (const a of F.iterator(fa)) if (!p(a)) return false;
    return true;
  };
}

export function find<F>(
  F: IterableOnce<F>,
): <A>(fa: $<F, A>, p: (a: A) => boolean) => A | undefined {
  return <A>(fa: $<F, A>, p: (a: A) => boolean): A | undefined => {
    for (const a of F.iterator(fa)) if (p(a)) return a;
    return undefined;
  };
}

export function sum<F>(F: IterableOnce<F>): (fa: $<F, number>) => number {
  return (fa: $<F, number>): number => F.foldLeft(fa, 0, (a, b) => a + b);
}

export function product<F>(F: IterableOnce<F>): (fa: $<F, number>) => number {
  return (fa: $<F, number>): number => F.foldLeft(fa, 1, (a, b) => a * b);
}

export function min<F>(
  F: IterableOnce<F>,
): (fa: $<F, number>) => number | undefined {
  return (fa: $<F, number>): number | undefined => {
    let result: number | undefined;
    for (const a of F.iterator(fa)) {
      if (result === undefined || a < result) result = a;
    }
    return result;
  };
}

export function max<F>(
  F: IterableOnce<F>,
): (fa: $<F, number>) => number | undefined {
  return (fa: $<F, number>): number | undefined => {
    let result: number | undefined;
    for (const a of F.iterator(fa)) {
      if (result === undefined || a > result) result = a;
    }
    return result;
  };
}

export function mkString<F>(
  F: IterableOnce<F>,
): <A>(fa: $<F, A>, sep?: string, start?: string, end?: string) => string {
  return <A>(fa: $<F, A>, sep = "", start = "", end = ""): string =>
    start + toArray(F)(fa).join(sep) + end;
}

export function toSet<F>(F: IterableOnce<F>): <A>(fa: $<F, A>) => Set<A> {
  return <A>(fa: $<F, A>): Set<A> => new Set(F.iterator(fa));
}

export function toMap<F>(
  F: IterableOnce<F>,
): <K, V>(fa: $<F, [K, V]>) => Map<K, V> {
  return <K, V>(fa: $<F, [K, V]>): Map<K, V> =>
    new Map(F.iterator(fa) as IterableIterator<[K, V]>);
}

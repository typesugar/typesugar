/**
 * String collection operations.
 *
 * String does NOT participate in the HKT typeclass hierarchy because `StringF`
 * maps `$<StringF, A> = string` for all `A`, discarding the type parameter.
 * This makes generic typeclass instances unsound — methods would claim to work
 * with arbitrary `A`/`B` but always deal with `string`.
 *
 * Instead, we provide concrete string-specific operations as a standalone object.
 */
export const stringOps = {
  iterator: (fa: string): IterableIterator<string> => fa[Symbol.iterator](),

  foldLeft: <B>(fa: string, z: B, f: (b: B, a: string) => B): B => {
    let acc = z;
    for (const c of fa) acc = f(acc, c);
    return acc;
  },

  map: (fa: string, f: (c: string) => string): string => {
    let r = "";
    for (const c of fa) r += f(c);
    return r;
  },

  filter: (fa: string, p: (c: string) => boolean): string => {
    let r = "";
    for (const c of fa) if (p(c)) r += c;
    return r;
  },

  flatMap: (fa: string, f: (c: string) => string): string => {
    let r = "";
    for (const c of fa) r += f(c);
    return r;
  },

  from: (elements: Iterable<string>): string => {
    let r = "";
    for (const c of elements) r += c;
    return r;
  },

  empty: (): string => "",

  concat: (fa: string, fb: string): string => fa + fb,

  apply: (fa: string, index: number): string => fa[index],

  reverse: (fa: string): string => [...fa].reverse().join(""),

  sorted: (fa: string, cmp?: (a: string, b: string) => number): string =>
    [...fa].sort(cmp).join(""),

  updated: (fa: string, index: number, value: string): string =>
    fa.slice(0, index) + value + fa.slice(index + 1),

  size: (fa: string): number => [...fa].length,

  isEmpty: (fa: string): boolean => fa.length === 0,

  head: (fa: string): string | undefined =>
    fa.length === 0 ? undefined : fa[0],

  tail: (fa: string): string => (fa.length <= 1 ? "" : fa.slice(1)),

  last: (fa: string): string | undefined =>
    fa.length === 0 ? undefined : fa[fa.length - 1],

  mkString: (fa: string, sep = ""): string => [...fa].join(sep),
};

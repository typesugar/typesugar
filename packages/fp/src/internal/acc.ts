/**
 * Internal: an immutable snoc-list accumulator for generic traverse-style
 * loops. Appending is O(1) and never mutates, so it is safe even when the
 * effect type runs a continuation more than once (e.g. the Array applicative),
 * unlike pushing into a shared array; converting once at the end keeps the
 * whole loop linear instead of the quadratic `[...acc, x]` copy.
 *
 * The empty accumulator is a non-null sentinel object: the Option applicative
 * is `A | null`, so `pure(null)` would read as None.
 *
 * @internal Not part of the public API.
 */
export type Acc<A> = { readonly init: Acc<A>; readonly last: A } | typeof emptyAcc;

export const emptyAcc: { readonly empty: true } = Object.freeze({ empty: true as const });

export function snoc<A>(acc: Acc<A>, a: A): Acc<A> {
  return { init: acc, last: a };
}

export function accToArray<A>(acc: Acc<A>): A[] {
  const out: A[] = [];
  for (let c = acc; c !== emptyAcc; ) {
    const cell = c as { readonly init: Acc<A>; readonly last: A };
    out.push(cell.last);
    c = cell.init;
  }
  return out.reverse();
}

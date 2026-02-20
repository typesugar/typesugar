import type { $ } from "../hkt.js";

/**
 * Builder accumulates elements of type `Elem` and produces a collection of type `Coll`.
 *
 * The two type parameters are necessary because the element type differs from
 * the collection type (e.g., `Builder<number, number[]>` for arrays).
 */
export interface Builder<Elem, Coll> {
  addOne(element: Elem): void;
  result(): Coll;
}

/**
 * Growable provides a builder factory for constructing collections of type `F<A>`
 * from elements of type `A`.
 *
 * Note: This only works for collections where the element type matches the
 * HKT parameter (e.g., Array, Set). For key-value collections like Map,
 * the entry type `[K, V]` doesn't match the HKT parameter `V`, so Map
 * cannot soundly implement Growable.
 */
export interface Growable<F> {
  readonly newBuilder: <A>() => Builder<A, F<A>>;
}

export function buildFrom<F>(
  G: Growable<F>,
): <A>(elements: globalThis.Iterable<A>) => $<F, A> {
  return <A>(elements: globalThis.Iterable<A>): $<F, A> => {
    const b = G.newBuilder<A>();
    for (const e of elements) b.addOne(e);
    return b.result();
  };
}

/**
 * Foldable Typeclass
 *
 * Data structures that can be reduced to a summary value.
 * This is the fundamental abstraction for consuming collections.
 *
 * Laws:
 *   - foldRight is consistent with foldMap using Endo monoid
 *   - foldLeft is consistent with foldMap using Dual Endo monoid
 */

import type { Monoid } from "./semigroup.js";
import type { $ } from "../hkt.js";

// ============================================================================
// Foldable
// ============================================================================

/**
 * Foldable typeclass
 */
export interface Foldable<F> {
  readonly foldLeft: <A, B>(fa: $<F, A>, b: B, f: (b: B, a: A) => B) => B;
  readonly foldRight: <A, B>(fa: $<F, A>, b: B, f: (a: A, b: B) => B) => B;
}

// ============================================================================
// Derived Operations
// ============================================================================

/**
 * Map each element to a monoid and combine
 */
export function foldMap<F>(
  F: Foldable<F>,
): <M>(M: Monoid<M>) => <A>(fa: $<F, A>, f: (a: A) => M) => M {
  return (M) => (fa, f) =>
    F.foldLeft(fa, M.empty, (acc, a) => M.combine(acc, f(a)));
}

/**
 * Combine all elements using a monoid
 */
export function fold<F>(
  F: Foldable<F>,
): <A>(M: Monoid<A>) => (fa: $<F, A>) => A {
  return (M) => (fa) => F.foldLeft(fa, M.empty, M.combine);
}

/**
 * Check if any element satisfies a predicate
 */
export function exists<F>(
  F: Foldable<F>,
): <A>(fa: $<F, A>, p: (a: A) => boolean) => boolean {
  return (fa, p) => F.foldLeft(fa, false, (acc, a) => acc || p(a));
}

/**
 * Check if all elements satisfy a predicate
 */
export function forall<F>(
  F: Foldable<F>,
): <A>(fa: $<F, A>, p: (a: A) => boolean) => boolean {
  return (fa, p) => F.foldLeft(fa, true, (acc, a) => acc && p(a));
}

/**
 * Check if the structure is empty
 */
export function isEmpty<F>(F: Foldable<F>): <A>(fa: $<F, A>) => boolean {
  return (fa) => F.foldLeft(fa, true, () => false);
}

/**
 * Check if the structure is non-empty
 */
export function nonEmpty<F>(F: Foldable<F>): <A>(fa: $<F, A>) => boolean {
  return (fa) => !isEmpty(F)(fa);
}

/**
 * Count the number of elements
 */
export function size<F>(F: Foldable<F>): <A>(fa: $<F, A>) => number {
  return (fa) => F.foldLeft(fa, 0, (acc, _) => acc + 1);
}

/**
 * Find the first element satisfying a predicate
 */
export function find<F>(
  F: Foldable<F>,
): <A>(fa: $<F, A>, p: (a: A) => boolean) => A | undefined {
  return <A>(fa: $<F, A>, p: (a: A) => boolean): A | undefined =>
    F.foldLeft<A, A | undefined>(fa, undefined, (acc, a) =>
      acc !== undefined ? acc : p(a) ? a : undefined,
    );
}

/**
 * Get the first element
 */
export function head<F>(F: Foldable<F>): <A>(fa: $<F, A>) => A | undefined {
  return (fa) => find(F)(fa, () => true);
}

/**
 * Get the last element
 */
export function last<F>(F: Foldable<F>): <A>(fa: $<F, A>) => A | undefined {
  return <A>(fa: $<F, A>): A | undefined =>
    F.foldLeft<A, A | undefined>(fa, undefined, (_, a) => a);
}

/**
 * Convert to an array
 */
export function toArray<F>(F: Foldable<F>): <A>(fa: $<F, A>) => A[] {
  return <A>(fa: $<F, A>): A[] =>
    F.foldLeft<A, A[]>(fa, [], (acc, a) => {
      acc.push(a);
      return acc;
    });
}

/**
 * Filter elements and collect to array
 */
export function filter<F>(
  F: Foldable<F>,
): <A>(fa: $<F, A>, p: (a: A) => boolean) => A[] {
  return <A>(fa: $<F, A>, p: (a: A) => boolean): A[] =>
    F.foldLeft<A, A[]>(fa, [], (acc, a) => {
      if (p(a)) acc.push(a);
      return acc;
    });
}

/**
 * Get minimum element (requires a comparison function)
 */
export function minimum<F>(
  F: Foldable<F>,
): <A>(fa: $<F, A>, compare: (a: A, b: A) => number) => A | undefined {
  return <A>(fa: $<F, A>, compare: (a: A, b: A) => number): A | undefined =>
    F.foldLeft<A, A | undefined>(fa, undefined, (acc, a) =>
      acc === undefined ? a : compare(a, acc) < 0 ? a : acc,
    );
}

/**
 * Get maximum element (requires a comparison function)
 */
export function maximum<F>(
  F: Foldable<F>,
): <A>(fa: $<F, A>, compare: (a: A, b: A) => number) => A | undefined {
  return <A>(fa: $<F, A>, compare: (a: A, b: A) => number): A | undefined =>
    F.foldLeft<A, A | undefined>(fa, undefined, (acc, a) =>
      acc === undefined ? a : compare(a, acc) > 0 ? a : acc,
    );
}

/**
 * Check if an element exists in the structure
 */
export function contains<F>(
  F: Foldable<F>,
): <A>(fa: $<F, A>, a: A, eq: (x: A, y: A) => boolean) => boolean {
  return (fa, a, eq) => exists(F)(fa, (x) => eq(x, a));
}

// ============================================================================
// Instance Creator
// ============================================================================

/**
 * Create a Foldable instance
 */
export function makeFoldable<F>(
  foldLeft: <A, B>(fa: $<F, A>, b: B, f: (b: B, a: A) => B) => B,
  foldRight: <A, B>(fa: $<F, A>, b: B, f: (a: A, b: B) => B) => B,
): Foldable<F> {
  return { foldLeft, foldRight };
}

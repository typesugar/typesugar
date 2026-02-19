/**
 * SemigroupK, MonoidK, and Alternative Typeclasses
 *
 * These typeclasses provide monoidal operations at the type constructor level.
 * While Semigroup/Monoid work on types, SemigroupK/MonoidK work on type constructors.
 *
 * Laws:
 *   - Associativity: combineK(combineK(x, y), z) === combineK(x, combineK(y, z))
 *   - Left identity: combineK(emptyK, x) === x
 *   - Right identity: combineK(x, emptyK) === x
 */

import type { Applicative } from "./applicative.js";
import type { $ } from "../hkt.js";

// ============================================================================
// SemigroupK
// ============================================================================

/**
 * SemigroupK typeclass - Semigroup at the type constructor level
 */
export interface SemigroupK<F> {
  readonly combineK: <A>(x: $<F, A>, y: $<F, A>) => $<F, A>;
}

// ============================================================================
// MonoidK
// ============================================================================

/**
 * MonoidK typeclass - Monoid at the type constructor level
 */
export interface MonoidK<F> extends SemigroupK<F> {
  readonly emptyK: <A>() => $<F, A>;
}

// ============================================================================
// Alternative
// ============================================================================

/**
 * Alternative typeclass - MonoidK with Applicative
 */
export interface Alternative<F> extends Applicative<F>, MonoidK<F> {}

// ============================================================================
// Derived Operations from SemigroupK
// ============================================================================

/**
 * Combine multiple values
 */
export function combineAllK<F>(
  F: SemigroupK<F>,
): <A>(head: $<F, A>, ...tail: $<F, A>[]) => $<F, A> {
  return (head, ...tail) => tail.reduce((acc, fa) => F.combineK(acc, fa), head);
}

/**
 * Try first, if "empty" use second
 */
export function orElseK<F>(
  F: SemigroupK<F>,
): <A>(fa: $<F, A>, fb: () => $<F, A>) => $<F, A> {
  return (fa, fb) => F.combineK(fa, fb());
}

// ============================================================================
// Derived Operations from MonoidK
// ============================================================================

/**
 * Combine all values, using emptyK for empty array
 */
export function combineAllOptionK<F>(
  F: MonoidK<F>,
): <A>(fas: $<F, A>[]) => $<F, A> {
  return <A>(fas: $<F, A>[]): $<F, A> =>
    fas.length === 0
      ? F.emptyK<A>()
      : fas.reduce((acc, fa) => F.combineK(acc, fa));
}

/**
 * Filter and collect values
 */
export function unite<F>(F: MonoidK<F>): <A>(ffa: $<F, $<F, A>>[]) => $<F, A> {
  return <A>(ffa: $<F, $<F, A>>[]): $<F, A> =>
    ffa.reduce<$<F, A>>((acc, ffa_i) => F.combineK(acc, ffa_i), F.emptyK<A>());
}

// ============================================================================
// Derived Operations from Alternative
// ============================================================================

/**
 * Choose based on boolean - pure conditional
 */
export function guard<F>(F: Alternative<F>): (b: boolean) => $<F, void> {
  return (b) => (b ? F.pure(undefined) : F.emptyK());
}

/**
 * Keep only elements satisfying predicate.
 * Requires the Alternative to also support flatMap (i.e., be a Monad).
 * Falls back to a map-based approximation if flatMap is not available,
 * which may not filter correctly for all types.
 */
export function filterA<F>(
  F: Alternative<F> & {
    flatMap?: <A, B>(fa: $<F, A>, f: (a: A) => $<F, B>) => $<F, B>;
  },
): <A>(fa: $<F, A>, p: (a: A) => boolean) => $<F, A> {
  return (fa, p) => {
    if (F.flatMap) {
      return F.flatMap(fa, (a: any) => (p(a) ? F.pure(a) : F.emptyK()));
    }
    throw new Error(
      "filterA requires flatMap (Monad) support. The provided Alternative does not have flatMap.",
    );
  };
}

/**
 * Repeat zero or more times (Kleene star).
 *
 * WARNING: This function requires lazy evaluation semantics to terminate.
 * In TypeScript's strict evaluation, calling this will infinite-loop for
 * most Alternative instances. Only use with explicitly lazy types.
 *
 * @deprecated Unsafe in strict evaluation — will infinite-loop for most types.
 */
export function many<F>(F: Alternative<F>): <A>(fa: $<F, A>) => $<F, A[]> {
  return (_fa) => {
    throw new Error(
      "many() requires lazy evaluation and will infinite-loop in TypeScript's strict evaluation. " +
        "Use an explicit loop or recursion with a termination condition instead.",
    );
  };
}

/**
 * Repeat one or more times (Kleene plus).
 *
 * WARNING: This function requires lazy evaluation semantics to terminate.
 * In TypeScript's strict evaluation, calling this will infinite-loop for
 * most Alternative instances. Only use with explicitly lazy types.
 *
 * @deprecated Unsafe in strict evaluation — will infinite-loop for most types.
 */
export function some<F>(F: Alternative<F>): <A>(fa: $<F, A>) => $<F, A[]> {
  return (_fa) => {
    throw new Error(
      "some() requires lazy evaluation and will infinite-loop in TypeScript's strict evaluation. " +
        "Use an explicit loop or recursion with a termination condition instead.",
    );
  };
}

// ============================================================================
// Safe Bounded Alternatives to many/some
// ============================================================================

/**
 * Repeat up to `maxTimes` times, collecting results.
 * This is a safe, bounded alternative to `many` that won't infinite-loop.
 *
 * Requires flatMap support (the Alternative must also be a Monad).
 *
 * @example
 * ```typescript
 * // Parse up to 10 digits
 * const digits = manyBounded(parseAlternative, 10)(digitParser);
 * ```
 */
export function manyBounded<F>(
  F: Alternative<F> & {
    flatMap: <A, B>(fa: $<F, A>, f: (a: A) => $<F, B>) => $<F, B>;
  },
  maxTimes: number,
): <A>(fa: $<F, A>) => $<F, A[]> {
  return <A>(fa: $<F, A>): $<F, A[]> => {
    if (maxTimes <= 0) {
      return F.pure([]);
    }

    // Try to get one element, then recurse with maxTimes - 1
    const one: $<F, A[]> = F.map(fa, (a) => [a]);
    const rest: $<F, A[]> = manyBounded(F, maxTimes - 1)(fa);

    // Combine: if we get one, prepend to rest; otherwise return empty
    return F.combineK(
      F.flatMap(one, (first) => F.map(rest, (others) => [...first, ...others])),
      F.pure([]),
    );
  };
}

/**
 * Repeat at least once and up to `maxTimes` times, collecting results.
 * This is a safe, bounded alternative to `some` that won't infinite-loop.
 *
 * Requires flatMap support (the Alternative must also be a Monad).
 *
 * @example
 * ```typescript
 * // Parse 1 to 10 digits
 * const digits = someBounded(parseAlternative, 10)(digitParser);
 * ```
 */
export function someBounded<F>(
  F: Alternative<F> & {
    flatMap: <A, B>(fa: $<F, A>, f: (a: A) => $<F, B>) => $<F, B>;
  },
  maxTimes: number,
): <A>(fa: $<F, A>) => $<F, A[]> {
  return <A>(fa: $<F, A>): $<F, A[]> => {
    if (maxTimes <= 0) {
      return F.emptyK();
    }

    // Must get at least one, then can have up to maxTimes - 1 more
    return F.flatMap(fa, (first) =>
      F.map(manyBounded(F, maxTimes - 1)(fa), (rest) => [first, ...rest]),
    );
  };
}

/**
 * Repeat exactly `n` times, collecting results.
 * Fails if fewer than `n` elements can be produced.
 *
 * Requires flatMap support (the Alternative must also be a Monad).
 *
 * @example
 * ```typescript
 * // Parse exactly 4 hex digits
 * const fourHex = replicateA(parseAlternative, 4)(hexDigitParser);
 * ```
 */
export function replicateA<F>(
  F: Alternative<F> & {
    flatMap: <A, B>(fa: $<F, A>, f: (a: A) => $<F, B>) => $<F, B>;
  },
  n: number,
): <A>(fa: $<F, A>) => $<F, A[]> {
  return <A>(fa: $<F, A>): $<F, A[]> => {
    if (n <= 0) {
      return F.pure([]);
    }
    return F.flatMap(fa, (first) =>
      F.map(replicateA(F, n - 1)(fa), (rest) => [first, ...rest]),
    );
  };
}

/**
 * Separate a structure of Eithers into lefts and rights.
 * Requires the Alternative to also support flatMap (i.e., be a Monad).
 */
export function separate<F>(
  F: Alternative<F> & {
    flatMap?: <A, B>(fa: $<F, A>, f: (a: A) => $<F, B>) => $<F, B>;
  },
): <A, B>(
  fab: $<F, { _tag: "Left"; value: A } | { _tag: "Right"; value: B }>,
) => { left: $<F, A>; right: $<F, B> } {
  return (fab) => {
    if (!F.flatMap) {
      throw new Error(
        "separate requires flatMap (Monad) support. The provided Alternative does not have flatMap.",
      );
    }
    return {
      left: F.flatMap(fab, (either: any) =>
        either._tag === "Left" ? F.pure(either.value) : F.emptyK(),
      ) as $<F, any>,
      right: F.flatMap(fab, (either: any) =>
        either._tag === "Right" ? F.pure(either.value) : F.emptyK(),
      ) as $<F, any>,
    };
  };
}

// ============================================================================
// Instance Creators
// ============================================================================

/**
 * Create a SemigroupK instance
 */
export function makeSemigroupK<F>(
  combineK: <A>(x: $<F, A>, y: $<F, A>) => $<F, A>,
): SemigroupK<F> {
  return { combineK };
}

/**
 * Create a MonoidK instance
 */
export function makeMonoidK<F>(
  combineK: <A>(x: $<F, A>, y: $<F, A>) => $<F, A>,
  emptyK: <A>() => $<F, A>,
): MonoidK<F> {
  return { combineK, emptyK };
}

/**
 * Create an Alternative instance
 */
export function makeAlternative<F>(
  map: <A, B>(fa: $<F, A>, f: (a: A) => B) => $<F, B>,
  ap: <A, B>(fab: $<F, (a: A) => B>, fa: $<F, A>) => $<F, B>,
  pure: <A>(a: A) => $<F, A>,
  combineK: <A>(x: $<F, A>, y: $<F, A>) => $<F, A>,
  emptyK: <A>() => $<F, A>,
): Alternative<F> {
  return { map, ap, pure, combineK, emptyK };
}

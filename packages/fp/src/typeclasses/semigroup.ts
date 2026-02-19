/**
 * Semigroup and Monoid Typeclasses
 *
 * Semigroup: A type with an associative binary operation.
 * Monoid: A Semigroup with an identity element.
 *
 * Laws:
 *   - Semigroup Associativity: combine(combine(x, y), z) === combine(x, combine(y, z))
 *   - Monoid Left Identity: combine(empty, x) === x
 *   - Monoid Right Identity: combine(x, empty) === x
 */

// ============================================================================
// Semigroup
// ============================================================================

/**
 * Semigroup typeclass
 */
export interface Semigroup<A> {
  readonly combine: (x: A, y: A) => A;
}

// ============================================================================
// Monoid
// ============================================================================

/**
 * Monoid typeclass - Semigroup with identity
 */
export interface Monoid<A> extends Semigroup<A> {
  readonly empty: A;
}

// ============================================================================
// Derived Operations
// ============================================================================

/**
 * Combine all elements using the Semigroup
 */
export function combineAll<A>(S: Semigroup<A>): (as: A[]) => A | undefined {
  return (as) => {
    if (as.length === 0) return undefined;
    return as.reduce((acc, a) => S.combine(acc, a));
  };
}

/**
 * Combine all elements using the Monoid (returns empty for empty array)
 */
export function combineAllMonoid<A>(M: Monoid<A>): (as: A[]) => A {
  return (as) => as.reduce((acc, a) => M.combine(acc, a), M.empty);
}

/**
 * Repeat a value n times and combine
 */
export function combineN<A>(S: Semigroup<A>): (a: A, n: number) => A {
  return (a, n) => {
    if (n <= 0) throw new Error("n must be positive");
    if (n === 1) return a;
    let result = a;
    for (let i = 1; i < n; i++) {
      result = S.combine(result, a);
    }
    return result;
  };
}

/**
 * Intercalate - combine with a separator between elements
 */
export function intercalate<A>(
  S: Semigroup<A>,
): (sep: A, as: A[]) => A | undefined {
  return (sep, as) => {
    if (as.length === 0) return undefined;
    if (as.length === 1) return as[0];
    return as
      .slice(1)
      .reduce((acc, a) => S.combine(S.combine(acc, sep), a), as[0]);
  };
}

/**
 * Returns true if the value equals the monoid's empty
 */
export function isEmpty<A>(
  M: Monoid<A>,
  eq: (x: A, y: A) => boolean,
): (a: A) => boolean {
  return (a) => eq(a, M.empty);
}

// ============================================================================
// Semigroup Combinators
// ============================================================================

/**
 * Reverse the order of combination
 */
export function reverse<A>(S: Semigroup<A>): Semigroup<A> {
  return {
    combine: (x, y) => S.combine(y, x),
  };
}

/**
 * Always return the first argument
 */
export function first<A>(): Semigroup<A> {
  return {
    combine: (x, _) => x,
  };
}

/**
 * Always return the last argument
 */
export function last<A>(): Semigroup<A> {
  return {
    combine: (_, y) => y,
  };
}

/**
 * Return the minimum of two values
 */
export function min<A>(compare: (x: A, y: A) => number): Semigroup<A> {
  return {
    combine: (x, y) => (compare(x, y) <= 0 ? x : y),
  };
}

/**
 * Return the maximum of two values
 */
export function max<A>(compare: (x: A, y: A) => number): Semigroup<A> {
  return {
    combine: (x, y) => (compare(x, y) >= 0 ? x : y),
  };
}

// ============================================================================
// Common Instances
// ============================================================================

/**
 * Semigroup for string concatenation
 */
export const semigroupString: Semigroup<string> = {
  combine: (x, y) => x + y,
};

/**
 * Monoid for string concatenation
 */
export const monoidString: Monoid<string> = {
  ...semigroupString,
  empty: "",
};

/**
 * Semigroup for number addition
 */
export const semigroupSum: Semigroup<number> = {
  combine: (x, y) => x + y,
};

/**
 * Monoid for number addition
 */
export const monoidSum: Monoid<number> = {
  ...semigroupSum,
  empty: 0,
};

/**
 * Semigroup for number multiplication
 */
export const semigroupProduct: Semigroup<number> = {
  combine: (x, y) => x * y,
};

/**
 * Monoid for number multiplication
 */
export const monoidProduct: Monoid<number> = {
  ...semigroupProduct,
  empty: 1,
};

/**
 * Semigroup for boolean AND
 */
export const semigroupAll: Semigroup<boolean> = {
  combine: (x, y) => x && y,
};

/**
 * Monoid for boolean AND
 */
export const monoidAll: Monoid<boolean> = {
  ...semigroupAll,
  empty: true,
};

/**
 * Semigroup for boolean OR
 */
export const semigroupAny: Semigroup<boolean> = {
  combine: (x, y) => x || y,
};

/**
 * Monoid for boolean OR
 */
export const monoidAny: Monoid<boolean> = {
  ...semigroupAny,
  empty: false,
};

/**
 * Semigroup for arrays (concatenation)
 */
export function semigroupArray<A>(): Semigroup<A[]> {
  return {
    combine: (x, y) => [...x, ...y],
  };
}

/**
 * Monoid for arrays (concatenation with empty)
 */
export function monoidArray<A>(): Monoid<A[]> {
  return {
    ...semigroupArray<A>(),
    empty: [],
  };
}

/**
 * Semigroup for functions (composition)
 */
export function semigroupFunction<A>(): Semigroup<(a: A) => A> {
  return {
    combine: (f, g) => (a) => f(g(a)),
  };
}

/**
 * Monoid for functions (composition with identity)
 */
export function monoidFunction<A>(): Monoid<(a: A) => A> {
  return {
    ...semigroupFunction<A>(),
    empty: (a) => a,
  };
}

/**
 * Semigroup for tuples (combines component-wise)
 */
export function semigroupTuple<A, B>(
  SA: Semigroup<A>,
  SB: Semigroup<B>,
): Semigroup<[A, B]> {
  return {
    combine: ([a1, b1], [a2, b2]) => [SA.combine(a1, a2), SB.combine(b1, b2)],
  };
}

/**
 * Monoid for tuples
 */
export function monoidTuple<A, B>(
  MA: Monoid<A>,
  MB: Monoid<B>,
): Monoid<[A, B]> {
  return {
    ...semigroupTuple(MA, MB),
    empty: [MA.empty, MB.empty],
  };
}

/**
 * Semigroup for records (combines values with the same key)
 */
export function semigroupRecord<K extends string, V>(
  S: Semigroup<V>,
): Semigroup<Record<K, V>> {
  return {
    combine: (x, y) => {
      const result = { ...x } as Record<K, V>;
      for (const key in y) {
        if (key in result) {
          result[key] = S.combine(result[key], y[key]);
        } else {
          result[key] = y[key];
        }
      }
      return result;
    },
  };
}

// ============================================================================
// Instance Creators
// ============================================================================

/**
 * Create a Semigroup from a combine function
 */
export function makeSemigroup<A>(combine: (x: A, y: A) => A): Semigroup<A> {
  return { combine };
}

/**
 * Create a Monoid from a combine function and empty value
 */
export function makeMonoid<A>(empty: A, combine: (x: A, y: A) => A): Monoid<A> {
  return { empty, combine };
}

// ============================================================================
// Dual
// ============================================================================

/**
 * The dual of a Semigroup (reverses the combine order)
 */
export function getDual<A>(S: Semigroup<A>): Semigroup<A> {
  return reverse(S);
}

/**
 * The dual of a Monoid
 */
export function getDualMonoid<A>(M: Monoid<A>): Monoid<A> {
  return {
    ...getDual(M),
    empty: M.empty,
  };
}

// ============================================================================
// Endo
// ============================================================================

/**
 * Endomorphism - a function from A to A
 */
export type Endo<A> = (a: A) => A;

/**
 * Monoid for endomorphisms (function composition)
 */
export function monoidEndo<A>(): Monoid<Endo<A>> {
  return {
    combine: (f, g) => (a) => f(g(a)),
    empty: (a) => a,
  };
}

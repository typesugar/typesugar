/**
 * Standard Typeclasses
 *
 * A comprehensive set of typeclasses drawing from the best of:
 * - Haskell (Bounded, Enum, Num, Integral, Fractional, Read, Show)
 * - Scala 3 (Ordering, Numeric, Conversion, CanEqual)
 * - Rust (Default, Clone, Copy, Display, FromStr, Into/From, Iterator)
 * - Kotlin (Comparable, ClosedRange, Iterable, Grouping)
 * - Swift (Codable, Hashable, Identifiable, CustomStringConvertible)
 *
 * All typeclasses follow the @typeclass pattern and support:
 * - Auto-derivation via @deriving
 * - Extension methods via the typeclass system
 * - Zero-cost specialization via inlining
 * - Operator overloading via Op<> annotations
 */

import type { Op } from "@typesugar/core";
import { typeclass } from "@typesugar/macros/runtime";
import { registerInstanceWithMeta } from "@typesugar/macros";

// ============================================================================
// Eq — Haskell Eq, Rust PartialEq/Eq, Scala CanEqual
// Types supporting equality comparison.
// ============================================================================

/**
 * Eq typeclass - equality comparison with operator support.
 *
 * Laws:
 * - Reflexivity: `equals(x, x) === true`
 * - Symmetry: `equals(x, y) === equals(y, x)`
 * - Transitivity: `equals(x, y) && equals(y, z) => equals(x, z)`
 *
 * Operators dispatch via Op<> annotations:
 * - `a === b` → `Eq.equals(a, b)`
 * - `a !== b` → `Eq.notEquals(a, b)`
 *
 * @typeclass
 */
export interface Eq<A> {
  equals(a: A, b: A): boolean & Op<"===">;
  notEquals(a: A, b: A): boolean & Op<"!==">;
}
typeclass("Eq");

export const eqNumber: Eq<number> = {
  equals: (a, b) => a === b,
  notEquals: (a, b) => a !== b,
};
registerInstanceWithMeta({
  typeclassName: "Eq",
  forType: "number",
  instanceName: "eqNumber",
  derived: false,
});

export const eqBigInt: Eq<bigint> = {
  equals: (a, b) => a === b,
  notEquals: (a, b) => a !== b,
};
registerInstanceWithMeta({
  typeclassName: "Eq",
  forType: "bigint",
  instanceName: "eqBigInt",
  derived: false,
});

export const eqString: Eq<string> = {
  equals: (a, b) => a === b,
  notEquals: (a, b) => a !== b,
};
registerInstanceWithMeta({
  typeclassName: "Eq",
  forType: "string",
  instanceName: "eqString",
  derived: false,
});

export const eqBoolean: Eq<boolean> = {
  equals: (a, b) => a === b,
  notEquals: (a, b) => a !== b,
};
registerInstanceWithMeta({
  typeclassName: "Eq",
  forType: "boolean",
  instanceName: "eqBoolean",
  derived: false,
});

export const eqDate: Eq<Date> = {
  equals: (a, b) => a.getTime() === b.getTime(),
  notEquals: (a, b) => a.getTime() !== b.getTime(),
};
registerInstanceWithMeta({
  typeclassName: "Eq",
  forType: "Date",
  instanceName: "eqDate",
  derived: false,
});

/**
 * Create an Eq instance from a custom equality function.
 */
export function makeEq<A>(eq: (a: A, b: A) => boolean): Eq<A> {
  return {
    equals: eq as (a: A, b: A) => boolean & Op<"===">,
    notEquals: ((a: A, b: A) => !eq(a, b)) as (a: A, b: A) => boolean & Op<"!==">,
  };
}

/**
 * Create an Eq instance by mapping to a comparable value.
 */
export function eqBy<A, B>(f: (a: A) => B, E: Eq<B> = eqStrict()): Eq<A> {
  return {
    equals: ((a, b) => E.equals(f(a), f(b))) as (a: A, b: A) => boolean & Op<"===">,
    notEquals: ((a, b) => E.notEquals(f(a), f(b))) as (a: A, b: A) => boolean & Op<"!==">,
  };
}

/**
 * Eq using strict equality (===).
 */
export function eqStrict<A>(): Eq<A> {
  return {
    equals: ((a, b) => a === b) as (a: A, b: A) => boolean & Op<"===">,
    notEquals: ((a, b) => a !== b) as (a: A, b: A) => boolean & Op<"!==">,
  };
}

/**
 * Eq for arrays (element-wise comparison).
 */
export function eqArray<A>(E: Eq<A>): Eq<A[]> {
  return {
    equals: ((xs, ys) => {
      if (xs.length !== ys.length) return false;
      return xs.every((x, i) => E.equals(x, ys[i]));
    }) as (a: A[], b: A[]) => boolean & Op<"===">,
    notEquals: ((xs, ys) => {
      if (xs.length !== ys.length) return true;
      return xs.some((x, i) => E.notEquals(x, ys[i]));
    }) as (a: A[], b: A[]) => boolean & Op<"!==">,
  };
}

// ============================================================================
// Ord — Haskell Ord, Rust Ord, Scala Ordering
// Types supporting total ordering.
// ============================================================================

/**
 * Ordering result type.
 */
export type Ordering = -1 | 0 | 1;
export const LT: Ordering = -1;
export const EQ_ORD: Ordering = 0;
export const GT: Ordering = 1;

/**
 * Ord typeclass - total ordering with operator support.
 *
 * Laws (in addition to Eq laws):
 * - Antisymmetry: `compare(x, y) <= 0 && compare(y, x) <= 0 => equals(x, y)`
 * - Transitivity: `compare(x, y) <= 0 && compare(y, z) <= 0 => compare(x, z) <= 0`
 * - Totality: `compare(x, y) <= 0 || compare(y, x) <= 0`
 *
 * Operators dispatch via Op<> annotations:
 * - `a < b`  → `Ord.lessThan(a, b)`
 * - `a <= b` → `Ord.lessThanOrEqual(a, b)`
 * - `a > b`  → `Ord.greaterThan(a, b)`
 * - `a >= b` → `Ord.greaterThanOrEqual(a, b)`
 *
 * @typeclass
 */
export interface Ord<A> extends Eq<A> {
  compare(a: A, b: A): Ordering;
  lessThan(a: A, b: A): boolean & Op<"<">;
  lessThanOrEqual(a: A, b: A): boolean & Op<"<=">;
  greaterThan(a: A, b: A): boolean & Op<">">;
  greaterThanOrEqual(a: A, b: A): boolean & Op<">=">;
}
typeclass("Ord");

export const ordNumber: Ord<number> = {
  equals: (a, b) => a === b,
  notEquals: (a, b) => a !== b,
  compare: (a, b) => (a < b ? LT : a > b ? GT : EQ_ORD),
  lessThan: (a, b) => a < b,
  lessThanOrEqual: (a, b) => a <= b,
  greaterThan: (a, b) => a > b,
  greaterThanOrEqual: (a, b) => a >= b,
};
registerInstanceWithMeta({
  typeclassName: "Ord",
  forType: "number",
  instanceName: "ordNumber",
  derived: false,
});

export const ordBigInt: Ord<bigint> = {
  equals: (a, b) => a === b,
  notEquals: (a, b) => a !== b,
  compare: (a, b) => (a < b ? LT : a > b ? GT : EQ_ORD),
  lessThan: (a, b) => a < b,
  lessThanOrEqual: (a, b) => a <= b,
  greaterThan: (a, b) => a > b,
  greaterThanOrEqual: (a, b) => a >= b,
};
registerInstanceWithMeta({
  typeclassName: "Ord",
  forType: "bigint",
  instanceName: "ordBigInt",
  derived: false,
});

export const ordString: Ord<string> = {
  equals: (a, b) => a === b,
  notEquals: (a, b) => a !== b,
  compare: (a, b) => (a < b ? LT : a > b ? GT : EQ_ORD),
  lessThan: (a, b) => a < b,
  lessThanOrEqual: (a, b) => a <= b,
  greaterThan: (a, b) => a > b,
  greaterThanOrEqual: (a, b) => a >= b,
};
registerInstanceWithMeta({
  typeclassName: "Ord",
  forType: "string",
  instanceName: "ordString",
  derived: false,
});

export const ordBoolean: Ord<boolean> = {
  equals: (a, b) => a === b,
  notEquals: (a, b) => a !== b,
  compare: (a, b) => (a === b ? EQ_ORD : a ? GT : LT),
  lessThan: (a, b) => !a && b,
  lessThanOrEqual: (a, b) => !a || b,
  greaterThan: (a, b) => a && !b,
  greaterThanOrEqual: (a, b) => a || !b,
};
registerInstanceWithMeta({
  typeclassName: "Ord",
  forType: "boolean",
  instanceName: "ordBoolean",
  derived: false,
});

export const ordDate: Ord<Date> = {
  equals: (a, b) => a.getTime() === b.getTime(),
  notEquals: (a, b) => a.getTime() !== b.getTime(),
  compare: (a, b) => {
    const ta = a.getTime();
    const tb = b.getTime();
    return ta < tb ? LT : ta > tb ? GT : EQ_ORD;
  },
  lessThan: (a, b) => a.getTime() < b.getTime(),
  lessThanOrEqual: (a, b) => a.getTime() <= b.getTime(),
  greaterThan: (a, b) => a.getTime() > b.getTime(),
  greaterThanOrEqual: (a, b) => a.getTime() >= b.getTime(),
};
registerInstanceWithMeta({
  typeclassName: "Ord",
  forType: "Date",
  instanceName: "ordDate",
  derived: false,
});

/**
 * Create an Ord instance from a compare function.
 */
export function makeOrd<A>(compare: (a: A, b: A) => Ordering): Ord<A> {
  return {
    equals: ((a, b) => compare(a, b) === EQ_ORD) as (a: A, b: A) => boolean & Op<"===">,
    notEquals: ((a, b) => compare(a, b) !== EQ_ORD) as (a: A, b: A) => boolean & Op<"!==">,
    compare,
    lessThan: ((a, b) => compare(a, b) === LT) as (a: A, b: A) => boolean & Op<"<">,
    lessThanOrEqual: ((a, b) => compare(a, b) !== GT) as (a: A, b: A) => boolean & Op<"<=">,
    greaterThan: ((a, b) => compare(a, b) === GT) as (a: A, b: A) => boolean & Op<">">,
    greaterThanOrEqual: ((a, b) => compare(a, b) !== LT) as (a: A, b: A) => boolean & Op<">=">,
  };
}

/**
 * Create an Ord instance by mapping to a comparable value.
 */
export function ordBy<A, B>(f: (a: A) => B, O: Ord<B>): Ord<A> {
  return {
    equals: ((a, b) => O.equals(f(a), f(b))) as (a: A, b: A) => boolean & Op<"===">,
    notEquals: ((a, b) => O.notEquals(f(a), f(b))) as (a: A, b: A) => boolean & Op<"!==">,
    compare: (a, b) => O.compare(f(a), f(b)),
    lessThan: ((a, b) => O.lessThan(f(a), f(b))) as (a: A, b: A) => boolean & Op<"<">,
    lessThanOrEqual: ((a, b) => O.lessThanOrEqual(f(a), f(b))) as (
      a: A,
      b: A
    ) => boolean & Op<"<=">,
    greaterThan: ((a, b) => O.greaterThan(f(a), f(b))) as (a: A, b: A) => boolean & Op<">">,
    greaterThanOrEqual: ((a, b) => O.greaterThanOrEqual(f(a), f(b))) as (
      a: A,
      b: A
    ) => boolean & Op<">=">,
  };
}

/**
 * Reverse an Ord instance.
 */
export function reverseOrd<A>(O: Ord<A>): Ord<A> {
  return {
    equals: O.equals,
    notEquals: O.notEquals,
    compare: (a, b) => O.compare(b, a),
    lessThan: O.greaterThan,
    lessThanOrEqual: O.greaterThanOrEqual,
    greaterThan: O.lessThan,
    greaterThanOrEqual: O.lessThanOrEqual,
  };
}

/**
 * Ord for arrays (lexicographic comparison).
 */
export function ordArray<A>(O: Ord<A>): Ord<A[]> {
  const E = eqArray({ equals: O.equals, notEquals: O.notEquals });
  return {
    equals: E.equals,
    notEquals: E.notEquals,
    compare: (xs, ys) => {
      const len = Math.min(xs.length, ys.length);
      for (let i = 0; i < len; i++) {
        const cmp = O.compare(xs[i], ys[i]);
        if (cmp !== EQ_ORD) return cmp;
      }
      return xs.length < ys.length ? LT : xs.length > ys.length ? GT : EQ_ORD;
    },
    lessThan: ((xs, ys) => ordArray(O).compare(xs, ys) === LT) as (
      a: A[],
      b: A[]
    ) => boolean & Op<"<">,
    lessThanOrEqual: ((xs, ys) => ordArray(O).compare(xs, ys) !== GT) as (
      a: A[],
      b: A[]
    ) => boolean & Op<"<=">,
    greaterThan: ((xs, ys) => ordArray(O).compare(xs, ys) === GT) as (
      a: A[],
      b: A[]
    ) => boolean & Op<">">,
    greaterThanOrEqual: ((xs, ys) => ordArray(O).compare(xs, ys) !== LT) as (
      a: A[],
      b: A[]
    ) => boolean & Op<">=">,
  };
}

// ============================================================================
// Semigroup — Haskell Semigroup, Scala cats Semigroup
// Types with an associative binary operation.
// ============================================================================

/**
 * Semigroup typeclass - types with an associative combine operation.
 *
 * Law:
 * - Associativity: `combine(combine(a, b), c) === combine(a, combine(b, c))`
 *
 * Operators dispatch via Op<> annotations:
 * - `a + b` → `Semigroup.combine(a, b)` (for additive semigroups)
 *
 * @typeclass
 */
export interface Semigroup<A> {
  combine(a: A, b: A): A & Op<"+">;
}
typeclass("Semigroup");

export const semigroupString: Semigroup<string> = {
  combine: (a, b) => a + b,
};
registerInstanceWithMeta({
  typeclassName: "Semigroup",
  forType: "string",
  instanceName: "semigroupString",
  derived: false,
});

export const semigroupNumber: Semigroup<number> = {
  combine: (a, b) => a + b,
};
registerInstanceWithMeta({
  typeclassName: "Semigroup",
  forType: "number",
  instanceName: "semigroupNumber",
  derived: false,
});

export const semigroupBigInt: Semigroup<bigint> = {
  combine: (a, b) => a + b,
};
registerInstanceWithMeta({
  typeclassName: "Semigroup",
  forType: "bigint",
  instanceName: "semigroupBigInt",
  derived: false,
});

/**
 * Semigroup for arrays (concatenation).
 */
export function semigroupArray<A>(): Semigroup<A[]> {
  return {
    combine: ((a, b) => [...a, ...b]) as (a: A[], b: A[]) => A[] & Op<"+">,
  };
}

// ============================================================================
// Monoid — Haskell Monoid, Scala cats Monoid
// Semigroup with an identity element.
// ============================================================================

/**
 * Monoid typeclass - Semigroup with an identity element.
 *
 * Laws (in addition to Semigroup laws):
 * - Left identity: `combine(empty(), a) === a`
 * - Right identity: `combine(a, empty()) === a`
 *
 * @typeclass
 */
export interface Monoid<A> extends Semigroup<A> {
  empty(): A;
}
typeclass("Monoid");

export const monoidString: Monoid<string> = {
  combine: (a, b) => a + b,
  empty: () => "",
};
registerInstanceWithMeta({
  typeclassName: "Monoid",
  forType: "string",
  instanceName: "monoidString",
  derived: false,
});

export const monoidNumber: Monoid<number> = {
  combine: (a, b) => a + b,
  empty: () => 0,
};
registerInstanceWithMeta({
  typeclassName: "Monoid",
  forType: "number",
  instanceName: "monoidNumber",
  derived: false,
});

export const monoidBigInt: Monoid<bigint> = {
  combine: (a, b) => a + b,
  empty: () => 0n,
};
registerInstanceWithMeta({
  typeclassName: "Monoid",
  forType: "bigint",
  instanceName: "monoidBigInt",
  derived: false,
});

/**
 * Monoid for arrays (concatenation with empty array).
 */
export function monoidArray<A>(): Monoid<A[]> {
  return {
    combine: ((a, b) => [...a, ...b]) as (a: A[], b: A[]) => A[] & Op<"+">,
    empty: () => [],
  };
}

// Re-export FlatMap typeclass (HKT-based, for let:/yield: macro)
export * from "./flatmap.js";

// Re-export ParCombine typeclass (for par:/yield: macro)
export * from "./par-combine.js";

// Re-export generic numeric operations
export * from "./numeric-ops.js";

// ============================================================================
// Bounded — Haskell Bounded, Rust: implicit via type, Scala: not built-in
// Types with a minimum and maximum value.
// ============================================================================

/**
 * Bounded typeclass - types with minimum and maximum values.
 * Use `registerStdInstances()` macro to enable summon<Bounded<T>>() resolution.
 */
export interface Bounded<A> {
  minBound(): A;
  maxBound(): A;
}

export const boundedNumber: Bounded<number> = {
  minBound: () => Number.MIN_SAFE_INTEGER,
  maxBound: () => Number.MAX_SAFE_INTEGER,
};
registerInstanceWithMeta({
  typeclassName: "Bounded",
  forType: "number",
  instanceName: "boundedNumber",
  derived: false,
});

export const boundedBigInt: Bounded<bigint> = {
  minBound: () => BigInt("-9007199254740991"),
  maxBound: () => BigInt("9007199254740991"),
};
registerInstanceWithMeta({
  typeclassName: "Bounded",
  forType: "bigint",
  instanceName: "boundedBigInt",
  derived: false,
});

export const boundedBoolean: Bounded<boolean> = {
  minBound: () => false,
  maxBound: () => true,
};
registerInstanceWithMeta({
  typeclassName: "Bounded",
  forType: "boolean",
  instanceName: "boundedBoolean",
  derived: false,
});

export const boundedString: Bounded<string> = {
  minBound: () => "",
  maxBound: () => "\uFFFF".repeat(256),
};
registerInstanceWithMeta({
  typeclassName: "Bounded",
  forType: "string",
  instanceName: "boundedString",
  derived: false,
});

// ============================================================================
// Enum — Haskell Enum, Rust: not built-in, Scala: Enumeration
// Types with successors and predecessors, convertible to/from integers.
// ============================================================================

/**
 * Enum typeclass - types with successors/predecessors, convertible to/from integers.
 * Use `registerStdInstances()` macro to enable summon<Enum<T>>() resolution.
 */
export interface Enum<A> {
  succ(a: A): A;
  pred(a: A): A;
  toEnum(n: number): A;
  fromEnum(a: A): number;
}

export const enumNumber: Enum<number> = {
  succ: (a) => a + 1,
  pred: (a) => a - 1,
  toEnum: (n) => n,
  fromEnum: (a) => a,
};
registerInstanceWithMeta({
  typeclassName: "Enum",
  forType: "number",
  instanceName: "enumNumber",
  derived: false,
});

export const enumBoolean: Enum<boolean> = {
  succ: (a) => !a,
  pred: (a) => !a,
  toEnum: (n) => n !== 0,
  fromEnum: (a) => (a ? 1 : 0),
};
registerInstanceWithMeta({
  typeclassName: "Enum",
  forType: "boolean",
  instanceName: "enumBoolean",
  derived: false,
});

export const enumString: Enum<string> = {
  succ: (a) =>
    a.length === 0 ? "a" : a.slice(0, -1) + String.fromCharCode(a.charCodeAt(a.length - 1) + 1),
  pred: (a) =>
    a.length === 0 ? "" : a.slice(0, -1) + String.fromCharCode(a.charCodeAt(a.length - 1) - 1),
  toEnum: (n) => String.fromCharCode(n),
  fromEnum: (a) => (a.length > 0 ? a.charCodeAt(0) : 0),
};
registerInstanceWithMeta({
  typeclassName: "Enum",
  forType: "string",
  instanceName: "enumString",
  derived: false,
});

// ============================================================================
// Numeric — Haskell Num, Scala Numeric, Kotlin: Number
// Types supporting basic arithmetic.
// ============================================================================

/**
 * Numeric typeclass - types supporting basic arithmetic operations.
 *
 * This is the Ring abstraction: add, sub, mul with identity elements.
 * Use `registerStdInstances()` macro to enable summon<Numeric<T>>() resolution.
 *
 * Operators dispatch via Op<> annotations:
 * - `a + b` → `Numeric.add(a, b)`
 * - `a - b` → `Numeric.sub(a, b)`
 * - `a * b` → `Numeric.mul(a, b)`
 *
 * @typeclass
 */
export interface Numeric<A> {
  add(a: A, b: A): A & Op<"+">;
  sub(a: A, b: A): A & Op<"-">;
  mul(a: A, b: A): A & Op<"*">;
  div(a: A, b: A): A & Op<"/">;
  pow(a: A, b: A): A & Op<"**">;
  negate(a: A): A;
  abs(a: A): A;
  signum(a: A): A;
  fromNumber(n: number): A;
  toNumber(a: A): number;
  zero(): A;
  one(): A;
}
typeclass("Numeric");

export const numericNumber: Numeric<number> = {
  add: (a, b) => a + b,
  sub: (a, b) => a - b,
  mul: (a, b) => a * b,
  div: (a, b) => a / b,
  pow: (a, b) => a ** b,
  negate: (a) => -a,
  abs: (a) => Math.abs(a),
  signum: (a) => Math.sign(a) as number,
  fromNumber: (n) => n,
  toNumber: (a) => a,
  zero: () => 0,
  one: () => 1,
};
registerInstanceWithMeta({
  typeclassName: "Numeric",
  forType: "number",
  instanceName: "numericNumber",
  derived: false,
});

export const numericBigInt: Numeric<bigint> = {
  add: (a, b) => a + b,
  sub: (a, b) => a - b,
  mul: (a, b) => a * b,
  div: (a, b) => a / b,
  pow: (a, b) => a ** b,
  negate: (a) => -a,
  abs: (a) => (a < 0n ? -a : a),
  signum: (a) => (a < 0n ? -1n : a > 0n ? 1n : 0n),
  fromNumber: (n) => BigInt(Math.trunc(n)),
  toNumber: (a) => Number(a),
  zero: () => 0n,
  one: () => 1n,
};
registerInstanceWithMeta({
  typeclassName: "Numeric",
  forType: "bigint",
  instanceName: "numericBigInt",
  derived: false,
});

// ============================================================================
// Integral — Haskell Integral
// Integer-like types supporting division and modulo.
// ============================================================================

/**
 * Integral typeclass - integer-like types supporting division and modulo.
 *
 * This is the Euclidean Ring abstraction.
 *
 * Operators dispatch via Op<> annotations (for integer types):
 * - `a / b` → `Integral.div(a, b)` (floor division)
 * - `a % b` → `Integral.mod(a, b)` (modulo)
 *
 * @typeclass
 */
export interface Integral<A> {
  div(a: A, b: A): A & Op<"/">;
  mod(a: A, b: A): A & Op<"%">;
  divMod(a: A, b: A): [A, A];
  quot(a: A, b: A): A;
  rem(a: A, b: A): A;
  toInteger(a: A): bigint;
}
typeclass("Integral");

export const integralNumber: Integral<number> = {
  div: (a, b) => Math.floor(a / b),
  mod: (a, b) => ((a % b) + b) % b,
  divMod: (a, b) => {
    const d = Math.floor(a / b);
    return [d, a - d * b];
  },
  quot: (a, b) => Math.trunc(a / b),
  rem: (a, b) => a % b,
  toInteger: (a) => BigInt(Math.trunc(a)),
};
registerInstanceWithMeta({
  typeclassName: "Integral",
  forType: "number",
  instanceName: "integralNumber",
  derived: false,
});

export const integralBigInt: Integral<bigint> = {
  div: (a, b) => {
    const d = a / b;
    return a < 0n !== b < 0n && a % b !== 0n ? d - 1n : d;
  },
  mod: (a, b) => ((a % b) + b) % b,
  divMod: (a, b) => {
    const d = integralBigInt.div(a, b);
    return [d, a - d * b];
  },
  quot: (a, b) => a / b,
  rem: (a, b) => a % b,
  toInteger: (a) => a,
};
registerInstanceWithMeta({
  typeclassName: "Integral",
  forType: "bigint",
  instanceName: "integralBigInt",
  derived: false,
});

// ============================================================================
// Fractional — Haskell Fractional
// Types supporting real division.
// ============================================================================

/**
 * Fractional typeclass - types supporting real division.
 *
 * This is the Field abstraction (for fractional/floating types).
 *
 * Operators dispatch via Op<> annotations (for fractional types):
 * - `a / b` → `Fractional.div(a, b)` (true division)
 *
 * @typeclass
 */
export interface Fractional<A> {
  div(a: A, b: A): A & Op<"/">;
  recip(a: A): A;
  fromRational(num: number, den: number): A;
}
typeclass("Fractional");

export const fractionalNumber: Fractional<number> = {
  div: (a, b) => a / b,
  recip: (a) => 1 / a,
  fromRational: (num, den) => num / den,
};
registerInstanceWithMeta({
  typeclassName: "Fractional",
  forType: "number",
  instanceName: "fractionalNumber",
  derived: false,
});

// ============================================================================
// Floating — Haskell Floating
// Types supporting transcendental functions.
// ============================================================================

export interface Floating<A> {
  pi(): A;
  exp(a: A): A;
  log(a: A): A;
  sqrt(a: A): A;
  pow(a: A, b: A): A;
  sin(a: A): A;
  cos(a: A): A;
  tan(a: A): A;
  asin(a: A): A;
  acos(a: A): A;
  atan(a: A): A;
  atan2(a: A, b: A): A;
  sinh(a: A): A;
  cosh(a: A): A;
  tanh(a: A): A;
}

export const floatingNumber: Floating<number> = {
  pi: () => Math.PI,
  exp: Math.exp,
  log: Math.log,
  sqrt: Math.sqrt,
  pow: Math.pow,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  atan2: Math.atan2,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
};
registerInstanceWithMeta({
  typeclassName: "Floating",
  forType: "number",
  instanceName: "floatingNumber",
  derived: false,
});

// ============================================================================
// Parseable — Haskell Read, Rust FromStr, Scala: not built-in
// Types that can be parsed from a string.
// ============================================================================

export type ParseResult<A> = { ok: true; value: A; rest: string } | { ok: false; error: string };

export interface Parseable<A> {
  parse(s: string): ParseResult<A>;
}

export const parseableNumber: Parseable<number> = {
  parse: (s) => {
    const trimmed = s.trim();
    const n = Number(trimmed);
    if (isNaN(n) && trimmed !== "NaN") {
      return { ok: false, error: `Cannot parse '${trimmed}' as number` };
    }
    return { ok: true, value: n, rest: "" };
  },
};

export const parseableBoolean: Parseable<boolean> = {
  parse: (s) => {
    const trimmed = s.trim().toLowerCase();
    if (trimmed === "true" || trimmed === "1" || trimmed === "yes") {
      return { ok: true, value: true, rest: "" };
    }
    if (trimmed === "false" || trimmed === "0" || trimmed === "no") {
      return { ok: true, value: false, rest: "" };
    }
    return { ok: false, error: `Cannot parse '${trimmed}' as boolean` };
  },
};

export const parseableBigInt: Parseable<bigint> = {
  parse: (s) => {
    const trimmed = s.trim();
    try {
      return { ok: true, value: BigInt(trimmed), rest: "" };
    } catch {
      return { ok: false, error: `Cannot parse '${trimmed}' as bigint` };
    }
  },
};

// ============================================================================
// Printable — Rust Display, Haskell Show (but human-readable focus)
// Human-readable string representation (vs Debug which is for developers).
// ============================================================================

export interface Printable<A> {
  display(a: A): string;
}

export const printableNumber: Printable<number> = {
  display: (a) => {
    if (Number.isInteger(a)) return String(a);
    return a.toLocaleString();
  },
};

export const printableString: Printable<string> = {
  display: (a) => a,
};

export const printableBoolean: Printable<boolean> = {
  display: (a) => (a ? "true" : "false"),
};

export const printableDate: Printable<Date> = {
  display: (a) => a.toISOString(),
};

// ============================================================================
// Coercible — Scala Conversion, Rust From/Into
// Safe type conversions.
// ============================================================================

export interface Coercible<A, B> {
  coerce(a: A): B;
}

export const numberToString: Coercible<number, string> = {
  coerce: (a) => String(a),
};

export const stringToNumber: Coercible<string, number> = {
  coerce: (a) => Number(a),
};

export const numberToBigInt: Coercible<number, bigint> = {
  coerce: (a) => BigInt(Math.trunc(a)),
};

export const bigIntToNumber: Coercible<bigint, number> = {
  coerce: (a) => Number(a),
};

export const numberToBoolean: Coercible<number, boolean> = {
  coerce: (a) => a !== 0,
};

export const booleanToNumber: Coercible<boolean, number> = {
  coerce: (a) => (a ? 1 : 0),
};

export const stringToBoolean: Coercible<string, boolean> = {
  coerce: (a) => a !== "" && a !== "0" && a.toLowerCase() !== "false",
};

export const dateToNumber: Coercible<Date, number> = {
  coerce: (a) => a.getTime(),
};

export const numberToDate: Coercible<number, Date> = {
  coerce: (a) => new Date(a),
};

// ============================================================================
// Defaultable — Rust Default, Haskell: not built-in, Scala: not built-in
// Types with a sensible default value.
// ============================================================================

export interface Defaultable<A> {
  defaultValue(): A;
}

export const defaultNumber: Defaultable<number> = {
  defaultValue: () => 0,
};

export const defaultString: Defaultable<string> = {
  defaultValue: () => "",
};

export const defaultBoolean: Defaultable<boolean> = {
  defaultValue: () => false,
};

export const defaultBigInt: Defaultable<bigint> = {
  defaultValue: () => 0n,
};

export function defaultArray<A>(): Defaultable<A[]> {
  return { defaultValue: () => [] };
}

export function defaultMap<K, V>(): Defaultable<Map<K, V>> {
  return { defaultValue: () => new Map() };
}

export function defaultSet<A>(): Defaultable<Set<A>> {
  return { defaultValue: () => new Set() };
}

export const defaultDate: Defaultable<Date> = {
  defaultValue: () => new Date(0),
};

// ============================================================================
// Copyable — Rust Clone/Copy, Scala: not built-in
// Types that can be deeply copied.
// ============================================================================

export interface Copyable<A> {
  copy(a: A): A;
}

export const copyableNumber: Copyable<number> = {
  copy: (a) => a,
};

export const copyableString: Copyable<string> = {
  copy: (a) => a,
};

export const copyableBoolean: Copyable<boolean> = {
  copy: (a) => a,
};

export const copyableBigInt: Copyable<bigint> = {
  copy: (a) => a,
};

export const copyableDate: Copyable<Date> = {
  copy: (a) => new Date(a.getTime()),
};

export function copyableArray<A>(inner: Copyable<A>): Copyable<A[]> {
  return { copy: (a) => a.map((x) => inner.copy(x)) };
}

export function copyableMap<K, V>(innerK: Copyable<K>, innerV: Copyable<V>): Copyable<Map<K, V>> {
  return {
    copy: (a) => {
      const m = new Map<K, V>();
      for (const [k, v] of a) m.set(innerK.copy(k), innerV.copy(v));
      return m;
    },
  };
}

export function copyableSet<A>(inner: Copyable<A>): Copyable<Set<A>> {
  return {
    copy: (a) => {
      const s = new Set<A>();
      for (const x of a) s.add(inner.copy(x));
      return s;
    },
  };
}

// ============================================================================
// Sized — Rust: implicit, Haskell: not built-in
// Types with a known size/length.
// ============================================================================

export interface Sized<A> {
  size(a: A): number;
  isEmpty(a: A): boolean;
}

export const sizedString: Sized<string> = {
  size: (a) => a.length,
  isEmpty: (a) => a.length === 0,
};

export function sizedArray<A>(): Sized<A[]> {
  return {
    size: (a) => a.length,
    isEmpty: (a) => a.length === 0,
  };
}

export function sizedMap<K, V>(): Sized<Map<K, V>> {
  return {
    size: (a) => a.size,
    isEmpty: (a) => a.size === 0,
  };
}

export function sizedSet<A>(): Sized<Set<A>> {
  return {
    size: (a) => a.size,
    isEmpty: (a) => a.size === 0,
  };
}

// ============================================================================
// Identifiable — Swift Identifiable
// Types with a unique identity.
// ============================================================================

export interface Identifiable<A, Id = string> {
  id(a: A): Id;
}

// ============================================================================
// Reducible — Haskell Foldable1, Scala ReducibleOps
// Non-empty foldable — guaranteed to have at least one element.
// ============================================================================

export interface Reducible<F> {
  reduceLeft<A>(fa: F, f: (acc: A, a: A) => A): A;
  reduceRight<A>(fa: F, f: (a: A, acc: A) => A): A;
}

// ============================================================================
// Zippable — Haskell: ZipList, Scala: LazyZip
// Types that support element-wise pairing.
// ============================================================================

export interface Zippable<F> {
  zip<A, B>(fa: F, fb: F): F;
  zipWith<A, B, C>(fa: F, fb: F, f: (a: A, b: B) => C): F;
}

// ============================================================================
// Splittable — Haskell: not built-in, Kotlin: partition/chunked
// Types that can be split/partitioned.
// ============================================================================

export interface Splittable<F> {
  splitAt<A>(fa: F, n: number): [F, F];
  partition<A>(fa: F, pred: (a: A) => boolean): [F, F];
  chunked<A>(fa: F, size: number): F[];
}

// ============================================================================
// Searchable — common across all languages
// Types that support searching/finding elements.
// ============================================================================

export interface Searchable<F> {
  find<A>(fa: F, pred: (a: A) => boolean): A | undefined;
  contains<A>(fa: F, elem: A): boolean;
  indexOf<A>(fa: F, elem: A): number;
}

// ============================================================================
// Group — Haskell Group, Scala cats-kernel Group
// Monoid with an inverse operation. Completes the algebraic chain:
// Semigroup → Monoid → Group
// ============================================================================

/**
 * Group typeclass - a Monoid with an inverse operation.
 *
 * Laws:
 * - All Monoid laws (associativity, identity)
 * - Left inverse: `combine(invert(a), a) === empty()`
 * - Right inverse: `combine(a, invert(a)) === empty()`
 *
 * @example
 * ```typescript
 * const additiveGroup: Group<number> = {
 *   empty: () => 0,
 *   combine: (a, b) => a + b,
 *   invert: (a) => -a,
 * };
 * ```
 *
 * @typeclass
 */
export interface Group<A> {
  /** The identity element */
  empty(): A;
  /** Associative binary operation */
  combine(a: A, b: A): A & Op<"+">;
  /** Inverse operation: combine(invert(a), a) === empty() */
  invert(a: A): A;
}
typeclass("Group");

/** Additive group for numbers (identity: 0, operation: +, inverse: negation) */
export const groupNumber: Group<number> = {
  empty: () => 0,
  combine: (a, b) => a + b,
  invert: (a) => -a,
};
registerInstanceWithMeta({
  typeclassName: "Group",
  forType: "number",
  instanceName: "groupNumber",
  derived: false,
});

/** Additive group for bigint */
export const groupBigInt: Group<bigint> = {
  empty: () => 0n,
  combine: (a, b) => a + b,
  invert: (a) => -a,
};
registerInstanceWithMeta({
  typeclassName: "Group",
  forType: "bigint",
  instanceName: "groupBigInt",
  derived: false,
});

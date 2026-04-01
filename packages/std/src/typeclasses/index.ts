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
 * - Auto-derivation via @derive
 * - Extension methods via the typeclass system
 * - Zero-cost specialization via inlining
 * - Operator overloading via @op JSDoc tags
 */

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
 * Operators dispatch via @op JSDoc tags:
 * - `a === b` → `Eq.equals(a, b)`
 * - `a !== b` → `Eq.notEquals(a, b)`
 *
 * @typeclass
 */
export interface Eq<A> {
  equals(a: A, b: A): boolean;
  notEquals(a: A, b: A): boolean;
}
typeclass("Eq");

export const eqNumber: Eq<number> = {
  equals: (a, b) => a === b,
  notEquals: (a, b) => a !== b,
};
registerInstanceWithMeta(
  {
    typeclassName: "Eq",
    forType: "number",
    instanceName: "eqNumber",
    derived: false,
  },
  eqNumber
);

export const eqBigInt: Eq<bigint> = {
  equals: (a, b) => a === b,
  notEquals: (a, b) => a !== b,
};
registerInstanceWithMeta(
  {
    typeclassName: "Eq",
    forType: "bigint",
    instanceName: "eqBigInt",
    derived: false,
  },
  eqBigInt
);

export const eqString: Eq<string> = {
  equals: (a, b) => a === b,
  notEquals: (a, b) => a !== b,
};
registerInstanceWithMeta(
  {
    typeclassName: "Eq",
    forType: "string",
    instanceName: "eqString",
    derived: false,
  },
  eqString
);

export const eqBoolean: Eq<boolean> = {
  equals: (a, b) => a === b,
  notEquals: (a, b) => a !== b,
};
registerInstanceWithMeta(
  {
    typeclassName: "Eq",
    forType: "boolean",
    instanceName: "eqBoolean",
    derived: false,
  },
  eqBoolean
);

export const eqDate: Eq<Date> = {
  equals: (a, b) => a.getTime() === b.getTime(),
  notEquals: (a, b) => a.getTime() !== b.getTime(),
};
registerInstanceWithMeta(
  {
    typeclassName: "Eq",
    forType: "Date",
    instanceName: "eqDate",
    derived: false,
  },
  eqDate
);

/**
 * Create an Eq instance from a custom equality function.
 */
export function makeEq<A>(eq: (a: A, b: A) => boolean): Eq<A> {
  return {
    equals: eq,
    notEquals: (a, b) => !eq(a, b),
  };
}

/**
 * Create an Eq instance by mapping to a comparable value.
 */
export function eqBy<A, B>(f: (a: A) => B, E: Eq<B> = eqStrict()): Eq<A> {
  return {
    equals: (a, b) => E.equals(f(a), f(b)),
    notEquals: (a, b) => E.notEquals(f(a), f(b)),
  };
}

/**
 * Eq using strict equality (===).
 */
export function eqStrict<A>(): Eq<A> {
  return {
    equals: (a, b) => a === b,
    notEquals: (a, b) => a !== b,
  };
}

/**
 * Eq for arrays (element-wise comparison).
 */
export function eqArray<A>(E: Eq<A>): Eq<A[]> {
  return {
    equals: (xs, ys) => {
      if (xs.length !== ys.length) return false;
      return xs.every((x, i) => E.equals(x, ys[i]));
    },
    notEquals: (xs, ys) => {
      if (xs.length !== ys.length) return true;
      return xs.some((x, i) => E.notEquals(x, ys[i]));
    },
  };
}

// ============================================================================
// Hash — Haskell Hashable, Rust Hash, Scala hashCode, Swift Hashable
// Types that can produce a hash value for use in hash-based collections.
// ============================================================================

/**
 * Hash typeclass - types that can be hashed for use in HashMap/HashSet.
 *
 * Law:
 * - Consistency with Eq: `Eq.equals(a, b) => Hash.hash(a) === Hash.hash(b)`
 *   (equal values MUST have equal hashes; unequal values MAY collide)
 *
 * @typeclass
 */
export interface Hash<A> {
  hash(a: A): number;
}
typeclass("Hash");

export const hashNumber: Hash<number> = {
  hash: (a) => a | 0,
};
registerInstanceWithMeta(
  {
    typeclassName: "Hash",
    forType: "number",
    instanceName: "hashNumber",
    derived: false,
  },
  hashNumber
);

export const hashString: Hash<string> = {
  hash: (a) => {
    let h = 5381;
    for (let i = 0; i < a.length; i++) h = ((h << 5) + h + a.charCodeAt(i)) | 0;
    return h;
  },
};
registerInstanceWithMeta(
  {
    typeclassName: "Hash",
    forType: "string",
    instanceName: "hashString",
    derived: false,
  },
  hashString
);

export const hashBoolean: Hash<boolean> = {
  hash: (a) => (a ? 1 : 0),
};
registerInstanceWithMeta(
  {
    typeclassName: "Hash",
    forType: "boolean",
    instanceName: "hashBoolean",
    derived: false,
  },
  hashBoolean
);

export const hashBigInt: Hash<bigint> = {
  hash: (a) => Number(a & 0x7fffffffn) | 0,
};
registerInstanceWithMeta(
  {
    typeclassName: "Hash",
    forType: "bigint",
    instanceName: "hashBigInt",
    derived: false,
  },
  hashBigInt
);

export const hashDate: Hash<Date> = {
  hash: (a) => a.getTime() | 0,
};
registerInstanceWithMeta(
  {
    typeclassName: "Hash",
    forType: "Date",
    instanceName: "hashDate",
    derived: false,
  },
  hashDate
);

/**
 * Create a Hash instance from a custom hash function.
 */
export function makeHash<A>(hash: (a: A) => number): Hash<A> {
  return { hash };
}

/**
 * Create a Hash instance by mapping to a hashable value.
 */
export function hashBy<A, B>(f: (a: A) => B, H: Hash<B>): Hash<A> {
  return { hash: (a) => H.hash(f(a)) };
}

/**
 * Hash for arrays (combines element hashes).
 */
export function hashArray<A>(H: Hash<A>): Hash<A[]> {
  return {
    hash: (arr) => {
      let h = 0x811c9dc5;
      for (let i = 0; i < arr.length; i++) {
        h ^= H.hash(arr[i]);
        h = (h * 0x01000193) | 0;
      }
      return h;
    },
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
 * Operators dispatch via @op JSDoc tags:
 * - `a < b`  → `Ord.lessThan(a, b)`
 * - `a <= b` → `Ord.lessThanOrEqual(a, b)`
 * - `a > b`  → `Ord.greaterThan(a, b)`
 * - `a >= b` → `Ord.greaterThanOrEqual(a, b)`
 *
 * @typeclass
 */
export interface Ord<A> extends Eq<A> {
  compare(a: A, b: A): Ordering;
  lessThan(a: A, b: A): boolean;
  lessThanOrEqual(a: A, b: A): boolean;
  greaterThan(a: A, b: A): boolean;
  greaterThanOrEqual(a: A, b: A): boolean;
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
registerInstanceWithMeta(
  {
    typeclassName: "Ord",
    forType: "number",
    instanceName: "ordNumber",
    derived: false,
  },
  ordNumber
);

export const ordBigInt: Ord<bigint> = {
  equals: (a, b) => a === b,
  notEquals: (a, b) => a !== b,
  compare: (a, b) => (a < b ? LT : a > b ? GT : EQ_ORD),
  lessThan: (a, b) => a < b,
  lessThanOrEqual: (a, b) => a <= b,
  greaterThan: (a, b) => a > b,
  greaterThanOrEqual: (a, b) => a >= b,
};
registerInstanceWithMeta(
  {
    typeclassName: "Ord",
    forType: "bigint",
    instanceName: "ordBigInt",
    derived: false,
  },
  ordBigInt
);

export const ordString: Ord<string> = {
  equals: (a, b) => a === b,
  notEquals: (a, b) => a !== b,
  compare: (a, b) => (a < b ? LT : a > b ? GT : EQ_ORD),
  lessThan: (a, b) => a < b,
  lessThanOrEqual: (a, b) => a <= b,
  greaterThan: (a, b) => a > b,
  greaterThanOrEqual: (a, b) => a >= b,
};
registerInstanceWithMeta(
  {
    typeclassName: "Ord",
    forType: "string",
    instanceName: "ordString",
    derived: false,
  },
  ordString
);

export const ordBoolean: Ord<boolean> = {
  equals: (a, b) => a === b,
  notEquals: (a, b) => a !== b,
  compare: (a, b) => (a === b ? EQ_ORD : a ? GT : LT),
  lessThan: (a, b) => !a && b,
  lessThanOrEqual: (a, b) => !a || b,
  greaterThan: (a, b) => a && !b,
  greaterThanOrEqual: (a, b) => a || !b,
};
registerInstanceWithMeta(
  {
    typeclassName: "Ord",
    forType: "boolean",
    instanceName: "ordBoolean",
    derived: false,
  },
  ordBoolean
);

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
registerInstanceWithMeta(
  {
    typeclassName: "Ord",
    forType: "Date",
    instanceName: "ordDate",
    derived: false,
  },
  ordDate
);

/**
 * Create an Ord instance from a compare function.
 */
export function makeOrd<A>(compare: (a: A, b: A) => Ordering): Ord<A> {
  return {
    equals: (a, b) => compare(a, b) === EQ_ORD,
    notEquals: (a, b) => compare(a, b) !== EQ_ORD,
    compare,
    lessThan: (a, b) => compare(a, b) === LT,
    lessThanOrEqual: (a, b) => compare(a, b) !== GT,
    greaterThan: (a, b) => compare(a, b) === GT,
    greaterThanOrEqual: (a, b) => compare(a, b) !== LT,
  };
}

/**
 * Create an Ord instance by mapping to a comparable value.
 */
export function ordBy<A, B>(f: (a: A) => B, O: Ord<B>): Ord<A> {
  return {
    equals: (a, b) => O.equals(f(a), f(b)),
    notEquals: (a, b) => O.notEquals(f(a), f(b)),
    compare: (a, b) => O.compare(f(a), f(b)),
    lessThan: (a, b) => O.lessThan(f(a), f(b)),
    lessThanOrEqual: (a, b) => O.lessThanOrEqual(f(a), f(b)),
    greaterThan: (a, b) => O.greaterThan(f(a), f(b)),
    greaterThanOrEqual: (a, b) => O.greaterThanOrEqual(f(a), f(b)),
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
    lessThan: (xs, ys) => ordArray(O).compare(xs, ys) === LT,
    lessThanOrEqual: (xs, ys) => ordArray(O).compare(xs, ys) !== GT,
    greaterThan: (xs, ys) => ordArray(O).compare(xs, ys) === GT,
    greaterThanOrEqual: (xs, ys) => ordArray(O).compare(xs, ys) !== LT,
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
 * Operators dispatch via @op JSDoc tags:
 * - `a + b` → `Semigroup.combine(a, b)` (for additive semigroups)
 *
 * @typeclass
 */
export interface Semigroup<A> {
  combine(a: A, b: A): A;
}
typeclass("Semigroup");

export const semigroupString: Semigroup<string> = {
  combine: (a, b) => a + b,
};
registerInstanceWithMeta(
  {
    typeclassName: "Semigroup",
    forType: "string",
    instanceName: "semigroupString",
    derived: false,
  },
  semigroupString
);

export const semigroupNumber: Semigroup<number> = {
  combine: (a, b) => a + b,
};
registerInstanceWithMeta(
  {
    typeclassName: "Semigroup",
    forType: "number",
    instanceName: "semigroupNumber",
    derived: false,
  },
  semigroupNumber
);

export const semigroupBigInt: Semigroup<bigint> = {
  combine: (a, b) => a + b,
};
registerInstanceWithMeta(
  {
    typeclassName: "Semigroup",
    forType: "bigint",
    instanceName: "semigroupBigInt",
    derived: false,
  },
  semigroupBigInt
);

/**
 * Semigroup for arrays (concatenation).
 */
export function semigroupArray<A>(): Semigroup<A[]> {
  return {
    combine: (a, b) => [...a, ...b],
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
registerInstanceWithMeta(
  {
    typeclassName: "Monoid",
    forType: "string",
    instanceName: "monoidString",
    derived: false,
  },
  monoidString
);

export const monoidNumber: Monoid<number> = {
  combine: (a, b) => a + b,
  empty: () => 0,
};
registerInstanceWithMeta(
  {
    typeclassName: "Monoid",
    forType: "number",
    instanceName: "monoidNumber",
    derived: false,
  },
  monoidNumber
);

export const monoidBigInt: Monoid<bigint> = {
  combine: (a, b) => a + b,
  empty: () => 0n,
};
registerInstanceWithMeta(
  {
    typeclassName: "Monoid",
    forType: "bigint",
    instanceName: "monoidBigInt",
    derived: false,
  },
  monoidBigInt
);

/**
 * Monoid for arrays (concatenation with empty array).
 */
export function monoidArray<A>(): Monoid<A[]> {
  return {
    combine: (a, b) => [...a, ...b],
    empty: () => [],
  };
}

// Re-export FlatMap typeclass (HKT-based, for let:/yield: macro)
export * from "./flatmap.js";

// Re-export ParCombine typeclass (for par:/yield: macro)
export * from "./par-combine.js";

// Re-export generic numeric operations
export * from "./numeric-ops.js";

// Re-export Destructure typeclass (for pattern matching, PEP-008)
export * from "./destructure.js";

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
registerInstanceWithMeta(
  {
    typeclassName: "Bounded",
    forType: "number",
    instanceName: "boundedNumber",
    derived: false,
  },
  boundedNumber
);

export const boundedBigInt: Bounded<bigint> = {
  minBound: () => BigInt("-9007199254740991"),
  maxBound: () => BigInt("9007199254740991"),
};
registerInstanceWithMeta(
  {
    typeclassName: "Bounded",
    forType: "bigint",
    instanceName: "boundedBigInt",
    derived: false,
  },
  boundedBigInt
);

export const boundedBoolean: Bounded<boolean> = {
  minBound: () => false,
  maxBound: () => true,
};
registerInstanceWithMeta(
  {
    typeclassName: "Bounded",
    forType: "boolean",
    instanceName: "boundedBoolean",
    derived: false,
  },
  boundedBoolean
);

export const boundedString: Bounded<string> = {
  minBound: () => "",
  maxBound: () => "\uFFFF".repeat(256),
};
registerInstanceWithMeta(
  {
    typeclassName: "Bounded",
    forType: "string",
    instanceName: "boundedString",
    derived: false,
  },
  boundedString
);

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
registerInstanceWithMeta(
  {
    typeclassName: "Enum",
    forType: "number",
    instanceName: "enumNumber",
    derived: false,
  },
  enumNumber
);

export const enumBoolean: Enum<boolean> = {
  succ: (a) => !a,
  pred: (a) => !a,
  toEnum: (n) => n !== 0,
  fromEnum: (a) => (a ? 1 : 0),
};
registerInstanceWithMeta(
  {
    typeclassName: "Enum",
    forType: "boolean",
    instanceName: "enumBoolean",
    derived: false,
  },
  enumBoolean
);

export const enumString: Enum<string> = {
  succ: (a) =>
    a.length === 0 ? "a" : a.slice(0, -1) + String.fromCharCode(a.charCodeAt(a.length - 1) + 1),
  pred: (a) =>
    a.length === 0 ? "" : a.slice(0, -1) + String.fromCharCode(a.charCodeAt(a.length - 1) - 1),
  toEnum: (n) => String.fromCharCode(n),
  fromEnum: (a) => (a.length > 0 ? a.charCodeAt(0) : 0),
};
registerInstanceWithMeta(
  {
    typeclassName: "Enum",
    forType: "string",
    instanceName: "enumString",
    derived: false,
  },
  enumString
);

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
 * Operators dispatch via @op JSDoc tags:
 * - `a + b` → `Numeric.add(a, b)`
 * - `a - b` → `Numeric.sub(a, b)`
 * - `a * b` → `Numeric.mul(a, b)`
 *
 * @typeclass
 */
export interface Numeric<A> {
  add(a: A, b: A): A;
  sub(a: A, b: A): A;
  mul(a: A, b: A): A;
  div(a: A, b: A): A;
  pow(a: A, b: A): A;
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
registerInstanceWithMeta(
  {
    typeclassName: "Numeric",
    forType: "number",
    instanceName: "numericNumber",
    derived: false,
  },
  numericNumber
);

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
registerInstanceWithMeta(
  {
    typeclassName: "Numeric",
    forType: "bigint",
    instanceName: "numericBigInt",
    derived: false,
  },
  numericBigInt
);

// ============================================================================
// Integral — Haskell Integral
// Integer-like types supporting division and modulo.
// ============================================================================

/**
 * Integral typeclass - integer-like types supporting division and modulo.
 *
 * This is the Euclidean Ring abstraction.
 *
 * Operators dispatch via @op JSDoc tags (for integer types):
 * - `a / b` → `Integral.div(a, b)` (floor division)
 * - `a % b` → `Integral.mod(a, b)` (modulo)
 *
 * @typeclass
 */
export interface Integral<A> {
  div(a: A, b: A): A;
  mod(a: A, b: A): A;
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
registerInstanceWithMeta(
  {
    typeclassName: "Integral",
    forType: "number",
    instanceName: "integralNumber",
    derived: false,
  },
  integralNumber
);

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
registerInstanceWithMeta(
  {
    typeclassName: "Integral",
    forType: "bigint",
    instanceName: "integralBigInt",
    derived: false,
  },
  integralBigInt
);

// ============================================================================
// Fractional — Haskell Fractional
// Types supporting real division.
// ============================================================================

/**
 * Fractional typeclass - types supporting real division.
 *
 * This is the Field abstraction (for fractional/floating types).
 *
 * Operators dispatch via @op JSDoc tags (for fractional types):
 * - `a / b` → `Fractional.div(a, b)` (true division)
 *
 * @typeclass
 */
export interface Fractional<A> {
  div(a: A, b: A): A;
  recip(a: A): A;
  fromRational(num: number, den: number): A;
}
typeclass("Fractional");

export const fractionalNumber: Fractional<number> = {
  div: (a, b) => a / b,
  recip: (a) => 1 / a,
  fromRational: (num, den) => num / den,
};
registerInstanceWithMeta(
  {
    typeclassName: "Fractional",
    forType: "number",
    instanceName: "fractionalNumber",
    derived: false,
  },
  fractionalNumber
);

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
registerInstanceWithMeta(
  {
    typeclassName: "Floating",
    forType: "number",
    instanceName: "floatingNumber",
    derived: false,
  },
  floatingNumber
);

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
  combine(a: A, b: A): A;
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
registerInstanceWithMeta(
  {
    typeclassName: "Group",
    forType: "number",
    instanceName: "groupNumber",
    derived: false,
  },
  groupNumber
);

/** Additive group for bigint */
export const groupBigInt: Group<bigint> = {
  empty: () => 0n,
  combine: (a, b) => a + b,
  invert: (a) => -a,
};
registerInstanceWithMeta(
  {
    typeclassName: "Group",
    forType: "bigint",
    instanceName: "groupBigInt",
    derived: false,
  },
  groupBigInt
);

// ============================================================================
// Clone — Rust Clone, Haskell: not built-in (pure values), Scala: not built-in
// Types that can produce a deep copy of themselves.
// ============================================================================

/**
 * Clone typeclass - deep copy of a value.
 *
 * Law:
 * - Identity: `Eq.equals(clone(a), a) === true` (when Eq is available)
 * - Independence: mutating `clone(a)` does not affect `a`
 *
 * @typeclass
 */
export interface Clone<A> {
  clone(a: A): A;
}
typeclass("Clone");

export const cloneNumber: Clone<number> = {
  clone: (a) => a,
};
registerInstanceWithMeta(
  {
    typeclassName: "Clone",
    forType: "number",
    instanceName: "cloneNumber",
    derived: false,
  },
  cloneNumber
);

export const cloneString: Clone<string> = {
  clone: (a) => a,
};
registerInstanceWithMeta(
  {
    typeclassName: "Clone",
    forType: "string",
    instanceName: "cloneString",
    derived: false,
  },
  cloneString
);

export const cloneBoolean: Clone<boolean> = {
  clone: (a) => a,
};
registerInstanceWithMeta(
  {
    typeclassName: "Clone",
    forType: "boolean",
    instanceName: "cloneBoolean",
    derived: false,
  },
  cloneBoolean
);

export const cloneBigInt: Clone<bigint> = {
  clone: (a) => a,
};
registerInstanceWithMeta(
  {
    typeclassName: "Clone",
    forType: "bigint",
    instanceName: "cloneBigInt",
    derived: false,
  },
  cloneBigInt
);

export const cloneDate: Clone<Date> = {
  clone: (a) => new Date(a.getTime()),
};
registerInstanceWithMeta(
  {
    typeclassName: "Clone",
    forType: "Date",
    instanceName: "cloneDate",
    derived: false,
  },
  cloneDate
);

/**
 * Create a Clone instance from a custom clone function.
 */
export function makeClone<A>(cloneFn: (a: A) => A): Clone<A> {
  return { clone: cloneFn };
}

/**
 * Clone for arrays (element-wise deep clone).
 */
export function cloneArray<A>(C: Clone<A>): Clone<A[]> {
  return { clone: (arr) => arr.map((x) => C.clone(x)) };
}

// ============================================================================
// Debug — Rust Debug, Haskell Show (developer-facing), Swift debugDescription
// Developer-facing string representation for debugging/logging.
// ============================================================================

/**
 * Debug typeclass - developer-facing string representation.
 *
 * Unlike Printable (human-readable), Debug produces unambiguous output
 * suitable for logging and debugging. Strings are quoted, types are
 * annotated, etc.
 *
 * @typeclass
 */
export interface Debug<A> {
  debug(a: A): string;
}
typeclass("Debug");

export const debugNumber: Debug<number> = {
  debug: (a) => String(a),
};
registerInstanceWithMeta(
  {
    typeclassName: "Debug",
    forType: "number",
    instanceName: "debugNumber",
    derived: false,
  },
  debugNumber
);

export const debugString: Debug<string> = {
  debug: (a) => JSON.stringify(a),
};
registerInstanceWithMeta(
  {
    typeclassName: "Debug",
    forType: "string",
    instanceName: "debugString",
    derived: false,
  },
  debugString
);

export const debugBoolean: Debug<boolean> = {
  debug: (a) => String(a),
};
registerInstanceWithMeta(
  {
    typeclassName: "Debug",
    forType: "boolean",
    instanceName: "debugBoolean",
    derived: false,
  },
  debugBoolean
);

export const debugBigInt: Debug<bigint> = {
  debug: (a) => `${a}n`,
};
registerInstanceWithMeta(
  {
    typeclassName: "Debug",
    forType: "bigint",
    instanceName: "debugBigInt",
    derived: false,
  },
  debugBigInt
);

export const debugDate: Debug<Date> = {
  debug: (a) => `Date(${JSON.stringify(a.toISOString())})`,
};
registerInstanceWithMeta(
  {
    typeclassName: "Debug",
    forType: "Date",
    instanceName: "debugDate",
    derived: false,
  },
  debugDate
);

/**
 * Create a Debug instance from a custom debug function.
 */
export function makeDebug<A>(debugFn: (a: A) => string): Debug<A> {
  return { debug: debugFn };
}

/**
 * Debug for arrays.
 */
export function debugArray<A>(D: Debug<A>): Debug<A[]> {
  return { debug: (arr) => `[${arr.map((x) => D.debug(x)).join(", ")}]` };
}

// ============================================================================
// Json — Scala circe Codec, Rust serde, Haskell aeson ToJSON/FromJSON
// Types that can be serialized to/from JSON.
// ============================================================================

/**
 * Json typeclass - bidirectional JSON serialization.
 *
 * Laws:
 * - Round-trip: `fromJson(toJson(a))` deeply equals `a`
 *
 * @typeclass
 */
export interface Json<A> {
  toJson(a: A): unknown;
  fromJson(json: unknown): A;
}
typeclass("Json");

export const jsonNumber: Json<number> = {
  toJson: (a) => a,
  fromJson: (json) => json as number,
};
registerInstanceWithMeta(
  {
    typeclassName: "Json",
    forType: "number",
    instanceName: "jsonNumber",
    derived: false,
  },
  jsonNumber
);

export const jsonString: Json<string> = {
  toJson: (a) => a,
  fromJson: (json) => json as string,
};
registerInstanceWithMeta(
  {
    typeclassName: "Json",
    forType: "string",
    instanceName: "jsonString",
    derived: false,
  },
  jsonString
);

export const jsonBoolean: Json<boolean> = {
  toJson: (a) => a,
  fromJson: (json) => json as boolean,
};
registerInstanceWithMeta(
  {
    typeclassName: "Json",
    forType: "boolean",
    instanceName: "jsonBoolean",
    derived: false,
  },
  jsonBoolean
);

export const jsonBigInt: Json<bigint> = {
  toJson: (a) => String(a),
  fromJson: (json) => BigInt(json as string),
};
registerInstanceWithMeta(
  {
    typeclassName: "Json",
    forType: "bigint",
    instanceName: "jsonBigInt",
    derived: false,
  },
  jsonBigInt
);

export const jsonDate: Json<Date> = {
  toJson: (a) => a.toISOString(),
  fromJson: (json) => new Date(json as string),
};
registerInstanceWithMeta(
  {
    typeclassName: "Json",
    forType: "Date",
    instanceName: "jsonDate",
    derived: false,
  },
  jsonDate
);

/**
 * Create a Json instance from custom serialization functions.
 */
export function makeJson<A>(toJson: (a: A) => unknown, fromJson: (json: unknown) => A): Json<A> {
  return { toJson, fromJson };
}

/**
 * Json for arrays (element-wise serialization).
 */
export function jsonArray<A>(J: Json<A>): Json<A[]> {
  return {
    toJson: (arr) => arr.map((x) => J.toJson(x)),
    fromJson: (json) => (json as unknown[]).map((x) => J.fromJson(x)),
  };
}

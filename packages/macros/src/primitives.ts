/**
 * Primitive Typeclass Instances
 *
 * This module provides typeclass instances for all primitive types.
 * Import this module to enable auto-derivation for product/sum types.
 *
 * ## Usage
 *
 * ```typescript
 * import "typesugar/primitives";  // Or import specific instances
 *
 * @derive(Show, Eq, Ord, Hash)
 * interface Point {
 *   x: number;
 *   y: number;
 * }
 * // Works because showNumber, eqNumber, etc. are available
 * ```
 *
 * ## Provided Instances
 *
 * For each typeclass, instances are provided for:
 * - number, string, boolean
 * - bigint (where applicable)
 * - Arrays (generic, requires element instance)
 *
 * @packageDocumentation
 */

// ============================================================================
// Show Instances
// ============================================================================

/** @impl("Show<number>") */
export const showNumber = {
  show: (a: number): string => String(a),
};

/** @impl("Show<string>") */
export const showString = {
  show: (a: string): string => `"${a}"`,
};

/** @impl("Show<boolean>") */
export const showBoolean = {
  show: (a: boolean): string => (a ? "true" : "false"),
};

/** @impl("Show<bigint>") */
export const showBigint = {
  show: (a: bigint): string => `${a}n`,
};

/** @impl("Show<null>") */
export const showNull = {
  show: (_a: null): string => "null",
};

/** @impl("Show<undefined>") */
export const showUndefined = {
  show: (_a: undefined): string => "undefined",
};

// Generic array Show - requires element Show instance
export function showArray<A>(elementShow: { show: (a: A) => string }) {
  return {
    show: (arr: A[]): string => `[${arr.map((x) => elementShow.show(x)).join(", ")}]`,
  };
}

// ============================================================================
// Eq Instances
// ============================================================================

/** @impl("Eq<number>") */
export const eqNumber = {
  equals: (a: number, b: number): boolean => a === b,
  notEquals: (a: number, b: number): boolean => a !== b,
};

/** @impl("Eq<string>") */
export const eqString = {
  equals: (a: string, b: string): boolean => a === b,
  notEquals: (a: string, b: string): boolean => a !== b,
};

/** @impl("Eq<boolean>") */
export const eqBoolean = {
  equals: (a: boolean, b: boolean): boolean => a === b,
  notEquals: (a: boolean, b: boolean): boolean => a !== b,
};

/** @impl("Eq<bigint>") */
export const eqBigint = {
  equals: (a: bigint, b: bigint): boolean => a === b,
  notEquals: (a: bigint, b: bigint): boolean => a !== b,
};

/** @impl("Eq<null>") */
export const eqNull = {
  equals: (_a: null, _b: null): boolean => true,
  notEquals: (_a: null, _b: null): boolean => false,
};

/** @impl("Eq<undefined>") */
export const eqUndefined = {
  equals: (_a: undefined, _b: undefined): boolean => true,
  notEquals: (_a: undefined, _b: undefined): boolean => false,
};

// Generic array Eq - structural equality
export function eqArray<A>(elementEq: { equals: (a: A, b: A) => boolean }) {
  return {
    equals: (a: A[], b: A[]): boolean => {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (!elementEq.equals(a[i], b[i])) return false;
      }
      return true;
    },
    notEquals: (a: A[], b: A[]): boolean => {
      if (a.length !== b.length) return true;
      for (let i = 0; i < a.length; i++) {
        if (!elementEq.equals(a[i], b[i])) return true;
      }
      return false;
    },
  };
}

// ============================================================================
// Ord Instances
// ============================================================================

/** @impl("Ord<number>") */
export const ordNumber = {
  compare: (a: number, b: number): number => (a < b ? -1 : a > b ? 1 : 0),
};

/** @impl("Ord<string>") */
export const ordString = {
  compare: (a: string, b: string): number => a.localeCompare(b),
};

/** @impl("Ord<boolean>") */
export const ordBoolean = {
  compare: (a: boolean, b: boolean): number => (a === b ? 0 : a ? 1 : -1), // false < true
};

/** @impl("Ord<bigint>") */
export const ordBigint = {
  compare: (a: bigint, b: bigint): number => (a < b ? -1 : a > b ? 1 : 0),
};

// Lexicographic array ordering
export function ordArray<A>(elementOrd: { compare: (a: A, b: A) => number }) {
  return {
    compare: (a: A[], b: A[]): number => {
      const minLen = Math.min(a.length, b.length);
      for (let i = 0; i < minLen; i++) {
        const c = elementOrd.compare(a[i], b[i]);
        if (c !== 0) return c;
      }
      return a.length - b.length;
    },
  };
}

// ============================================================================
// Hash Instances
// ============================================================================

// Simple hash functions (not cryptographic, just for hash tables)

/** @impl("Hash<number>") */
export const hashNumber = {
  hash: (a: number): number => {
    // Handle special cases
    if (Number.isNaN(a)) return 0x7fc00000;
    if (!Number.isFinite(a)) return a > 0 ? 0x7f800000 : 0xff800000;
    // Use bit manipulation for integers, string hash for floats
    if (Number.isInteger(a) && Math.abs(a) < 2 ** 31) {
      return a | 0;
    }
    return hashString.hash(String(a));
  },
};

/** @impl("Hash<string>") */
export const hashString = {
  hash: (a: string): number => {
    // djb2 hash
    let hash = 5381;
    for (let i = 0; i < a.length; i++) {
      hash = ((hash << 5) + hash) ^ a.charCodeAt(i);
    }
    return hash >>> 0; // Ensure unsigned
  },
};

/** @impl("Hash<boolean>") */
export const hashBoolean = {
  hash: (a: boolean): number => (a ? 1 : 0),
};

/** @impl("Hash<bigint>") */
export const hashBigint = {
  hash: (a: bigint): number => {
    // Reduce to 32-bit range
    const str = a.toString();
    return hashString.hash(str);
  },
};

/** @impl("Hash<null>") */
export const hashNull = {
  hash: (_a: null): number => 0,
};

/** @impl("Hash<undefined>") */
export const hashUndefined = {
  hash: (_a: undefined): number => 1,
};

export function hashArray<A>(elementHash: { hash: (a: A) => number }) {
  return {
    hash: (arr: A[]): number => {
      let hash = arr.length;
      for (const x of arr) {
        hash = ((hash << 5) + hash) ^ elementHash.hash(x);
      }
      return hash >>> 0;
    },
  };
}

// ============================================================================
// Semigroup Instances (combine operation)
// ============================================================================

/** @impl("Semigroup<number>") */
export const semigroupNumber = {
  combine: (a: number, b: number): number => a + b, // Addition
};

export const semigroupNumberProduct = {
  combine: (a: number, b: number): number => a * b, // Multiplication
};

/** @impl("Semigroup<string>") */
export const semigroupString = {
  combine: (a: string, b: string): string => a + b, // Concatenation
};

/** @impl("Semigroup<boolean>") */
export const semigroupBoolean = {
  combine: (a: boolean, b: boolean): boolean => a && b, // Logical AND
};

export const semigroupBooleanAny = {
  combine: (a: boolean, b: boolean): boolean => a || b, // Logical OR
};

export function semigroupArray<A>() {
  return {
    combine: (a: A[], b: A[]): A[] => [...a, ...b],
  };
}

// ============================================================================
// Monoid Instances (semigroup + identity)
// ============================================================================

/** @impl("Monoid<number>") */
export const monoidNumber = {
  empty: (): number => 0,
  combine: (a: number, b: number): number => a + b,
};

export const monoidNumberProduct = {
  empty: (): number => 1,
  combine: (a: number, b: number): number => a * b,
};

/** @impl("Monoid<string>") */
export const monoidString = {
  empty: (): string => "",
  combine: (a: string, b: string): string => a + b,
};

/** @impl("Monoid<boolean>") */
export const monoidBoolean = {
  empty: (): boolean => true,
  combine: (a: boolean, b: boolean): boolean => a && b,
};

export const monoidBooleanAny = {
  empty: (): boolean => false,
  combine: (a: boolean, b: boolean): boolean => a || b,
};

export function monoidArray<A>() {
  return {
    empty: (): A[] => [],
    combine: (a: A[], b: A[]): A[] => [...a, ...b],
  };
}

// ============================================================================
// Convenience: all instances grouped by typeclass
// ============================================================================

export const Show = {
  number: showNumber,
  string: showString,
  boolean: showBoolean,
  bigint: showBigint,
  null: showNull,
  undefined: showUndefined,
  array: showArray,
};

export const Eq = {
  number: eqNumber,
  string: eqString,
  boolean: eqBoolean,
  bigint: eqBigint,
  null: eqNull,
  undefined: eqUndefined,
  array: eqArray,
};

export const Ord = {
  number: ordNumber,
  string: ordString,
  boolean: ordBoolean,
  bigint: ordBigint,
  array: ordArray,
};

export const Hash = {
  number: hashNumber,
  string: hashString,
  boolean: hashBoolean,
  bigint: hashBigint,
  null: hashNull,
  undefined: hashUndefined,
  array: hashArray,
};

export const Semigroup = {
  number: semigroupNumber,
  numberProduct: semigroupNumberProduct,
  string: semigroupString,
  boolean: semigroupBoolean,
  booleanAny: semigroupBooleanAny,
  array: semigroupArray,
};

export const Monoid = {
  number: monoidNumber,
  numberProduct: monoidNumberProduct,
  string: monoidString,
  boolean: monoidBoolean,
  booleanAny: monoidBooleanAny,
  array: monoidArray,
};

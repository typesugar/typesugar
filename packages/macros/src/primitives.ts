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

import { instanceRegistry } from "./typeclass.js";

// ============================================================================
// Show Instances
// ============================================================================

export const showNumber = {
  show: (a: number): string => String(a),
};

export const showString = {
  show: (a: string): string => `"${a}"`,
};

export const showBoolean = {
  show: (a: boolean): string => (a ? "true" : "false"),
};

export const showBigint = {
  show: (a: bigint): string => `${a}n`,
};

export const showNull = {
  show: (_a: null): string => "null",
};

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

export const eqNumber = {
  eq: (a: number, b: number): boolean => a === b,
};

export const eqString = {
  eq: (a: string, b: string): boolean => a === b,
};

export const eqBoolean = {
  eq: (a: boolean, b: boolean): boolean => a === b,
};

export const eqBigint = {
  eq: (a: bigint, b: bigint): boolean => a === b,
};

export const eqNull = {
  eq: (_a: null, _b: null): boolean => true,
};

export const eqUndefined = {
  eq: (_a: undefined, _b: undefined): boolean => true,
};

// Generic array Eq - structural equality
export function eqArray<A>(elementEq: { eq: (a: A, b: A) => boolean }) {
  return {
    eq: (a: A[], b: A[]): boolean => {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (!elementEq.eq(a[i], b[i])) return false;
      }
      return true;
    },
  };
}

// ============================================================================
// Ord Instances
// ============================================================================

export const ordNumber = {
  compare: (a: number, b: number): number => (a < b ? -1 : a > b ? 1 : 0),
};

export const ordString = {
  compare: (a: string, b: string): number => a.localeCompare(b),
};

export const ordBoolean = {
  compare: (a: boolean, b: boolean): number => (a === b ? 0 : a ? 1 : -1), // false < true
};

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

export const hashBoolean = {
  hash: (a: boolean): number => (a ? 1 : 0),
};

export const hashBigint = {
  hash: (a: bigint): number => {
    // Reduce to 32-bit range
    const str = a.toString();
    return hashString.hash(str);
  },
};

export const hashNull = {
  hash: (_a: null): number => 0,
};

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

export const semigroupNumber = {
  combine: (a: number, b: number): number => a + b, // Addition
};

export const semigroupNumberProduct = {
  combine: (a: number, b: number): number => a * b, // Multiplication
};

export const semigroupString = {
  combine: (a: string, b: string): string => a + b, // Concatenation
};

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

export const monoidNumber = {
  empty: (): number => 0,
  combine: (a: number, b: number): number => a + b,
};

export const monoidNumberProduct = {
  empty: (): number => 1,
  combine: (a: number, b: number): number => a * b,
};

export const monoidString = {
  empty: (): string => "",
  combine: (a: string, b: string): string => a + b,
};

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
// Register all instances in the compile-time registry
// ============================================================================

const primitiveInstances = [
  // Show
  {
    typeclassName: "Show",
    forType: "number",
    instanceName: "showNumber",
    derived: false,
  },
  {
    typeclassName: "Show",
    forType: "string",
    instanceName: "showString",
    derived: false,
  },
  {
    typeclassName: "Show",
    forType: "boolean",
    instanceName: "showBoolean",
    derived: false,
  },
  {
    typeclassName: "Show",
    forType: "bigint",
    instanceName: "showBigint",
    derived: false,
  },
  {
    typeclassName: "Show",
    forType: "null",
    instanceName: "showNull",
    derived: false,
  },
  {
    typeclassName: "Show",
    forType: "undefined",
    instanceName: "showUndefined",
    derived: false,
  },

  // Eq
  {
    typeclassName: "Eq",
    forType: "number",
    instanceName: "eqNumber",
    derived: false,
  },
  {
    typeclassName: "Eq",
    forType: "string",
    instanceName: "eqString",
    derived: false,
  },
  {
    typeclassName: "Eq",
    forType: "boolean",
    instanceName: "eqBoolean",
    derived: false,
  },
  {
    typeclassName: "Eq",
    forType: "bigint",
    instanceName: "eqBigint",
    derived: false,
  },
  {
    typeclassName: "Eq",
    forType: "null",
    instanceName: "eqNull",
    derived: false,
  },
  {
    typeclassName: "Eq",
    forType: "undefined",
    instanceName: "eqUndefined",
    derived: false,
  },

  // Ord
  {
    typeclassName: "Ord",
    forType: "number",
    instanceName: "ordNumber",
    derived: false,
  },
  {
    typeclassName: "Ord",
    forType: "string",
    instanceName: "ordString",
    derived: false,
  },
  {
    typeclassName: "Ord",
    forType: "boolean",
    instanceName: "ordBoolean",
    derived: false,
  },
  {
    typeclassName: "Ord",
    forType: "bigint",
    instanceName: "ordBigint",
    derived: false,
  },

  // Hash
  {
    typeclassName: "Hash",
    forType: "number",
    instanceName: "hashNumber",
    derived: false,
  },
  {
    typeclassName: "Hash",
    forType: "string",
    instanceName: "hashString",
    derived: false,
  },
  {
    typeclassName: "Hash",
    forType: "boolean",
    instanceName: "hashBoolean",
    derived: false,
  },
  {
    typeclassName: "Hash",
    forType: "bigint",
    instanceName: "hashBigint",
    derived: false,
  },
  {
    typeclassName: "Hash",
    forType: "null",
    instanceName: "hashNull",
    derived: false,
  },
  {
    typeclassName: "Hash",
    forType: "undefined",
    instanceName: "hashUndefined",
    derived: false,
  },

  // Semigroup
  {
    typeclassName: "Semigroup",
    forType: "number",
    instanceName: "semigroupNumber",
    derived: false,
  },
  {
    typeclassName: "Semigroup",
    forType: "string",
    instanceName: "semigroupString",
    derived: false,
  },
  {
    typeclassName: "Semigroup",
    forType: "boolean",
    instanceName: "semigroupBoolean",
    derived: false,
  },

  // Monoid
  {
    typeclassName: "Monoid",
    forType: "number",
    instanceName: "monoidNumber",
    derived: false,
  },
  {
    typeclassName: "Monoid",
    forType: "string",
    instanceName: "monoidString",
    derived: false,
  },
  {
    typeclassName: "Monoid",
    forType: "boolean",
    instanceName: "monoidBoolean",
    derived: false,
  },
];

// Register on module load
for (const inst of primitiveInstances) {
  instanceRegistry.push(inst);
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

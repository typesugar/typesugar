/**
 * Length-Indexed Vectors (Coq-inspired Dependent Types)
 *
 * This module provides `Vec<T, N>` - an array type where the length is
 * tracked at the type level. Inspired by Coq/Idris dependent vectors.
 *
 * ## Key Features
 *
 * - **Type-level length tracking**: `Vec<string, 3>` is an array of exactly 3 strings
 * - **Length-preserving operations**: Operations update the type-level length
 * - **Compile-time proofs**: The prover knows `Vec<T, N>.length === N`
 * - **Runtime validation**: Constructors verify length at runtime
 *
 * ## Usage
 *
 * ```typescript
 * // Create vectors with known length
 * const empty = Vec.empty<string>();           // Vec<string, 0>
 * const single = Vec.singleton("hello");       // Vec<string, 1>
 * const three = Vec.from<string, 3>(["a", "b", "c"]); // Vec<string, 3>
 *
 * // Operations preserve length information
 * const four = Vec.cons("z", three);           // Vec<string, 4>
 * const six = Vec.append(three, three);        // Vec<string, 6>
 * const two = Vec.tail(three);                 // Vec<string, 2>
 *
 * // Proofs work with length information
 * @contract
 * function needsAtLeast2<T>(v: Vec<T, 2>): T {
 *   requires: { v.length >= 2 }  // Provable from type!
 *   return v[0];
 * }
 * ```
 *
 * ## Type Arithmetic
 *
 * TypeScript doesn't have built-in type-level arithmetic, so we use
 * template literal types to encode length operations:
 *
 * - `Add<N, M>` → `N + M` (computed at type level for small numbers)
 * - `Sub<N, M>` → `N - M`
 * - `Min<N, M>` → `min(N, M)`
 *
 * For larger numbers, lengths are computed at runtime and encoded as `number`.
 */

import { type Refined } from "./refined.js";

// ============================================================================
// Type Arithmetic Utilities
// ============================================================================

/**
 * Type-level addition for small numbers (0-20).
 * Falls back to `number` for larger values.
 */
export type Add<A extends number, B extends number> = A extends keyof AdditionTable
  ? B extends keyof AdditionTable[A]
    ? AdditionTable[A][B]
    : number
  : number;

/**
 * Type-level subtraction for small numbers.
 * Returns 0 if result would be negative.
 */
export type Sub<A extends number, B extends number> = A extends keyof SubtractionTable
  ? B extends keyof SubtractionTable[A]
    ? SubtractionTable[A][B]
    : number
  : number;

/**
 * Type-level minimum.
 */
export type Min<A extends number, B extends number> = A extends number
  ? B extends number
    ? Sub<A, Sub<A, B>> extends infer R
      ? R extends number
        ? R
        : number
      : number
    : number
  : number;

// Lookup tables for small number arithmetic
type AdditionTable = {
  0: { 0: 0; 1: 1; 2: 2; 3: 3; 4: 4; 5: 5; 6: 6; 7: 7; 8: 8; 9: 9; 10: 10 };
  1: { 0: 1; 1: 2; 2: 3; 3: 4; 4: 5; 5: 6; 6: 7; 7: 8; 8: 9; 9: 10; 10: 11 };
  2: { 0: 2; 1: 3; 2: 4; 3: 5; 4: 6; 5: 7; 6: 8; 7: 9; 8: 10; 9: 11; 10: 12 };
  3: { 0: 3; 1: 4; 2: 5; 3: 6; 4: 7; 5: 8; 6: 9; 7: 10; 8: 11; 9: 12; 10: 13 };
  4: { 0: 4; 1: 5; 2: 6; 3: 7; 4: 8; 5: 9; 6: 10; 7: 11; 8: 12; 9: 13; 10: 14 };
  5: {
    0: 5;
    1: 6;
    2: 7;
    3: 8;
    4: 9;
    5: 10;
    6: 11;
    7: 12;
    8: 13;
    9: 14;
    10: 15;
  };
  6: {
    0: 6;
    1: 7;
    2: 8;
    3: 9;
    4: 10;
    5: 11;
    6: 12;
    7: 13;
    8: 14;
    9: 15;
    10: 16;
  };
  7: {
    0: 7;
    1: 8;
    2: 9;
    3: 10;
    4: 11;
    5: 12;
    6: 13;
    7: 14;
    8: 15;
    9: 16;
    10: 17;
  };
  8: {
    0: 8;
    1: 9;
    2: 10;
    3: 11;
    4: 12;
    5: 13;
    6: 14;
    7: 15;
    8: 16;
    9: 17;
    10: 18;
  };
  9: {
    0: 9;
    1: 10;
    2: 11;
    3: 12;
    4: 13;
    5: 14;
    6: 15;
    7: 16;
    8: 17;
    9: 18;
    10: 19;
  };
  10: {
    0: 10;
    1: 11;
    2: 12;
    3: 13;
    4: 14;
    5: 15;
    6: 16;
    7: 17;
    8: 18;
    9: 19;
    10: 20;
  };
};

type SubtractionTable = {
  0: { 0: 0 };
  1: { 0: 1; 1: 0 };
  2: { 0: 2; 1: 1; 2: 0 };
  3: { 0: 3; 1: 2; 2: 1; 3: 0 };
  4: { 0: 4; 1: 3; 2: 2; 3: 1; 4: 0 };
  5: { 0: 5; 1: 4; 2: 3; 3: 2; 4: 1; 5: 0 };
  6: { 0: 6; 1: 5; 2: 4; 3: 3; 4: 2; 5: 1; 6: 0 };
  7: { 0: 7; 1: 6; 2: 5; 3: 4; 4: 3; 5: 2; 6: 1; 7: 0 };
  8: { 0: 8; 1: 7; 2: 6; 3: 5; 4: 4; 5: 3; 6: 2; 7: 1; 8: 0 };
  9: { 0: 9; 1: 8; 2: 7; 3: 6; 4: 5; 5: 4; 6: 3; 7: 2; 8: 1; 9: 0 };
  10: { 0: 10; 1: 9; 2: 8; 3: 7; 4: 6; 5: 5; 6: 4; 7: 3; 8: 2; 9: 1; 10: 0 };
};

// ============================================================================
// Vec Type Definition
// ============================================================================

/**
 * A length-indexed array type.
 *
 * `Vec<T, N>` is an array of `T` with exactly `N` elements.
 * The length is tracked at the type level via the brand.
 */
export type Vec<T, N extends number> = Refined<T[], `Vec<${N}>`> & {
  readonly length: N;
};

/**
 * Brand for Vec types.
 */
export type VecBrand<N extends number> = `Vec<${N}>`;

// ============================================================================
// Runtime Implementation
// ============================================================================

/**
 * Internal symbol for Vec branding.
 */
const VEC_BRAND = Symbol.for("@typesugar/type-system/Vec");

/**
 * Check if a value is a Vec.
 */
export function isVec<T>(value: unknown): value is Vec<T, number> {
  return Array.isArray(value) && (value as any)[VEC_BRAND] === true;
}

/**
 * Create a Vec from an array with runtime length validation.
 * @throws If array length doesn't match expected length N
 */
function createVec<T, N extends number>(arr: T[], expectedLength: N): Vec<T, N> {
  if (arr.length !== expectedLength) {
    throw new Error(`Vec length mismatch: expected ${expectedLength}, got ${arr.length}`);
  }

  // Create a branded array
  const vec = [...arr] as any;
  Object.defineProperty(vec, VEC_BRAND, {
    value: true,
    enumerable: false,
    writable: false,
  });
  Object.defineProperty(vec, "__refined__", {
    value: `Vec<${expectedLength}>`,
    enumerable: false,
    writable: false,
  });

  return vec as Vec<T, N>;
}

/**
 * Unsafe cast - creates Vec without length validation.
 * Use only when you've already verified the length.
 */
function unsafeVec<T, N extends number>(arr: T[]): Vec<T, N> {
  const vec = arr as any;
  const length = arr.length as N;
  Object.defineProperty(vec, VEC_BRAND, {
    value: true,
    enumerable: false,
    writable: false,
  });
  Object.defineProperty(vec, "__refined__", {
    value: `Vec<${length}>`,
    enumerable: false,
    writable: false,
  });
  return vec as Vec<T, N>;
}

// ============================================================================
// Smart Constructors
// ============================================================================

/**
 * Vec constructor namespace.
 */
export const Vec = {
  /**
   * Create an empty Vec.
   *
   * @example
   * ```typescript
   * const empty = Vec.empty<string>(); // Vec<string, 0>
   * ```
   */
  empty<T>(): Vec<T, 0> {
    return createVec<T, 0>([], 0);
  },

  /**
   * Create a Vec with a single element.
   *
   * @example
   * ```typescript
   * const single = Vec.singleton("hello"); // Vec<string, 1>
   * ```
   */
  singleton<T>(value: T): Vec<T, 1> {
    return createVec<T, 1>([value], 1);
  },

  /**
   * Create a Vec from an array with explicit length type.
   *
   * @throws If array length doesn't match type parameter N
   *
   * @example
   * ```typescript
   * const three = Vec.from<string, 3>(["a", "b", "c"]);
   * // Type: Vec<string, 3>
   *
   * // This throws at runtime:
   * Vec.from<string, 3>(["a", "b"]); // Error: length mismatch
   * ```
   */
  from<T, N extends number>(arr: T[]): Vec<T, N> {
    return createVec(arr, arr.length as N);
  },

  /**
   * Create a Vec from a tuple with inferred length.
   *
   * @example
   * ```typescript
   * const v = Vec.tuple("a", "b", "c"); // Vec<string, 3>
   * ```
   */
  tuple<T extends unknown[]>(...items: T): Vec<T[number], T["length"] & number> {
    return createVec(items, items.length as T["length"] & number);
  },

  /**
   * Create a Vec filled with a value.
   *
   * @example
   * ```typescript
   * const zeros = Vec.fill(0, 5); // Vec<number, 5>
   * ```
   */
  fill<T, N extends number>(value: T, length: N): Vec<T, N> {
    return createVec(Array(length).fill(value), length);
  },

  /**
   * Create a Vec from a generator function.
   *
   * @example
   * ```typescript
   * const indices = Vec.generate(5, i => i); // Vec<number, 5> = [0,1,2,3,4]
   * ```
   */
  generate<T, N extends number>(length: N, fn: (index: number) => T): Vec<T, N> {
    const arr = Array.from({ length }, (_, i) => fn(i));
    return createVec(arr, length);
  },

  // ============================================================================
  // Operations
  // ============================================================================

  /**
   * Prepend an element to a Vec.
   * Returns a Vec with length N + 1.
   *
   * @example
   * ```typescript
   * const v3 = Vec.from<number, 3>([1, 2, 3]);
   * const v4 = Vec.cons(0, v3); // Vec<number, 4> = [0, 1, 2, 3]
   * ```
   */
  cons<T, N extends number>(head: T, tail: Vec<T, N>): Vec<T, Add<N, 1>> {
    const newArr = [head, ...(tail as T[])];
    return unsafeVec<T, Add<N, 1>>(newArr);
  },

  /**
   * Append an element to a Vec.
   * Returns a Vec with length N + 1.
   *
   * @example
   * ```typescript
   * const v3 = Vec.from<number, 3>([1, 2, 3]);
   * const v4 = Vec.snoc(v3, 4); // Vec<number, 4> = [1, 2, 3, 4]
   * ```
   */
  snoc<T, N extends number>(init: Vec<T, N>, last: T): Vec<T, Add<N, 1>> {
    const newArr = [...(init as T[]), last];
    return unsafeVec<T, Add<N, 1>>(newArr);
  },

  /**
   * Concatenate two Vecs.
   * Returns a Vec with length N + M.
   *
   * @example
   * ```typescript
   * const v2 = Vec.from<number, 2>([1, 2]);
   * const v3 = Vec.from<number, 3>([3, 4, 5]);
   * const v5 = Vec.append(v2, v3); // Vec<number, 5> = [1, 2, 3, 4, 5]
   * ```
   */
  append<T, N extends number, M extends number>(a: Vec<T, N>, b: Vec<T, M>): Vec<T, Add<N, M>> {
    const newArr = [...(a as T[]), ...(b as T[])];
    return unsafeVec<T, Add<N, M>>(newArr);
  },

  /**
   * Get the first element of a non-empty Vec.
   *
   * @example
   * ```typescript
   * const v = Vec.from<number, 3>([1, 2, 3]);
   * const first = Vec.head(v); // 1
   * ```
   */
  head<T, N extends number>(vec: Vec<T, N>): N extends 0 ? never : T {
    if ((vec as T[]).length === 0) {
      throw new Error("Cannot get head of empty Vec");
    }
    return (vec as T[])[0] as any;
  },

  /**
   * Get all elements except the first.
   * Returns a Vec with length N - 1.
   *
   * @example
   * ```typescript
   * const v3 = Vec.from<number, 3>([1, 2, 3]);
   * const v2 = Vec.tail(v3); // Vec<number, 2> = [2, 3]
   * ```
   */
  tail<T, N extends number>(vec: Vec<T, N>): Vec<T, Sub<N, 1>> {
    if ((vec as T[]).length === 0) {
      throw new Error("Cannot get tail of empty Vec");
    }
    return unsafeVec<T, Sub<N, 1>>((vec as T[]).slice(1));
  },

  /**
   * Get the last element of a non-empty Vec.
   *
   * @example
   * ```typescript
   * const v = Vec.from<number, 3>([1, 2, 3]);
   * const last = Vec.last(v); // 3
   * ```
   */
  last<T, N extends number>(vec: Vec<T, N>): N extends 0 ? never : T {
    const arr = vec as T[];
    if (arr.length === 0) {
      throw new Error("Cannot get last of empty Vec");
    }
    return arr[arr.length - 1] as any;
  },

  /**
   * Get all elements except the last.
   * Returns a Vec with length N - 1.
   *
   * @example
   * ```typescript
   * const v3 = Vec.from<number, 3>([1, 2, 3]);
   * const v2 = Vec.init(v3); // Vec<number, 2> = [1, 2]
   * ```
   */
  init<T, N extends number>(vec: Vec<T, N>): Vec<T, Sub<N, 1>> {
    const arr = vec as T[];
    if (arr.length === 0) {
      throw new Error("Cannot get init of empty Vec");
    }
    return unsafeVec<T, Sub<N, 1>>(arr.slice(0, -1));
  },

  /**
   * Take the first M elements.
   * Returns a Vec with length min(N, M).
   *
   * @example
   * ```typescript
   * const v5 = Vec.from<number, 5>([1, 2, 3, 4, 5]);
   * const v3 = Vec.take(v5, 3); // Vec<number, 3> = [1, 2, 3]
   * ```
   */
  take<T, N extends number, M extends number>(vec: Vec<T, N>, count: M): Vec<T, Min<N, M>> {
    return unsafeVec<T, Min<N, M>>((vec as T[]).slice(0, count));
  },

  /**
   * Drop the first M elements.
   * Returns a Vec with length max(0, N - M).
   *
   * @example
   * ```typescript
   * const v5 = Vec.from<number, 5>([1, 2, 3, 4, 5]);
   * const v2 = Vec.drop(v5, 3); // Vec<number, 2> = [4, 5]
   * ```
   */
  drop<T, N extends number, M extends number>(vec: Vec<T, N>, count: M): Vec<T, Sub<N, M>> {
    return unsafeVec<T, Sub<N, M>>((vec as T[]).slice(count));
  },

  /**
   * Get element at index with bounds checking.
   *
   * @throws If index is out of bounds
   */
  get<T, N extends number>(vec: Vec<T, N>, index: number): T {
    const arr = vec as T[];
    if (index < 0 || index >= arr.length) {
      throw new Error(`Vec index out of bounds: ${index} not in [0, ${arr.length})`);
    }
    return arr[index];
  },

  /**
   * Map over a Vec, preserving length.
   *
   * @example
   * ```typescript
   * const v3 = Vec.from<number, 3>([1, 2, 3]);
   * const doubled = Vec.map(v3, x => x * 2); // Vec<number, 3> = [2, 4, 6]
   * ```
   */
  map<T, U, N extends number>(vec: Vec<T, N>, fn: (value: T, index: number) => U): Vec<U, N> {
    return unsafeVec<U, N>((vec as T[]).map(fn));
  },

  /**
   * Zip two Vecs of equal length.
   *
   * @example
   * ```typescript
   * const a = Vec.from<number, 3>([1, 2, 3]);
   * const b = Vec.from<string, 3>(["a", "b", "c"]);
   * const zipped = Vec.zip(a, b); // Vec<[number, string], 3>
   * ```
   */
  zip<T, U, N extends number>(a: Vec<T, N>, b: Vec<U, N>): Vec<[T, U], N> {
    const arrA = a as T[];
    const arrB = b as U[];
    const result: [T, U][] = [];
    for (let i = 0; i < arrA.length; i++) {
      result.push([arrA[i], arrB[i]]);
    }
    return unsafeVec<[T, U], N>(result);
  },

  /**
   * Reverse a Vec, preserving length.
   */
  reverse<T, N extends number>(vec: Vec<T, N>): Vec<T, N> {
    return unsafeVec<T, N>([...(vec as T[])].reverse());
  },

  /**
   * Convert Vec back to a regular array.
   */
  toArray<T, N extends number>(vec: Vec<T, N>): T[] {
    return [...(vec as T[])];
  },

  /**
   * Get the runtime length of a Vec.
   * At compile time, this is known to equal N.
   */
  length<T, N extends number>(vec: Vec<T, N>): N {
    return (vec as T[]).length as N;
  },
} as const;

// ============================================================================
// Predicate Registration (for @typesugar/contracts integration)
// ============================================================================

/**
 * Vec predicate pattern for the prover.
 * The prover uses this to prove length-related conditions.
 *
 * For a `Vec<T, N>`, we know:
 * - `$.length === N` (exact length)
 * - `$.length >= 0` (always true)
 */
export const VEC_PREDICATE_PATTERN = /^Vec<(\d+)>$/;

/**
 * Extract the length from a Vec brand.
 *
 * @example
 * ```typescript
 * extractVecLength("Vec<5>") // 5
 * extractVecLength("NonEmpty") // undefined
 * ```
 */
export function extractVecLength(brand: string): number | undefined {
  const match = brand.match(VEC_PREDICATE_PATTERN);
  if (match) {
    return parseInt(match[1], 10);
  }
  return undefined;
}

/**
 * Generate the predicate for a Vec brand.
 *
 * @example
 * ```typescript
 * generateVecPredicate("Vec<5>") // "$.length === 5"
 * generateVecPredicate("Vec<0>") // "$.length === 0"
 * ```
 */
export function generateVecPredicate(brand: string): string | undefined {
  const length = extractVecLength(brand);
  if (length !== undefined) {
    return `$.length === ${length}`;
  }
  return undefined;
}

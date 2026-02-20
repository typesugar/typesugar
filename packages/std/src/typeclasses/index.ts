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
 */

// Re-export FlatMap typeclass (HKT-based, for let:/yield: macro)
export * from "./flatmap.js";

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

export const boundedBigInt: Bounded<bigint> = {
  minBound: () => BigInt("-9007199254740991"),
  maxBound: () => BigInt("9007199254740991"),
};

export const boundedBoolean: Bounded<boolean> = {
  minBound: () => false,
  maxBound: () => true,
};

export const boundedString: Bounded<string> = {
  minBound: () => "",
  maxBound: () => "\uFFFF".repeat(256),
};

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

export const enumBoolean: Enum<boolean> = {
  succ: (a) => !a,
  pred: (a) => !a,
  toEnum: (n) => n !== 0,
  fromEnum: (a) => (a ? 1 : 0),
};

export const enumString: Enum<string> = {
  succ: (a) =>
    a.length === 0
      ? "a"
      : a.slice(0, -1) + String.fromCharCode(a.charCodeAt(a.length - 1) + 1),
  pred: (a) =>
    a.length === 0
      ? ""
      : a.slice(0, -1) + String.fromCharCode(a.charCodeAt(a.length - 1) - 1),
  toEnum: (n) => String.fromCharCode(n),
  fromEnum: (a) => (a.length > 0 ? a.charCodeAt(0) : 0),
};

// ============================================================================
// Numeric — Haskell Num, Scala Numeric, Kotlin: Number
// Types supporting basic arithmetic.
// ============================================================================

/**
 * Numeric typeclass - types supporting basic arithmetic operations.
 * Use `registerStdInstances()` macro to enable summon<Numeric<T>>() resolution.
 */
export interface Numeric<A> {
  add(a: A, b: A): A;
  sub(a: A, b: A): A;
  mul(a: A, b: A): A;
  negate(a: A): A;
  abs(a: A): A;
  signum(a: A): A;
  fromNumber(n: number): A;
  toNumber(a: A): number;
  zero(): A;
  one(): A;
}

export const numericNumber: Numeric<number> = {
  add: (a, b) => a + b,
  sub: (a, b) => a - b,
  mul: (a, b) => a * b,
  negate: (a) => -a,
  abs: (a) => Math.abs(a),
  signum: (a) => Math.sign(a) as number,
  fromNumber: (n) => n,
  toNumber: (a) => a,
  zero: () => 0,
  one: () => 1,
};

export const numericBigInt: Numeric<bigint> = {
  add: (a, b) => a + b,
  sub: (a, b) => a - b,
  mul: (a, b) => a * b,
  negate: (a) => -a,
  abs: (a) => (a < 0n ? -a : a),
  signum: (a) => (a < 0n ? -1n : a > 0n ? 1n : 0n),
  fromNumber: (n) => BigInt(Math.trunc(n)),
  toNumber: (a) => Number(a),
  zero: () => 0n,
  one: () => 1n,
};

// ============================================================================
// Integral — Haskell Integral
// Integer-like types supporting division and modulo.
// ============================================================================

export interface Integral<A> {
  div(a: A, b: A): A;
  mod(a: A, b: A): A;
  divMod(a: A, b: A): [A, A];
  quot(a: A, b: A): A;
  rem(a: A, b: A): A;
  toInteger(a: A): bigint;
}

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

// ============================================================================
// Fractional — Haskell Fractional
// Types supporting real division.
// ============================================================================

export interface Fractional<A> {
  div(a: A, b: A): A;
  recip(a: A): A;
  fromRational(num: number, den: number): A;
}

export const fractionalNumber: Fractional<number> = {
  div: (a, b) => a / b,
  recip: (a) => 1 / a,
  fromRational: (num, den) => num / den,
};

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

// ============================================================================
// Parseable — Haskell Read, Rust FromStr, Scala: not built-in
// Types that can be parsed from a string.
// ============================================================================

export type ParseResult<A> =
  | { ok: true; value: A; rest: string }
  | { ok: false; error: string };

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

export function copyableMap<K, V>(
  innerK: Copyable<K>,
  innerV: Copyable<V>,
): Copyable<Map<K, V>> {
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

/**
 * Boolean Extension Methods
 *
 * The best from:
 * - Scala (fold on Boolean, implicit conversions)
 * - Kotlin (compareTo, and/or/xor, toInt)
 * - Rust (then, then_some)
 * - Haskell (bool function, Data.Bool)
 * - Ruby (!, &, |, ^)
 * - Most-requested JS/TS: ternary helpers, toInt, toggle, guard/assert patterns
 */

// ============================================================================
// Conversion
// ============================================================================

export function toInt(b: boolean): 0 | 1 {
  return b ? 1 : 0;
}

export function toSign(b: boolean): -1 | 1 {
  return b ? 1 : -1;
}

export function toString(b: boolean): "true" | "false" {
  return b ? "true" : "false";
}

export function toYesNo(b: boolean): "yes" | "no" {
  return b ? "yes" : "no";
}

export function toOnOff(b: boolean): "on" | "off" {
  return b ? "on" : "off";
}

// ============================================================================
// Rust-inspired: then / then_some
// ============================================================================

/** Returns `value` if `true`, otherwise `undefined`. Like Rust's `then_some`. */
export function thenSome<A>(b: boolean, value: A): A | undefined {
  return b ? value : undefined;
}

/** Calls `fn` if `true`, otherwise returns `undefined`. Like Rust's `then`. */
export function then<A>(b: boolean, fn: () => A): A | undefined {
  return b ? fn() : undefined;
}

/** Returns `value` if `false`, otherwise `undefined`. */
export function elseSome<A>(b: boolean, value: A): A | undefined {
  return b ? undefined : value;
}

// ============================================================================
// Haskell-inspired: bool / fold
// ============================================================================

/** `bool(falseVal, trueVal, condition)` — Haskell's `bool` function. */
export function bool<A>(falseVal: A, trueVal: A, b: boolean): A {
  return b ? trueVal : falseVal;
}

/** Fold a boolean: if true call `onTrue()`, if false call `onFalse()`. */
export function fold<A>(b: boolean, onFalse: () => A, onTrue: () => A): A {
  return b ? onTrue() : onFalse();
}

// ============================================================================
// Logic
// ============================================================================

export function toggle(b: boolean): boolean {
  return !b;
}

export function and(a: boolean, b: boolean): boolean {
  return a && b;
}

export function or(a: boolean, b: boolean): boolean {
  return a || b;
}

export function xor(a: boolean, b: boolean): boolean {
  return a !== b;
}

export function nand(a: boolean, b: boolean): boolean {
  return !(a && b);
}

export function nor(a: boolean, b: boolean): boolean {
  return !(a || b);
}

export function implies(a: boolean, b: boolean): boolean {
  return !a || b;
}

// ============================================================================
// Guard / Assert patterns
// ============================================================================

/** Throws `error` if the boolean is `false`. Useful as a guard. */
export function guard(b: boolean, error: string | Error = "Guard failed"): void {
  if (!b) throw typeof error === "string" ? new Error(error) : error;
}

/** Returns the value if the boolean is `true`, otherwise throws. */
export function expect<A>(b: boolean, value: A, error: string = "Expected true"): A {
  if (!b) throw new Error(error);
  return value;
}

// ============================================================================
// Comparison
// ============================================================================

export function compareTo(a: boolean, b: boolean): -1 | 0 | 1 {
  if (a === b) return 0;
  return a ? 1 : -1;
}

// ============================================================================
// Aggregate
// ============================================================================

export const BooleanExt = {
  toInt,
  toSign,
  toString,
  toYesNo,
  toOnOff,
  thenSome,
  then,
  elseSome,
  bool,
  fold,
  toggle,
  and,
  or,
  xor,
  nand,
  nor,
  implies,
  guard,
  expect,
  compareTo,
} as const;

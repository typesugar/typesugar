/**
 * Type-level utilities for symbolic mathematics.
 *
 * These types enable compile-time tracking of expression result types,
 * supporting dimensional analysis when used with @typesugar/units.
 */

/**
 * Type-level multiplication result.
 * For plain numbers, returns number. Can be specialized for unit types.
 */
export type Mul<A, B> = A extends number ? (B extends number ? number : B) : A;

/**
 * Type-level division result.
 * For plain numbers, returns number. Can be specialized for unit types.
 */
export type Div<A, B> = A extends number ? (B extends number ? number : never) : A;

/**
 * Type-level addition result.
 * Addition requires compatible types (same dimensions).
 */
export type Add<A, B> = A extends number
  ? B extends number
    ? number
    : never
  : A extends B
    ? A
    : never;

/**
 * Type-level subtraction result.
 * Subtraction requires compatible types (same dimensions).
 */
export type Sub<A, B> = Add<A, B>;

/**
 * Type-level power result.
 * For plain numbers, returns number.
 */
export type Pow<A, _N> = A extends number ? number : A;

/**
 * Type-level square root result.
 */
export type Sqrt<A> = A extends number ? number : A;

/**
 * Binary operator symbols supported in the AST.
 */
export type BinaryOpSymbol = "+" | "-" | "*" | "/" | "^";

/**
 * Unary operator symbols supported in the AST.
 */
export type UnaryOpSymbol = "-" | "abs" | "sqrt" | "signum";

/**
 * Mathematical function names supported in the AST.
 */
export type FunctionName =
  | "sin"
  | "cos"
  | "tan"
  | "asin"
  | "acos"
  | "atan"
  | "sinh"
  | "cosh"
  | "tanh"
  | "exp"
  | "log"
  | "ln"
  | "log10"
  | "log2"
  | "floor"
  | "ceil"
  | "round";

/**
 * Variable bindings for evaluation.
 */
export type Bindings = Record<string, number>;

/**
 * Pattern variable used in pattern matching.
 * Matches any expression and captures it.
 */
export interface PatternVar {
  readonly kind: "pattern-var";
  readonly name: string;
}

/**
 * Result of pattern matching - bindings from pattern variables to expressions.
 */
export type MatchResult<T> = Record<string, Expression<T>> | null;

// Forward declaration for Expression (defined in expression.ts)
import type { Expression } from "./expression.js";

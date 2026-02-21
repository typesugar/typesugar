/**
 * Expression Builders
 *
 * Factory functions for constructing symbolic expressions with proper
 * type tracking. Also provides a Numeric<Expression<T>> typeclass
 * instance for operator overloading.
 *
 * @example
 * ```typescript
 * const x = var_("x");
 * const expr = add(mul(x, x), const_(1)); // x² + 1
 * ```
 */

import type { Numeric } from "@typesugar/std";
import type { Op } from "@typesugar/core";
import type { Refined } from "@typesugar/type-system";
import type {
  Expression,
  Constant,
  Variable,
  BinaryOp,
  UnaryOp,
  FunctionCall,
  Derivative,
  Integral,
  Limit,
  Equation,
  Sum,
  Product,
} from "./expression.js";
import type { Mul, Div, Add, Sub, Pow, Sqrt, FunctionName } from "./types.js";

// ============================================================================
// Constants and Variables
// ============================================================================

/**
 * Create a numeric constant.
 *
 * @param value - The numeric value
 * @param name - Optional display name (e.g., "π", "e")
 */
export function const_<T = number>(value: number, name?: string): Constant<T> {
  if (Number.isNaN(value)) {
    throw new Error("Cannot create a constant from NaN");
  }
  return { kind: "constant", value, name };
}

/**
 * Create a symbolic variable.
 *
 * @param name - The variable name (must be non-empty, validated at runtime)
 * @throws {Error} If name is empty
 */
export function var_<T = number>(name: string): Variable<T> {
  if (name.length === 0) {
    throw new Error("Variable name must be non-empty");
  }
  return { kind: "variable", name };
}

// ============================================================================
// Common Constants
// ============================================================================

/** Mathematical constant π ≈ 3.14159... */
export const PI: Constant<number> = const_(Math.PI, "π");

/** Euler's number e ≈ 2.71828... */
export const E: Constant<number> = const_(Math.E, "e");

/** Golden ratio φ ≈ 1.61803... */
export const PHI: Constant<number> = const_((1 + Math.sqrt(5)) / 2, "φ");

/** Zero constant, branded so `div(x, ZERO)` is a compile error. */
export const ZERO: Refined<Constant<number>, "Zero"> = const_(0) as Refined<
  Constant<number>,
  "Zero"
>;

/** One constant */
export const ONE: Constant<number> = const_(1);

/** Negative one constant */
export const NEG_ONE: Constant<number> = const_(-1);

/** Two constant */
export const TWO: Constant<number> = const_(2);

/** One half constant */
export const HALF: Constant<number> = const_(0.5, "½");

// ============================================================================
// Auto-wrapping: numbers become constants automatically
// ============================================================================

/** Input that can be an Expression or a raw number (auto-wrapped) */
export type ExprLike<T> = Expression<T> | number;

/** Convert ExprLike to Expression, wrapping numbers as constants */
function toExpr<T>(e: ExprLike<T>): Expression<T> {
  return typeof e === "number" ? (const_(e) as Expression<T>) : e;
}

// ============================================================================
// Binary Operations
// ============================================================================

/**
 * Addition: a + b
 * Accepts raw numbers which are auto-wrapped as constants.
 */
export function add<A, B>(left: ExprLike<A>, right: ExprLike<B>): BinaryOp<A, B, Add<A, B>> {
  return { kind: "binary", op: "+", left: toExpr(left), right: toExpr(right) };
}

/**
 * Subtraction: a - b
 * Accepts raw numbers which are auto-wrapped as constants.
 */
export function sub<A, B>(left: ExprLike<A>, right: ExprLike<B>): BinaryOp<A, B, Sub<A, B>> {
  return { kind: "binary", op: "-", left: toExpr(left), right: toExpr(right) };
}

/**
 * Multiplication: a * b
 * Accepts raw numbers which are auto-wrapped as constants.
 */
export function mul<A, B>(left: ExprLike<A>, right: ExprLike<B>): BinaryOp<A, B, Mul<A, B>> {
  return { kind: "binary", op: "*", left: toExpr(left), right: toExpr(right) };
}

/**
 * Division: a / b
 * Accepts raw numbers which are auto-wrapped as constants.
 *
 * A valid divisor must be non-zero and not NaN. See `ValidDivisor` in
 * `@typesugar/type-system` for the refinement type that captures this.
 *
 * **Type-level guard:** Passing `ZERO` (the branded constant) as denominator
 * resolves to the `never` overload, making the result unusable at compile time.
 *
 * **Widening limitation:** TypeScript's structural typing allows the brand to
 * be stripped via widening (e.g., `const zero: Constant<number> = ZERO`).
 * The type guard is a "pit of success" — it catches direct uses of `ZERO`
 * but cannot prevent all zero-denominator constructions at the type level.
 *
 * **Runtime protection:** As a safety net, this function throws at runtime if
 * the denominator is a constant with value 0 or if the raw number 0 is passed.
 * NaN is also blocked since `const_()` rejects NaN values.
 *
 * @throws {Error} If the denominator is zero (constant or raw number)
 */
export function div<A>(left: ExprLike<A>, right: Refined<any, "Zero">): never;
export function div<A, B>(left: ExprLike<A>, right: ExprLike<B>): BinaryOp<A, B, Div<A, B>>;
export function div(left: ExprLike<any>, right: ExprLike<any>): any {
  if (typeof right === "number" && right === 0) {
    throw new Error("Division by zero: cannot divide by literal 0");
  }
  const rightExpr = toExpr(right);
  if (rightExpr.kind === "constant" && rightExpr.value === 0) {
    throw new Error("Division by zero: cannot divide by zero constant");
  }
  return { kind: "binary", op: "/", left: toExpr(left), right: rightExpr };
}

/**
 * Power: a ^ b (also supports ** operator)
 * Accepts raw numbers which are auto-wrapped as constants.
 */
export function pow<A>(
  base: ExprLike<A>,
  exponent: ExprLike<number>
): BinaryOp<A, number, Pow<A, number>> {
  return { kind: "binary", op: "^", left: toExpr(base), right: toExpr(exponent) };
}

// ============================================================================
// Unary Operations
// ============================================================================

/**
 * Negation: -a
 */
export function neg<A>(arg: Expression<A>): UnaryOp<A, A> {
  return { kind: "unary", op: "-", arg };
}

/**
 * Absolute value: |a|
 */
export function abs<A>(arg: Expression<A>): UnaryOp<A, A> {
  return { kind: "unary", op: "abs", arg };
}

/**
 * Signum (sign) function: returns 1 for positive, 0 for zero, -1 for negative.
 */
export function signum<A>(arg: Expression<A>): UnaryOp<A, number> {
  return { kind: "unary", op: "signum", arg };
}

/**
 * Square root: √a
 */
export function sqrt<A>(arg: Expression<A>): UnaryOp<A, Sqrt<A>> {
  return { kind: "unary", op: "sqrt", arg };
}

// ============================================================================
// Trigonometric Functions
// ============================================================================

function fnCall<A, R = number>(fn: FunctionName, arg: Expression<A>): FunctionCall<A, R> {
  return { kind: "function", fn, arg };
}

/** Sine function */
export function sin<A>(arg: Expression<A>): FunctionCall<A, number> {
  return fnCall("sin", arg);
}

/** Cosine function */
export function cos<A>(arg: Expression<A>): FunctionCall<A, number> {
  return fnCall("cos", arg);
}

/** Tangent function */
export function tan<A>(arg: Expression<A>): FunctionCall<A, number> {
  return fnCall("tan", arg);
}

/** Arcsine function */
export function asin<A>(arg: Expression<A>): FunctionCall<A, number> {
  return fnCall("asin", arg);
}

/** Arccosine function */
export function acos<A>(arg: Expression<A>): FunctionCall<A, number> {
  return fnCall("acos", arg);
}

/** Arctangent function */
export function atan<A>(arg: Expression<A>): FunctionCall<A, number> {
  return fnCall("atan", arg);
}

// ============================================================================
// Hyperbolic Functions
// ============================================================================

/** Hyperbolic sine */
export function sinh<A>(arg: Expression<A>): FunctionCall<A, number> {
  return fnCall("sinh", arg);
}

/** Hyperbolic cosine */
export function cosh<A>(arg: Expression<A>): FunctionCall<A, number> {
  return fnCall("cosh", arg);
}

/** Hyperbolic tangent */
export function tanh<A>(arg: Expression<A>): FunctionCall<A, number> {
  return fnCall("tanh", arg);
}

// ============================================================================
// Exponential and Logarithmic Functions
// ============================================================================

/** Exponential function: e^x */
export function exp<A>(arg: Expression<A>): FunctionCall<A, number> {
  return fnCall("exp", arg);
}

/** Natural logarithm: ln(x) */
export function ln<A>(arg: Expression<A>): FunctionCall<A, number> {
  return fnCall("ln", arg);
}

/** Natural logarithm: log(x) (alias for ln) */
export function log<A>(arg: Expression<A>): FunctionCall<A, number> {
  return fnCall("log", arg);
}

/** Base-10 logarithm: log₁₀(x) */
export function log10<A>(arg: Expression<A>): FunctionCall<A, number> {
  return fnCall("log10", arg);
}

/** Base-2 logarithm: log₂(x) */
export function log2<A>(arg: Expression<A>): FunctionCall<A, number> {
  return fnCall("log2", arg);
}

// ============================================================================
// Rounding Functions
// ============================================================================

/** Floor function */
export function floor<A>(arg: Expression<A>): FunctionCall<A, number> {
  return fnCall("floor", arg);
}

/** Ceiling function */
export function ceil<A>(arg: Expression<A>): FunctionCall<A, number> {
  return fnCall("ceil", arg);
}

/** Round function */
export function round<A>(arg: Expression<A>): FunctionCall<A, number> {
  return fnCall("round", arg);
}

// ============================================================================
// Calculus Constructs
// ============================================================================

/**
 * Create a derivative expression.
 *
 * @param expr - The expression to differentiate
 * @param variable - The variable to differentiate with respect to
 * @param order - The order of differentiation (default: 1)
 */
export function derivative<T>(
  expr: Expression<T>,
  variable: string,
  order: number = 1
): Derivative<T> {
  return { kind: "derivative", expr, variable, order };
}

/**
 * Create an integral expression.
 *
 * @param expr - The expression to integrate
 * @param variable - The variable to integrate with respect to
 */
export function integral<T>(expr: Expression<T>, variable: string): Integral<T> {
  return { kind: "integral", expr, variable };
}

/**
 * Create a limit expression.
 *
 * @param expr - The expression
 * @param variable - The variable approaching a value
 * @param approaching - The value being approached
 * @param direction - Optional direction ('left', 'right', or 'both')
 */
export function limit<T>(
  expr: Expression<T>,
  variable: string,
  approaching: number,
  direction?: "left" | "right" | "both"
): Limit<T> {
  return { kind: "limit", expr, variable, approaching, direction };
}

// ============================================================================
// Equations
// ============================================================================

/**
 * Create an equation: left = right
 */
export function equation<T>(left: Expression<T>, right: Expression<T>): Equation<T> {
  return { kind: "equation", left, right };
}

/**
 * Alias for equation.
 */
export const eq = equation;

// ============================================================================
// Summation and Product
// ============================================================================

/**
 * Create a summation expression: Σ expr from i=from to i=to
 */
export function sum<T>(
  expr: Expression<T>,
  variable: string,
  from: Expression<number>,
  to: Expression<number>
): Sum<T> {
  return { kind: "sum", expr, variable, from, to };
}

/**
 * Create a product expression: Π expr from i=from to i=to
 */
export function product<T>(
  expr: Expression<T>,
  variable: string,
  from: Expression<number>,
  to: Expression<number>
): Product<T> {
  return { kind: "product", expr, variable, from, to };
}

// ============================================================================
// Convenience Builders
// ============================================================================

/**
 * Square: x²
 */
export function square<A>(arg: Expression<A>): BinaryOp<A, number, Pow<A, number>> {
  return pow(arg, TWO);
}

/**
 * Cube: x³
 */
export function cube<A>(arg: Expression<A>): BinaryOp<A, number, Pow<A, number>> {
  return pow(arg, const_(3));
}

/**
 * Reciprocal: 1/x
 */
export function recip<A>(arg: Expression<A>): BinaryOp<number, A, Div<number, A>> {
  return div(ONE, arg);
}

// ============================================================================
// Numeric Typeclass Instance
// ============================================================================

/**
 * Numeric instance for Expression<T>.
 *
 * This enables expressions to be used with typesugar's operator overloading:
 * `a + b` becomes `add(a, b)` when both are expressions.
 */
export function numericExpression<T>(): Numeric<Expression<T>> {
  return {
    add: (a, b) => add(a, b) as Expression<T> & Op<"+">,
    sub: (a, b) => sub(a, b) as Expression<T> & Op<"-">,
    mul: (a, b) => mul(a, b) as Expression<T> & Op<"*">,
    negate: (a) => neg(a),
    abs: (a) => abs(a),
    signum: (a) => signum(a) as Expression<T>,
    fromNumber: (n) => const_(n) as Expression<T>,
    toNumber: (a) => {
      if (a.kind === "constant") return a.value;
      throw new Error("Cannot convert non-constant expression to number");
    },
    zero: () => const_(0) as Expression<T>,
    one: () => const_(1) as Expression<T>,
  };
}

/** Default Numeric instance for Expression<number> */
export const numericExpr: Numeric<Expression<number>> = numericExpression<number>();

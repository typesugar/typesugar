/**
 * Simplification Rules
 *
 * A collection of algebraic simplification rules.
 * Each rule takes an expression and returns a simplified version,
 * or null if the rule doesn't apply.
 */

import type { Expression } from "../expression.js";
import { const_, add, mul, pow, neg, ZERO, ONE, TWO } from "../builders.js";
import {
  isConstant,
  isZero,
  isOne,
  isNegativeOne,
  isBinaryOp,
  isUnaryOp,
  isIntegerConstant,
} from "../expression.js";

// Helper type for casting
type Expr = Expression<number>;

/**
 * A simplification rule.
 */
export type SimplificationRule = (expr: Expression<unknown>) => Expression<unknown> | null;

/**
 * All built-in simplification rules.
 */
export const simplificationRules: SimplificationRule[] = [
  // Identity rules
  addZeroRule,
  subZeroRule,
  mulOneRule,
  mulZeroRule,
  divOneRule,
  powOneRule,
  powZeroRule,

  // Constant folding
  constantFoldingRule,

  // Algebraic identities
  doubleNegationRule,
  subSameRule,
  divSameRule,
  mulNegOneRule,

  // Distributive properties
  combineConstantsAddRule,
  combineConstantsMulRule,

  // Power rules
  powerOfPowerRule,
  productOfPowersRule,
];

// ============================================================================
// Identity Rules
// ============================================================================

/**
 * x + 0 = x, 0 + x = x
 */
export function addZeroRule(expr: Expression<unknown>): Expression<unknown> | null {
  if (!isBinaryOp(expr) || expr.op !== "+") return null;

  if (isZero(expr.left)) return expr.right;
  if (isZero(expr.right)) return expr.left;

  return null;
}

/**
 * x - 0 = x
 */
export function subZeroRule(expr: Expression<unknown>): Expression<unknown> | null {
  if (!isBinaryOp(expr) || expr.op !== "-") return null;

  if (isZero(expr.right)) return expr.left;
  if (isZero(expr.left)) return neg(expr.right as Expr);

  return null;
}

/**
 * x * 1 = x, 1 * x = x
 */
export function mulOneRule(expr: Expression<unknown>): Expression<unknown> | null {
  if (!isBinaryOp(expr) || expr.op !== "*") return null;

  if (isOne(expr.left)) return expr.right;
  if (isOne(expr.right)) return expr.left;

  return null;
}

/**
 * x * 0 = 0, 0 * x = 0 (for finite x)
 * Skips when either operand could be infinity to avoid ∞ * 0 → 0 unsoundness.
 */
export function mulZeroRule(expr: Expression<unknown>): Expression<unknown> | null {
  if (!isBinaryOp(expr) || expr.op !== "*") return null;

  if (isZero(expr.left)) {
    if (isPotentialInfinity(expr.right)) return null;
    return ZERO;
  }
  if (isZero(expr.right)) {
    if (isPotentialInfinity(expr.left)) return null;
    return ZERO;
  }

  return null;
}

/**
 * Check if an expression could evaluate to infinity.
 * Detects division-by-zero patterns (x/0 where x ≠ 0).
 */
function isPotentialInfinity(expr: Expression<unknown>): boolean {
  if (!isBinaryOp(expr) || expr.op !== "/") return false;
  return isZero(expr.right) && !isZero(expr.left);
}

/**
 * x / 1 = x
 */
export function divOneRule(expr: Expression<unknown>): Expression<unknown> | null {
  if (!isBinaryOp(expr) || expr.op !== "/") return null;

  if (isOne(expr.right)) return expr.left;

  return null;
}

/**
 * x^1 = x
 */
export function powOneRule(expr: Expression<unknown>): Expression<unknown> | null {
  if (!isBinaryOp(expr) || expr.op !== "^") return null;

  if (isOne(expr.right)) return expr.left;

  return null;
}

/**
 * x^0 = 1 (assumes x ≠ 0 for symbolic variables)
 * Only skips when base is a LITERAL zero constant to avoid 0^0 → 1 unsoundness.
 * For symbolic variables, assumes non-zero (standard CAS behavior).
 */
export function powZeroRule(expr: Expression<unknown>): Expression<unknown> | null {
  if (!isBinaryOp(expr) || expr.op !== "^") return null;

  if (isZero(expr.right)) {
    if (isZero(expr.left)) return null;
    return ONE;
  }

  return null;
}

// ============================================================================
// Constant Folding
// ============================================================================

/**
 * Evaluate operations on constants.
 *
 * Guards against:
 * - NaN inputs (NaN^0 = 1 per IEEE 754, but symbolically indeterminate)
 * - Non-finite results (0^(-n) = Infinity, shouldn't create infinity constants)
 */
export function constantFoldingRule(expr: Expression<unknown>): Expression<unknown> | null {
  if (!isBinaryOp(expr)) return null;

  if (!isConstant(expr.left) || !isConstant(expr.right)) return null;

  const a = expr.left.value;
  const b = expr.right.value;

  // Guard: don't fold if either operand is NaN
  if (Number.isNaN(a) || Number.isNaN(b)) return null;

  let result: number;
  switch (expr.op) {
    case "+":
      result = a + b;
      break;
    case "-":
      result = a - b;
      break;
    case "*":
      result = a * b;
      break;
    case "/":
      if (b === 0) return null; // Don't fold division by zero
      result = a / b;
      break;
    case "^":
      if (a === 0 && b === 0) return null; // 0^0 is indeterminate, don't fold
      result = Math.pow(a, b);
      break;
    default:
      return null;
  }

  // Guard: don't fold if result is non-finite (Infinity, -Infinity, NaN)
  if (!Number.isFinite(result)) return null;

  return const_(result);
}

// ============================================================================
// Algebraic Identities
// ============================================================================

/**
 * --x = x
 */
export function doubleNegationRule(expr: Expression<unknown>): Expression<unknown> | null {
  if (!isUnaryOp(expr) || expr.op !== "-") return null;

  if (isUnaryOp(expr.arg) && expr.arg.op === "-") {
    return expr.arg.arg;
  }

  return null;
}

/**
 * x - x = 0
 */
export function subSameRule(expr: Expression<unknown>): Expression<unknown> | null {
  if (!isBinaryOp(expr) || expr.op !== "-") return null;

  if (expressionsEqual(expr.left, expr.right)) {
    return ZERO;
  }

  return null;
}

/**
 * x / x = 1 (assumes x ≠ 0 for symbolic variables)
 * Only skips when both sides are LITERAL zero constants to avoid 0/0 → 1 unsoundness.
 * For symbolic variables, assumes non-zero (standard CAS behavior).
 */
export function divSameRule(expr: Expression<unknown>): Expression<unknown> | null {
  if (!isBinaryOp(expr) || expr.op !== "/") return null;

  if (expressionsEqual(expr.left, expr.right)) {
    if (isZero(expr.left)) return null;
    return ONE;
  }

  return null;
}

/**
 * x * (-1) = -x, (-1) * x = -x
 */
export function mulNegOneRule(expr: Expression<unknown>): Expression<unknown> | null {
  if (!isBinaryOp(expr) || expr.op !== "*") return null;

  if (isNegativeOne(expr.left)) return neg(expr.right as Expr);
  if (isNegativeOne(expr.right)) return neg(expr.left as Expr);

  return null;
}

// ============================================================================
// Combining Terms
// ============================================================================

/**
 * Combine constants in addition: (a + x) + b = (a+b) + x
 */
export function combineConstantsAddRule(expr: Expression<unknown>): Expression<unknown> | null {
  if (!isBinaryOp(expr) || expr.op !== "+") return null;

  // (a + x) + b => (a+b) + x
  if (
    isBinaryOp(expr.left) &&
    expr.left.op === "+" &&
    isConstant(expr.left.left) &&
    isConstant(expr.right)
  ) {
    const sum = expr.left.left.value + expr.right.value;
    if (sum === 0) return expr.left.right;
    return add(const_(sum), expr.left.right as Expr);
  }

  // a + (b + x) => (a+b) + x
  if (
    isConstant(expr.left) &&
    isBinaryOp(expr.right) &&
    expr.right.op === "+" &&
    isConstant(expr.right.left)
  ) {
    const sum = expr.left.value + expr.right.left.value;
    if (sum === 0) return expr.right.right;
    return add(const_(sum), expr.right.right as Expr);
  }

  return null;
}

/**
 * Combine constants in multiplication: (a * x) * b = (a*b) * x
 */
export function combineConstantsMulRule(expr: Expression<unknown>): Expression<unknown> | null {
  if (!isBinaryOp(expr) || expr.op !== "*") return null;

  // (a * x) * b => (a*b) * x
  if (
    isBinaryOp(expr.left) &&
    expr.left.op === "*" &&
    isConstant(expr.left.left) &&
    isConstant(expr.right)
  ) {
    const prod = expr.left.left.value * expr.right.value;
    if (prod === 1) return expr.left.right;
    if (prod === 0) return ZERO;
    return mul(const_(prod), expr.left.right as Expr);
  }

  // a * (b * x) => (a*b) * x
  if (
    isConstant(expr.left) &&
    isBinaryOp(expr.right) &&
    expr.right.op === "*" &&
    isConstant(expr.right.left)
  ) {
    const prod = expr.left.value * expr.right.left.value;
    if (prod === 1) return expr.right.right;
    if (prod === 0) return ZERO;
    return mul(const_(prod), expr.right.right as Expr);
  }

  return null;
}

// ============================================================================
// Power Rules
// ============================================================================

/**
 * (x^a)^b = x^(a*b)
 *
 * Only fires when both exponents are known integers.
 * For non-integer exponents, this identity is invalid for negative bases:
 * e.g., ((-1)^2)^0.5 = 1, but (-1)^(2*0.5) = (-1)^1 = -1
 */
export function powerOfPowerRule(expr: Expression<unknown>): Expression<unknown> | null {
  if (!isBinaryOp(expr) || expr.op !== "^") return null;

  if (isBinaryOp(expr.left) && expr.left.op === "^") {
    const innerExp = expr.left.right;
    const outerExp = expr.right;

    // Guard: only apply when both exponents are integers (safe for all bases)
    if (!isIntegerConstant(innerExp) || !isIntegerConstant(outerExp)) {
      return null;
    }

    // (x^a)^b = x^(a*b)
    const base = expr.left.left;
    return pow(base as Expr, mul(innerExp as Expr, outerExp as Expr));
  }

  return null;
}

/**
 * x^a * x^b = x^(a+b)
 */
export function productOfPowersRule(expr: Expression<unknown>): Expression<unknown> | null {
  if (!isBinaryOp(expr) || expr.op !== "*") return null;

  // x * x = x^2
  if (expressionsEqual(expr.left, expr.right)) {
    return pow(expr.left as Expr, TWO);
  }

  // x^a * x^b = x^(a+b)
  if (
    isBinaryOp(expr.left) &&
    expr.left.op === "^" &&
    isBinaryOp(expr.right) &&
    expr.right.op === "^" &&
    expressionsEqual(expr.left.left, expr.right.left)
  ) {
    return pow(expr.left.left as Expr, add(expr.left.right as Expr, expr.right.right as Expr));
  }

  // x * x^a = x^(a+1)
  if (isBinaryOp(expr.right) && expr.right.op === "^") {
    if (expressionsEqual(expr.left, expr.right.left)) {
      return pow(expr.left as Expr, add(expr.right.right as Expr, ONE));
    }
  }

  // x^a * x = x^(a+1)
  if (isBinaryOp(expr.left) && expr.left.op === "^") {
    if (expressionsEqual(expr.left.left, expr.right)) {
      return pow(expr.left.left as Expr, add(expr.left.right as Expr, ONE));
    }
  }

  return null;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Structural equality check for expressions.
 */
export function expressionsEqual(a: Expression<unknown>, b: Expression<unknown>): boolean {
  if (a.kind !== b.kind) return false;

  switch (a.kind) {
    case "constant":
      return a.value === (b as typeof a).value;

    case "variable":
      return a.name === (b as typeof a).name;

    case "binary": {
      const bb = b as typeof a;
      return (
        a.op === bb.op && expressionsEqual(a.left, bb.left) && expressionsEqual(a.right, bb.right)
      );
    }

    case "unary": {
      const bu = b as typeof a;
      return a.op === bu.op && expressionsEqual(a.arg, bu.arg);
    }

    case "function": {
      const bf = b as typeof a;
      return a.fn === bf.fn && expressionsEqual(a.arg, bf.arg);
    }

    default:
      return false;
  }
}

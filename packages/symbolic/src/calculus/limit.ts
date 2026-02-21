/**
 * Symbolic Limits
 *
 * Computes limits using direct substitution and L'Hôpital's rule.
 *
 * @example
 * ```typescript
 * const x = var_("x");
 * computeLimit(div(sin(x), x), "x", 0); // 1
 * ```
 */

import type { Expression } from "../expression.js";
import type { Bindings } from "../types.js";
import { const_, div, ZERO, ONE, limit as limitExpr } from "../builders.js";
import { isConstant, isZero, isBinaryOp } from "../expression.js";
import { evaluate } from "../eval.js";
import { diff } from "./diff.js";

/**
 * Result of a limit computation.
 */
export type LimitResult<T> =
  | { exists: true; value: Expression<T> }
  | { exists: false; reason: string };

/**
 * Compute the limit of an expression as a variable approaches a value.
 *
 * @param expr - The expression
 * @param variable - The variable approaching
 * @param approaching - The value being approached
 * @param direction - Optional direction ('left', 'right', or 'both')
 * @returns The limit value or an indication that it doesn't exist
 */
export function computeLimit<T>(
  expr: Expression<T>,
  variable: string,
  approaching: number,
  direction: "left" | "right" | "both" = "both"
): LimitResult<T> {
  try {
    const result = computeLimitInternal(expr, variable, approaching, direction, 0);
    return { exists: true, value: result as Expression<T> };
  } catch (e) {
    return {
      exists: false,
      reason: e instanceof Error ? e.message : "Unknown error",
    };
  }
}

const MAX_LHOPITAL_ITERATIONS = 10;

function computeLimitInternal(
  expr: Expression<unknown>,
  v: string,
  a: number,
  direction: "left" | "right" | "both",
  iteration: number
): Expression<unknown> {
  if (iteration > MAX_LHOPITAL_ITERATIONS) {
    throw new Error("L'Hôpital's rule did not converge");
  }

  // Try direct substitution
  try {
    const directResult = evaluate(expr, { [v]: a });
    if (Number.isFinite(directResult)) {
      return const_(directResult);
    }
  } catch {
    // Direct substitution failed, continue with other methods
  }

  // Check for indeterminate forms
  const form = detectIndeterminateForm(expr, v, a, direction);

  if (form === "0/0" || form === "∞/∞") {
    // Apply L'Hôpital's rule
    if (isBinaryOp(expr) && expr.op === "/") {
      const numDeriv = diff(expr.left, v);
      const denDeriv = diff(expr.right, v);
      const newExpr = div(numDeriv, denDeriv);
      return computeLimitInternal(newExpr, v, a, direction, iteration + 1);
    }
  }

  if (form === "0*∞") {
    // Convert to 0/0 or ∞/∞ form
    // f * g where f→0 and g→∞: rewrite as f / (1/g) to get 0/0
    // This requires more sophisticated handling
    throw new Error("0*∞ form requires algebraic manipulation");
  }

  if (form === "∞-∞") {
    throw new Error("∞-∞ form requires algebraic manipulation");
  }

  if (form === "0^0" || form === "1^∞" || form === "∞^0") {
    // Use logarithmic limit
    throw new Error(`${form} form requires logarithmic transformation`);
  }

  // Try numerical approach from the specified direction
  const epsilon = 1e-10;
  const leftApproach = a - epsilon;
  const rightApproach = a + epsilon;

  let leftValue: number | null = null;
  let rightValue: number | null = null;

  if (direction === "left" || direction === "both") {
    try {
      leftValue = evaluate(expr, { [v]: leftApproach });
    } catch {
      leftValue = null;
    }
  }

  if (direction === "right" || direction === "both") {
    try {
      rightValue = evaluate(expr, { [v]: rightApproach });
    } catch {
      rightValue = null;
    }
  }

  if (direction === "left") {
    if (leftValue !== null) {
      if (Number.isFinite(leftValue)) {
        return const_(leftValue);
      }
      // Finding #16: Return symbolic infinity for infinite limits
      return const_(leftValue > 0 ? Infinity : -Infinity);
    }
    throw new Error("Left limit does not exist");
  }

  if (direction === "right") {
    if (rightValue !== null) {
      if (Number.isFinite(rightValue)) {
        return const_(rightValue);
      }
      // Finding #16: Return symbolic infinity for infinite limits
      return const_(rightValue > 0 ? Infinity : -Infinity);
    }
    throw new Error("Right limit does not exist");
  }

  // Both directions
  if (leftValue !== null && rightValue !== null) {
    // Finding #16: Handle infinite limits
    const leftInfinite = !Number.isFinite(leftValue);
    const rightInfinite = !Number.isFinite(rightValue);

    if (leftInfinite && rightInfinite) {
      // Both infinite — check if same sign (both +∞ or both -∞)
      if (leftValue > 0 === rightValue > 0) {
        return const_(leftValue > 0 ? Infinity : -Infinity);
      }
      throw new Error(
        `Limit does not exist: left limit (${leftValue}) ≠ right limit (${rightValue})`
      );
    }

    if (leftInfinite || rightInfinite) {
      throw new Error(
        `Limit does not exist: left limit (${leftValue}) ≠ right limit (${rightValue})`
      );
    }

    // Both finite
    if (Math.abs(leftValue - rightValue) < epsilon * 1000) {
      return const_((leftValue + rightValue) / 2);
    }
    throw new Error(
      `Limit does not exist: left limit (${leftValue}) ≠ right limit (${rightValue})`
    );
  }

  throw new Error("Could not determine limit");
}

type IndeterminateForm =
  | "0/0"
  | "∞/∞"
  | "0*∞"
  | "∞-∞"
  | "0^0"
  | "1^∞"
  | "∞^0"
  | "determinate"
  | "undefined";

function detectIndeterminateForm(
  expr: Expression<unknown>,
  v: string,
  a: number,
  direction: "left" | "right" | "both"
): IndeterminateForm {
  if (isBinaryOp(expr)) {
    const leftVal = safeEvaluate(expr.left, v, a, direction);
    const rightVal = safeEvaluate(expr.right, v, a, direction);

    switch (expr.op) {
      case "/":
        if (isApproxZero(leftVal) && isApproxZero(rightVal)) return "0/0";
        if (isInfinite(leftVal) && isInfinite(rightVal)) return "∞/∞";
        break;

      case "*":
        if (
          (isApproxZero(leftVal) && isInfinite(rightVal)) ||
          (isInfinite(leftVal) && isApproxZero(rightVal))
        ) {
          return "0*∞";
        }
        break;

      case "-":
        if (isInfinite(leftVal) && isInfinite(rightVal)) return "∞-∞";
        break;

      case "^":
        if (isApproxZero(leftVal) && isApproxZero(rightVal)) return "0^0";
        if (isApproxOne(leftVal) && isInfinite(rightVal)) return "1^∞";
        if (isInfinite(leftVal) && isApproxZero(rightVal)) return "∞^0";
        break;
    }
  }

  return "determinate";
}

function safeEvaluate(
  expr: Expression<unknown>,
  v: string,
  a: number,
  direction: "left" | "right" | "both"
): number | null {
  const epsilon = 1e-10;
  const x = direction === "left" ? a - epsilon : direction === "right" ? a + epsilon : a;

  try {
    return evaluate(expr, { [v]: x });
  } catch {
    return null;
  }
}

function isApproxZero(val: number | null): boolean {
  return val !== null && Math.abs(val) < 1e-10;
}

function isApproxOne(val: number | null): boolean {
  return val !== null && Math.abs(val - 1) < 1e-10;
}

function isInfinite(val: number | null): boolean {
  return val !== null && !Number.isFinite(val);
}

/**
 * Check if a limit exists.
 */
export function limitExists<T>(
  expr: Expression<T>,
  variable: string,
  approaching: number
): boolean {
  const result = computeLimit(expr, variable, approaching, "both");
  return result.exists;
}

/**
 * Compute a one-sided limit.
 */
export function leftLimit<T>(
  expr: Expression<T>,
  variable: string,
  approaching: number
): LimitResult<T> {
  return computeLimit(expr, variable, approaching, "left");
}

export function rightLimit<T>(
  expr: Expression<T>,
  variable: string,
  approaching: number
): LimitResult<T> {
  return computeLimit(expr, variable, approaching, "right");
}

/**
 * Create a limit expression (unevaluated).
 */
export { limitExpr as limit };

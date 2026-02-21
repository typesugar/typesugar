/**
 * Symbolic Integration
 *
 * Computes symbolic integrals for common patterns.
 *
 * @example
 * ```typescript
 * const x = var_("x");
 * integrate(pow(x, const_(2)), "x"); // x³/3
 * ```
 */

import type { Expression } from "../expression.js";
import { const_, var_, add, sub, mul, div, pow, neg, sin, cos, exp, ln, ONE } from "../builders.js";
import { isConstant, isVariable, hasVariable, isBinaryOp } from "../expression.js";

// Helper type alias for casting
type Expr = Expression<number>;

/**
 * Result of an integration attempt.
 */
export type IntegrationResult<T> =
  | { success: true; result: Expression<T> }
  | { success: false; reason: string };

/**
 * Attempt to compute the indefinite integral of an expression.
 */
export function tryIntegrate<T>(expr: Expression<T>, variable: string): IntegrationResult<T> {
  try {
    const result = integrateNode(expr, variable);
    return { success: true, result: result as Expression<T> };
  } catch (e) {
    return {
      success: false,
      reason: e instanceof Error ? e.message : "Unknown error",
    };
  }
}

/**
 * Compute the indefinite integral of an expression.
 */
export function integrate<T>(expr: Expression<T>, variable: string): Expression<T> {
  const result = tryIntegrate(expr, variable);
  if (!result.success) {
    throw new Error(`Cannot integrate: ${result.reason}`);
  }
  return result.result;
}

function integrateNode(expr: Expression<unknown>, v: string): Expression<unknown> {
  if (!hasVariable(expr, v)) {
    return mul(expr as Expr, var_(v));
  }

  switch (expr.kind) {
    case "constant":
      return mul(expr as Expr, var_(v));

    case "variable":
      if (expr.name === v) {
        return div(pow(var_(v), const_(2)), const_(2));
      }
      return mul(expr as Expr, var_(v));

    case "binary":
      return integrateBinary(expr, v);

    case "unary":
      return integrateUnary(expr, v);

    case "function":
      return integrateFunction(expr, v);

    case "derivative":
    case "integral":
    case "limit":
    case "equation":
    case "sum":
    case "product":
      throw new Error(`Cannot integrate expression of kind '${expr.kind}'`);
  }
}

function integrateBinary(
  expr: Expression<unknown> & { kind: "binary" },
  v: string
): Expression<unknown> {
  switch (expr.op) {
    case "+":
      return add(integrateNode(expr.left, v) as Expr, integrateNode(expr.right, v) as Expr);

    case "-":
      return sub(integrateNode(expr.left, v) as Expr, integrateNode(expr.right, v) as Expr);

    case "*":
      return integrateProduct(expr.left, expr.right, v);

    case "/":
      return integrateDivision(expr.left, expr.right, v);

    case "^":
      return integratePower(expr.left, expr.right, v);
  }
}

function integrateProduct(
  left: Expression<unknown>,
  right: Expression<unknown>,
  v: string
): Expression<unknown> {
  const leftHasVar = hasVariable(left, v);
  const rightHasVar = hasVariable(right, v);

  if (!leftHasVar) {
    return mul(left as Expr, integrateNode(right, v) as Expr);
  }
  if (!rightHasVar) {
    return mul(right as Expr, integrateNode(left, v) as Expr);
  }

  throw new Error(
    "Integration by parts not yet implemented. Cannot integrate product of expressions both containing the variable."
  );
}

function integrateDivision(
  numerator: Expression<unknown>,
  denominator: Expression<unknown>,
  v: string
): Expression<unknown> {
  const numHasVar = hasVariable(numerator, v);
  const denHasVar = hasVariable(denominator, v);

  if (!denHasVar) {
    return div(integrateNode(numerator, v) as Expr, denominator as Expr);
  }

  if (!numHasVar) {
    if (isVariable(denominator) && denominator.name === v) {
      return mul(numerator as Expr, ln(var_(v)));
    }

    if (isBinaryOp(denominator) && denominator.op === "+") {
      const leftIsVar = isVariable(denominator.left) && denominator.left.name === v;
      const rightIsConst = isConstant(denominator.right);
      if (leftIsVar && rightIsConst) {
        return mul(numerator as Expr, ln(denominator as Expr));
      }
    }
  }

  throw new Error(
    "Cannot integrate this division. Partial fractions or substitution may be required."
  );
}

function integratePower(
  base: Expression<unknown>,
  exponent: Expression<unknown>,
  v: string
): Expression<unknown> {
  const baseHasVar = hasVariable(base, v);
  const expHasVar = hasVariable(exponent, v);

  if (!baseHasVar && !expHasVar) {
    return mul(pow(base as Expr, exponent as Expr), var_(v));
  }

  if (isVariable(base) && base.name === v && !expHasVar) {
    if (isConstant(exponent)) {
      if (exponent.value === -1) {
        return ln(var_(v));
      }
      const newExp = exponent.value + 1;
      return div(pow(var_(v), const_(newExp)), const_(newExp));
    }
    const newExp = add(exponent as Expr, ONE);
    return div(pow(base as Expr, newExp), newExp);
  }

  if (
    isConstant(base) &&
    Math.abs(base.value - Math.E) < 1e-10 &&
    isVariable(exponent) &&
    exponent.name === v
  ) {
    return exp(var_(v));
  }

  if (!baseHasVar && isVariable(exponent) && exponent.name === v) {
    return div(pow(base as Expr, var_(v)), ln(base as Expr));
  }

  if (
    isConstant(base) &&
    Math.abs(base.value - Math.E) < 1e-10 &&
    isBinaryOp(exponent) &&
    exponent.op === "*"
  ) {
    const [coeff, varPart] = isConstant(exponent.left)
      ? [exponent.left, exponent.right]
      : isConstant(exponent.right)
        ? [exponent.right, exponent.left]
        : [null, null];

    if (coeff && isVariable(varPart) && varPart.name === v) {
      return div(pow(base as Expr, exponent as Expr), coeff as Expr);
    }
  }

  throw new Error("Cannot integrate this power expression. Substitution may be required.");
}

function integrateUnary(
  expr: Expression<unknown> & { kind: "unary" },
  v: string
): Expression<unknown> {
  switch (expr.op) {
    case "-":
      return neg(integrateNode(expr.arg, v) as Expr);

    case "abs":
    case "sqrt":
    case "signum":
      throw new Error(`Cannot directly integrate ${expr.op}(). Substitution may be required.`);
  }
}

function integrateFunction(
  expr: Expression<unknown> & { kind: "function" },
  v: string
): Expression<unknown> {
  const arg = expr.arg;

  if (!isVariable(arg) || arg.name !== v) {
    if (isBinaryOp(arg) && arg.op === "*") {
      const [coeff, varPart] = isConstant(arg.left)
        ? [arg.left, arg.right]
        : isConstant(arg.right)
          ? [arg.right, arg.left]
          : [null, null];

      if (coeff && isVariable(varPart) && varPart.name === v) {
        const basicIntegral = integrateBasicFunction(expr.fn, arg);
        return div(basicIntegral as Expr, coeff as Expr);
      }
    }

    throw new Error(`Cannot integrate ${expr.fn}() with complex argument. Substitution required.`);
  }

  return integrateBasicFunction(expr.fn, var_(v));
}

function integrateBasicFunction(fn: string, arg: Expression<unknown>): Expression<unknown> {
  switch (fn) {
    case "sin":
      return neg(cos(arg as Expr));

    case "cos":
      return sin(arg as Expr);

    case "tan":
      return neg(ln(cos(arg as Expr)));

    case "exp":
      return exp(arg as Expr);

    case "sinh":
      return { kind: "function", fn: "cosh", arg };

    case "cosh":
      return { kind: "function", fn: "sinh", arg };

    default:
      throw new Error(`No known integral for ${fn}()`);
  }
}

/**
 * Compute a definite integral.
 */
export function definiteIntegral<T>(
  expr: Expression<T>,
  variable: string,
  lower: number,
  upper: number
): Expression<unknown> {
  const antiderivative = integrate(expr, variable);

  const upperExpr = substitute(antiderivative, variable, const_(upper));
  const lowerExpr = substitute(antiderivative, variable, const_(lower));

  return sub(upperExpr as Expr, lowerExpr as Expr);
}

function substitute<T>(
  expr: Expression<T>,
  variable: string,
  replacement: Expression<unknown>
): Expression<unknown> {
  switch (expr.kind) {
    case "constant":
      return expr;

    case "variable":
      return expr.name === variable ? replacement : expr;

    case "binary":
      return {
        kind: "binary",
        op: expr.op,
        left: substitute(expr.left, variable, replacement),
        right: substitute(expr.right, variable, replacement),
      };

    case "unary":
      return {
        kind: "unary",
        op: expr.op,
        arg: substitute(expr.arg, variable, replacement),
      };

    case "function":
      return {
        kind: "function",
        fn: expr.fn,
        arg: substitute(expr.arg, variable, replacement),
      };

    default:
      throw new Error(`Substitution not implemented for ${expr.kind}`);
  }
}

/**
 * Symbolic Differentiation
 *
 * Computes symbolic derivatives using standard differentiation rules.
 *
 * @example
 * ```typescript
 * const x = var_("x");
 * const expr = mul(x, x); // x²
 * diff(expr, "x");        // 2x
 * ```
 */

import type { Expression } from "../expression.js";
import {
  const_,
  add,
  sub,
  mul,
  div,
  pow,
  neg,
  sin,
  cos,
  exp,
  ln,
  ZERO,
  ONE,
  TWO,
} from "../builders.js";
import { isConstant, isZero, isOne, hasVariable } from "../expression.js";

/**
 * Compute the symbolic derivative of an expression.
 *
 * @param expr - The expression to differentiate
 * @param variable - The variable to differentiate with respect to
 * @returns The derivative expression
 */
export function diff<T>(expr: Expression<T>, variable: string): Expression<T> {
  return diffNode(expr, variable) as Expression<T>;
}

/**
 * Compute the nth derivative.
 */
export function nthDiff<T>(expr: Expression<T>, variable: string, n: number): Expression<T> {
  if (n <= 0) return expr;

  let result = expr;
  for (let i = 0; i < n; i++) {
    result = diff(result, variable);
  }
  return result;
}

function diffNode(expr: Expression<unknown>, v: string): Expression<unknown> {
  switch (expr.kind) {
    case "constant":
      return ZERO;

    case "variable":
      return expr.name === v ? ONE : ZERO;

    case "binary":
      return diffBinary(expr, v);

    case "unary":
      return diffUnary(expr, v);

    case "function":
      return diffFunction(expr, v);

    case "derivative":
      return {
        kind: "derivative",
        expr: diffNode(expr.expr, v),
        variable: expr.variable,
        order: expr.order,
      };

    case "integral":
      if (expr.variable === v) {
        return expr.expr;
      }
      return {
        kind: "integral",
        expr: diffNode(expr.expr, v),
        variable: expr.variable,
      };

    case "limit":
      return {
        kind: "limit",
        expr: diffNode(expr.expr, v),
        variable: expr.variable,
        approaching: expr.approaching,
        direction: expr.direction,
      };

    case "equation":
      return {
        kind: "equation",
        left: diffNode(expr.left, v),
        right: diffNode(expr.right, v),
      };

    case "sum":
      if (expr.variable === v) {
        throw new Error(`Cannot differentiate sum with respect to its index variable '${v}'`);
      }
      return {
        kind: "sum",
        expr: diffNode(expr.expr, v),
        variable: expr.variable,
        from: expr.from,
        to: expr.to,
      };

    case "product":
      if (expr.variable === v) {
        throw new Error(`Cannot differentiate product with respect to its index variable '${v}'`);
      }
      return {
        kind: "product",
        expr: diffNode(expr.expr, v),
        variable: expr.variable,
        from: expr.from,
        to: expr.to,
      };
  }
}

function diffBinary(
  expr: Expression<unknown> & { kind: "binary" },
  v: string
): Expression<unknown> {
  const left = expr.left;
  const right = expr.right;
  const dLeft = diffNode(left, v);
  const dRight = diffNode(right, v);

  switch (expr.op) {
    case "+":
      return simplifyAdd(dLeft, dRight);

    case "-":
      return simplifySub(dLeft, dRight);

    case "*":
      return simplifyAdd(simplifyMul(dLeft, right), simplifyMul(left, dRight));

    case "/":
      return simplifyDiv(
        simplifySub(simplifyMul(dLeft, right), simplifyMul(left, dRight)),
        simplifyMul(right, right)
      );

    case "^":
      return diffPower(left, right, dLeft, dRight, v);
  }
}

function diffPower(
  base: Expression<unknown>,
  exponent: Expression<unknown>,
  dBase: Expression<unknown>,
  dExponent: Expression<unknown>,
  v: string
): Expression<unknown> {
  const baseHasVar = hasVariable(base, v);
  const expHasVar = hasVariable(exponent, v);

  if (!baseHasVar && !expHasVar) {
    return ZERO;
  }

  if (baseHasVar && !expHasVar) {
    // f(x)^n: power rule
    // d/dx[f^n] = n * f^(n-1) * f'
    return simplifyMul(
      simplifyMul(
        exponent,
        pow(base as Expression<number>, sub(exponent as Expression<number>, ONE))
      ),
      dBase
    );
  }

  if (!baseHasVar && expHasVar) {
    // a^g(x): exponential rule
    // d/dx[a^g] = a^g * ln(a) * g'
    return simplifyMul(
      simplifyMul(
        pow(base as Expression<number>, exponent as Expression<number>),
        ln(base as Expression<number>)
      ),
      dExponent
    );
  }

  // f(x)^g(x): generalized power rule
  // d/dx[f^g] = f^g * (g' * ln(f) + g * f'/f)
  return simplifyMul(
    pow(base as Expression<number>, exponent as Expression<number>),
    simplifyAdd(
      simplifyMul(dExponent, ln(base as Expression<number>)),
      simplifyMul(exponent, simplifyDiv(dBase, base))
    )
  );
}

function diffUnary(expr: Expression<unknown> & { kind: "unary" }, v: string): Expression<unknown> {
  const arg = expr.arg;
  const dArg = diffNode(arg, v);

  switch (expr.op) {
    case "-":
      return simplifyNeg(dArg);

    case "abs":
      return simplifyMul(dArg, simplifyDiv(arg, { kind: "unary", op: "abs", arg }));

    case "sqrt":
      return simplifyDiv(dArg, simplifyMul(TWO, { kind: "unary", op: "sqrt", arg }));

    case "signum":
      // signum has derivative 0 almost everywhere (discontinuous at 0)
      return { kind: "constant", value: 0 } as Expression<unknown>;
  }
}

function diffFunction(
  expr: Expression<unknown> & { kind: "function" },
  v: string
): Expression<unknown> {
  const arg = expr.arg;
  const dArg = diffNode(arg, v);

  let innerDerivative: Expression<unknown>;

  switch (expr.fn) {
    case "sin":
      innerDerivative = cos(arg as Expression<number>);
      break;

    case "cos":
      innerDerivative = simplifyNeg(sin(arg as Expression<number>));
      break;

    case "tan":
      innerDerivative = simplifyDiv(
        ONE,
        simplifyMul(cos(arg as Expression<number>), cos(arg as Expression<number>))
      );
      break;

    case "asin":
      innerDerivative = simplifyDiv(ONE, {
        kind: "unary",
        op: "sqrt",
        arg: sub(ONE, simplifyMul(arg, arg)),
      });
      break;

    case "acos":
      innerDerivative = simplifyNeg(
        simplifyDiv(ONE, { kind: "unary", op: "sqrt", arg: sub(ONE, simplifyMul(arg, arg)) })
      );
      break;

    case "atan":
      innerDerivative = simplifyDiv(ONE, add(ONE, simplifyMul(arg, arg)));
      break;

    case "sinh":
      innerDerivative = { kind: "function", fn: "cosh", arg };
      break;

    case "cosh":
      innerDerivative = { kind: "function", fn: "sinh", arg };
      break;

    case "tanh": {
      const tanhArg: Expression<unknown> = { kind: "function", fn: "tanh", arg };
      innerDerivative = sub(ONE, simplifyMul(tanhArg, tanhArg));
      break;
    }

    case "exp":
      innerDerivative = exp(arg as Expression<number>);
      break;

    case "log":
    case "ln":
      innerDerivative = simplifyDiv(ONE, arg);
      break;

    case "log10":
      innerDerivative = simplifyDiv(ONE, simplifyMul(arg, const_(Math.LN10)));
      break;

    case "log2":
      innerDerivative = simplifyDiv(ONE, simplifyMul(arg, const_(Math.LN2)));
      break;

    case "floor":
    case "ceil":
    case "round":
      return ZERO;

    default:
      throw new Error(`Unknown function for differentiation: ${expr.fn}`);
  }

  return simplifyMul(innerDerivative, dArg);
}

// ============================================================================
// Simplification Helpers (local to avoid circular dependencies)
// ============================================================================

function simplifyAdd(a: Expression<unknown>, b: Expression<unknown>): Expression<unknown> {
  if (isZero(a)) return b;
  if (isZero(b)) return a;
  if (isConstant(a) && isConstant(b)) {
    return const_(a.value + b.value);
  }
  return add(a as Expression<number>, b as Expression<number>);
}

function simplifySub(a: Expression<unknown>, b: Expression<unknown>): Expression<unknown> {
  if (isZero(b)) return a;
  if (isZero(a)) return simplifyNeg(b);
  if (isConstant(a) && isConstant(b)) {
    return const_(a.value - b.value);
  }
  return sub(a as Expression<number>, b as Expression<number>);
}

function simplifyMul(a: Expression<unknown>, b: Expression<unknown>): Expression<unknown> {
  if (isZero(a) || isZero(b)) return ZERO;
  if (isOne(a)) return b;
  if (isOne(b)) return a;
  if (isConstant(a) && isConstant(b)) {
    return const_(a.value * b.value);
  }
  return mul(a as Expression<number>, b as Expression<number>);
}

function simplifyDiv(a: Expression<unknown>, b: Expression<unknown>): Expression<unknown> {
  if (isZero(a)) return ZERO;
  if (isOne(b)) return a;
  if (isConstant(a) && isConstant(b)) {
    return const_(a.value / b.value);
  }
  return div(a as Expression<number>, b as Expression<number>);
}

function simplifyNeg(a: Expression<unknown>): Expression<unknown> {
  if (isZero(a)) return ZERO;
  if (isConstant(a)) {
    return const_(-a.value);
  }
  if (a.kind === "unary" && a.op === "-") {
    return a.arg;
  }
  return neg(a as Expression<number>);
}

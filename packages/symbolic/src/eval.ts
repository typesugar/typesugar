/**
 * Expression Evaluation
 *
 * Evaluates symbolic expressions by substituting variable values.
 *
 * @example
 * ```typescript
 * const x = var_("x");
 * const expr = add(mul(x, x), const_(1)); // x² + 1
 * evaluate(expr, { x: 3 }); // 10
 * ```
 */

import { match } from "@typesugar/std";
import type { Expression } from "./expression.js";
import type { Bindings, FunctionName } from "./types.js";

/**
 * Evaluation options.
 */
export interface EvaluateOptions {
  /** Throw on undefined variables (default: true) */
  strict?: boolean;
  /** Default value for undefined variables (only used if strict=false) */
  defaultValue?: number;
}

const defaultOptions: Required<EvaluateOptions> = {
  strict: true,
  defaultValue: 0,
};

/**
 * Evaluate an expression with the given variable bindings.
 *
 * @param expr - The expression to evaluate
 * @param bindings - Variable name to value mappings
 * @param options - Evaluation options
 * @returns The numeric result
 * @throws Error if a variable is not bound (in strict mode)
 */
export function evaluate<T>(
  expr: Expression<T>,
  bindings: Bindings = {},
  options: EvaluateOptions = {}
): number {
  const opts = { ...defaultOptions, ...options };
  return evalNode(expr, bindings, opts);
}

function evalNode<T>(
  expr: Expression<T>,
  bindings: Bindings,
  opts: Required<EvaluateOptions>
): number {
  return match(expr, {
    constant: ({ value }) => value,
    variable: ({ name }) => evalVariable(name, bindings, opts),
    binary: ({ op, left, right }) =>
      evalBinary(op, evalNode(left, bindings, opts), evalNode(right, bindings, opts)),
    unary: ({ op, arg }) => evalUnary(op, evalNode(arg, bindings, opts)),
    function: ({ fn, arg }) => evalFunction(fn, evalNode(arg, bindings, opts)),
    derivative: () => {
      throw new Error(
        "Cannot evaluate unevaluated derivative. Use diff() to compute the derivative first."
      );
    },
    integral: () => {
      throw new Error(
        "Cannot evaluate unevaluated integral. Use integrate() to compute the integral first."
      );
    },
    limit: (e) => evalLimit(e, bindings, opts),
    equation: () => {
      throw new Error("Cannot evaluate an equation to a number. Use solve() instead.");
    },
    sum: (e) => evalSum(e, bindings, opts),
    product: (e) => evalProduct(e, bindings, opts),
  });
}

function evalVariable(name: string, bindings: Bindings, opts: Required<EvaluateOptions>): number {
  if (name in bindings) {
    return bindings[name];
  }

  if (opts.strict) {
    throw new Error(`Variable '${name}' is not bound`);
  }

  return opts.defaultValue;
}

function evalBinary(op: string, left: number, right: number): number {
  switch (op) {
    case "+":
      return left + right;
    case "-":
      return left - right;
    case "*":
      return left * right;
    case "/":
      if (right === 0) {
        throw new Error("Division by zero");
      }
      return left / right;
    case "^":
      return Math.pow(left, right);
    default:
      throw new Error(`Unknown binary operator: ${op}`);
  }
}

function evalUnary(op: string, arg: number): number {
  switch (op) {
    case "-":
      return -arg;
    case "abs":
      return Math.abs(arg);
    case "sqrt":
      if (arg < 0) {
        throw new Error("Square root of negative number");
      }
      return Math.sqrt(arg);
    case "signum":
      return arg > 0 ? 1 : arg < 0 ? -1 : 0;
    default:
      throw new Error(`Unknown unary operator: ${op}`);
  }
}

function evalFunction(fn: FunctionName, arg: number): number {
  switch (fn) {
    case "sin":
      return Math.sin(arg);
    case "cos":
      return Math.cos(arg);
    case "tan":
      return Math.tan(arg);
    case "asin":
      return Math.asin(arg);
    case "acos":
      return Math.acos(arg);
    case "atan":
      return Math.atan(arg);
    case "sinh":
      return Math.sinh(arg);
    case "cosh":
      return Math.cosh(arg);
    case "tanh":
      return Math.tanh(arg);
    case "exp":
      return Math.exp(arg);
    case "log":
    case "ln":
      if (arg <= 0) {
        throw new Error("Logarithm of non-positive number");
      }
      return Math.log(arg);
    case "log10":
      if (arg <= 0) {
        throw new Error("Logarithm of non-positive number");
      }
      return Math.log10(arg);
    case "log2":
      if (arg <= 0) {
        throw new Error("Logarithm of non-positive number");
      }
      return Math.log2(arg);
    case "floor":
      return Math.floor(arg);
    case "ceil":
      return Math.ceil(arg);
    case "round":
      return Math.round(arg);
    default:
      throw new Error(`Unknown function: ${fn}`);
  }
}

function evalLimit<T>(
  expr: Expression<T> & { kind: "limit" },
  bindings: Bindings,
  opts: Required<EvaluateOptions>
): number {
  const epsilon = 1e-10;
  const v = expr.variable;
  const a = expr.approaching;

  // Try direct substitution first
  try {
    const directResult = evalNode(expr.expr, { ...bindings, [v]: a }, opts);
    if (Number.isFinite(directResult)) {
      return directResult;
    }
  } catch {
    // Direct substitution failed, try approaching from a direction
  }

  // Approach from the specified direction(s)
  const leftValue = evalNode(expr.expr, { ...bindings, [v]: a - epsilon }, opts);
  const rightValue = evalNode(expr.expr, { ...bindings, [v]: a + epsilon }, opts);

  switch (expr.direction) {
    case "left":
      return leftValue;
    case "right":
      return rightValue;
    case "both":
    default:
      // Check if both sides agree
      if (Math.abs(leftValue - rightValue) < epsilon * 100) {
        return (leftValue + rightValue) / 2;
      }
      throw new Error(
        `Limit does not exist: left limit (${leftValue}) ≠ right limit (${rightValue})`
      );
  }
}

function evalSum<T>(
  expr: Expression<T> & { kind: "sum" },
  bindings: Bindings,
  opts: Required<EvaluateOptions>
): number {
  const from = Math.round(evalNode(expr.from, bindings, opts));
  const to = Math.round(evalNode(expr.to, bindings, opts));

  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    throw new Error("Sum bounds must be finite integers");
  }

  let sum = 0;
  for (let i = from; i <= to; i++) {
    sum += evalNode(expr.expr, { ...bindings, [expr.variable]: i }, opts);
  }

  return sum;
}

function evalProduct<T>(
  expr: Expression<T> & { kind: "product" },
  bindings: Bindings,
  opts: Required<EvaluateOptions>
): number {
  const from = Math.round(evalNode(expr.from, bindings, opts));
  const to = Math.round(evalNode(expr.to, bindings, opts));

  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    throw new Error("Product bounds must be finite integers");
  }

  let product = 1;
  for (let i = from; i <= to; i++) {
    product *= evalNode(expr.expr, { ...bindings, [expr.variable]: i }, opts);
  }

  return product;
}

/**
 * Partially evaluate an expression, substituting only the bound variables.
 * Returns a new expression with constants folded where possible.
 */
export function partialEvaluate<T>(expr: Expression<T>, bindings: Bindings): Expression<T> {
  return partialEvalNode(expr, bindings);
}

function partialEvalNode<T>(expr: Expression<T>, bindings: Bindings): Expression<T> {
  return match(expr, {
    constant: () => expr,
    variable: ({ name }) => {
      if (name in bindings) {
        return { kind: "constant", value: bindings[name] } as Expression<T>;
      }
      return expr;
    },
    binary: (e) => {
      const left = partialEvalNode(e.left, bindings);
      const right = partialEvalNode(e.right, bindings);
      if (left.kind === "constant" && right.kind === "constant") {
        const result = evalBinary(e.op, left.value, right.value);
        return { kind: "constant", value: result } as Expression<T>;
      }
      return { ...e, left, right } as Expression<T>;
    },
    unary: (e) => {
      const arg = partialEvalNode(e.arg, bindings);
      if (arg.kind === "constant") {
        const result = evalUnary(e.op, arg.value);
        return { kind: "constant", value: result } as Expression<T>;
      }
      return { ...e, arg } as Expression<T>;
    },
    function: (e) => {
      const arg = partialEvalNode(e.arg, bindings);
      if (arg.kind === "constant") {
        const result = evalFunction(e.fn, arg.value);
        return { kind: "constant", value: result } as Expression<T>;
      }
      return { ...e, arg } as Expression<T>;
    },
    derivative: (e) => ({ ...e, expr: partialEvalNode(e.expr, bindings) }) as Expression<T>,
    integral: (e) => ({ ...e, expr: partialEvalNode(e.expr, bindings) }) as Expression<T>,
    limit: (e) => ({ ...e, expr: partialEvalNode(e.expr, bindings) }) as Expression<T>,
    equation: (e) =>
      ({
        ...e,
        left: partialEvalNode(e.left, bindings),
        right: partialEvalNode(e.right, bindings),
      }) as Expression<T>,
    sum: (e) =>
      ({
        ...e,
        expr: partialEvalNode(e.expr, bindings),
        from: partialEvalNode(e.from, bindings),
        to: partialEvalNode(e.to, bindings),
      }) as Expression<T>,
    product: (e) =>
      ({
        ...e,
        expr: partialEvalNode(e.expr, bindings),
        from: partialEvalNode(e.from, bindings),
        to: partialEvalNode(e.to, bindings),
      }) as Expression<T>,
  });
}

/**
 * Check if an expression can be fully evaluated (all variables are bound).
 */
export function canEvaluate<T>(expr: Expression<T>, bindings: Bindings): boolean {
  return match(expr, {
    constant: () => true,
    variable: ({ name }) => name in bindings,
    binary: ({ left, right }) => canEvaluate(left, bindings) && canEvaluate(right, bindings),
    unary: ({ arg }) => canEvaluate(arg, bindings),
    function: ({ arg }) => canEvaluate(arg, bindings),
    derivative: () => false,
    integral: () => false,
    limit: ({ expr: e }) => canEvaluate(e, bindings),
    equation: ({ left, right }) => canEvaluate(left, bindings) && canEvaluate(right, bindings),
    sum: (e) => {
      if (!canEvaluate(e.from, bindings) || !canEvaluate(e.to, bindings)) {
        return false;
      }
      return canEvaluate(e.expr, { ...bindings, [e.variable]: 0 });
    },
    product: (e) => {
      if (!canEvaluate(e.from, bindings) || !canEvaluate(e.to, bindings)) {
        return false;
      }
      return canEvaluate(e.expr, { ...bindings, [e.variable]: 0 });
    },
  });
}

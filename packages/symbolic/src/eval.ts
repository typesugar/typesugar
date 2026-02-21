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
  switch (expr.kind) {
    case "constant":
      return expr.value;

    case "variable":
      return evalVariable(expr.name, bindings, opts);

    case "binary":
      return evalBinary(
        expr.op,
        evalNode(expr.left, bindings, opts),
        evalNode(expr.right, bindings, opts)
      );

    case "unary":
      return evalUnary(expr.op, evalNode(expr.arg, bindings, opts));

    case "function":
      return evalFunction(expr.fn, evalNode(expr.arg, bindings, opts));

    case "derivative":
      throw new Error(
        "Cannot evaluate unevaluated derivative. Use diff() to compute the derivative first."
      );

    case "integral":
      throw new Error(
        "Cannot evaluate unevaluated integral. Use integrate() to compute the integral first."
      );

    case "limit":
      return evalLimit(expr, bindings, opts);

    case "equation":
      throw new Error("Cannot evaluate an equation to a number. Use solve() instead.");

    case "sum":
      return evalSum(expr, bindings, opts);

    case "product":
      return evalProduct(expr, bindings, opts);
  }
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
  switch (expr.kind) {
    case "constant":
      return expr;

    case "variable":
      if (expr.name in bindings) {
        return { kind: "constant", value: bindings[expr.name] } as Expression<T>;
      }
      return expr;

    case "binary": {
      const left = partialEvalNode(expr.left, bindings);
      const right = partialEvalNode(expr.right, bindings);

      // If both sides are constants, evaluate
      if (left.kind === "constant" && right.kind === "constant") {
        const result = evalBinary(expr.op, left.value, right.value);
        return { kind: "constant", value: result } as Expression<T>;
      }

      return { ...expr, left, right } as Expression<T>;
    }

    case "unary": {
      const arg = partialEvalNode(expr.arg, bindings);

      if (arg.kind === "constant") {
        const result = evalUnary(expr.op, arg.value);
        return { kind: "constant", value: result } as Expression<T>;
      }

      return { ...expr, arg } as Expression<T>;
    }

    case "function": {
      const arg = partialEvalNode(expr.arg, bindings);

      if (arg.kind === "constant") {
        const result = evalFunction(expr.fn, arg.value);
        return { kind: "constant", value: result } as Expression<T>;
      }

      return { ...expr, arg } as Expression<T>;
    }

    case "derivative":
    case "integral":
    case "limit":
      return { ...expr, expr: partialEvalNode(expr.expr, bindings) } as Expression<T>;

    case "equation":
      return {
        ...expr,
        left: partialEvalNode(expr.left, bindings),
        right: partialEvalNode(expr.right, bindings),
      } as Expression<T>;

    case "sum":
    case "product":
      return {
        ...expr,
        expr: partialEvalNode(expr.expr, bindings),
        from: partialEvalNode(expr.from, bindings),
        to: partialEvalNode(expr.to, bindings),
      } as Expression<T>;
  }
}

/**
 * Check if an expression can be fully evaluated (all variables are bound).
 */
export function canEvaluate<T>(expr: Expression<T>, bindings: Bindings): boolean {
  switch (expr.kind) {
    case "constant":
      return true;

    case "variable":
      return expr.name in bindings;

    case "binary":
      return canEvaluate(expr.left, bindings) && canEvaluate(expr.right, bindings);

    case "unary":
    case "function":
      return canEvaluate(expr.arg, bindings);

    case "derivative":
    case "integral":
      return false; // Need to compute first

    case "limit":
      return canEvaluate(expr.expr, bindings);

    case "equation":
      return canEvaluate(expr.left, bindings) && canEvaluate(expr.right, bindings);

    case "sum":
    case "product":
      // We can evaluate if bounds are constant and the inner expression
      // can be evaluated when the iteration variable is bound
      if (!canEvaluate(expr.from, bindings) || !canEvaluate(expr.to, bindings)) {
        return false;
      }
      // The inner expression will have the iteration variable bound
      return canEvaluate(expr.expr, { ...bindings, [expr.variable]: 0 });
  }
}

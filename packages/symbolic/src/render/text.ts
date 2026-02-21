/**
 * Plain Text Renderer
 *
 * Converts symbolic expressions to human-readable plain text.
 *
 * @example
 * ```typescript
 * const x = var_("x");
 * toText(add(mul(x, x), const_(1))); // "x^2 + 1"
 * ```
 */

import type { Expression } from "../expression.js";

/**
 * Operator precedence for proper parenthesization.
 * Higher number = higher precedence.
 */
const PRECEDENCE: Record<string, number> = {
  "+": 1,
  "-": 1,
  "*": 2,
  "/": 2,
  "^": 3,
  unary: 4,
  function: 5,
  atom: 6,
};

/**
 * Rendering options for plain text output.
 */
export interface TextOptions {
  /** Use Unicode symbols where available (default: true) */
  unicode?: boolean;
  /** Decimal precision for constants (default: 6) */
  precision?: number;
}

const defaultOptions: Required<TextOptions> = {
  unicode: true,
  precision: 6,
};

/**
 * Convert an expression to plain text.
 */
export function toText<T>(expr: Expression<T>, options: TextOptions = {}): string {
  const opts = { ...defaultOptions, ...options };
  return render(expr, opts, 0);
}

function render<T>(expr: Expression<T>, opts: Required<TextOptions>, parentPrec: number): string {
  const result = renderNode(expr, opts);
  const myPrec = getPrecedence(expr);

  if (myPrec < parentPrec) {
    return `(${result})`;
  }
  return result;
}

function renderNode<T>(expr: Expression<T>, opts: Required<TextOptions>): string {
  switch (expr.kind) {
    case "constant":
      return renderConstant(expr.value, expr.name, opts);

    case "variable":
      return expr.name;

    case "binary":
      return renderBinary(expr, opts);

    case "unary":
      return renderUnary(expr, opts);

    case "function":
      return renderFunction(expr, opts);

    case "derivative":
      return renderDerivative(expr, opts);

    case "integral":
      return renderIntegral(expr, opts);

    case "limit":
      return renderLimit(expr, opts);

    case "equation":
      return `${render(expr.left, opts, 0)} = ${render(expr.right, opts, 0)}`;

    case "sum":
      return renderSum(expr, opts);

    case "product":
      return renderProduct(expr, opts);
  }
}

function renderConstant(
  value: number,
  name: string | undefined,
  opts: Required<TextOptions>
): string {
  if (name) {
    return name;
  }
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toPrecision(opts.precision);
}

function renderBinary<T>(
  expr: Expression<T> & { kind: "binary" },
  opts: Required<TextOptions>
): string {
  const leftStr = render(expr.left, opts, PRECEDENCE[expr.op]);
  const rightPrec = expr.op === "^" ? PRECEDENCE[expr.op] : PRECEDENCE[expr.op] + 0.5;
  const rightStr = render(expr.right, opts, rightPrec);

  switch (expr.op) {
    case "+":
      return `${leftStr} + ${rightStr}`;
    case "-":
      return `${leftStr} - ${rightStr}`;
    case "*":
      return `${leftStr} * ${rightStr}`;
    case "/":
      return `${leftStr} / ${rightStr}`;
    case "^":
      return `${leftStr}^${rightStr}`;
  }
}

function renderUnary<T>(
  expr: Expression<T> & { kind: "unary" },
  opts: Required<TextOptions>
): string {
  const argStr = render(expr.arg, opts, PRECEDENCE.unary);

  switch (expr.op) {
    case "-":
      return `-${argStr}`;
    case "abs":
      return `|${render(expr.arg, opts, 0)}|`;
    case "sqrt":
      return opts.unicode
        ? `√(${render(expr.arg, opts, 0)})`
        : `sqrt(${render(expr.arg, opts, 0)})`;
    case "signum":
      return `sgn(${render(expr.arg, opts, 0)})`;
  }
}

function renderFunction<T>(
  expr: Expression<T> & { kind: "function" },
  opts: Required<TextOptions>
): string {
  const argStr = render(expr.arg, opts, 0);
  return `${expr.fn}(${argStr})`;
}

function renderDerivative<T>(
  expr: Expression<T> & { kind: "derivative" },
  opts: Required<TextOptions>
): string {
  const innerStr = render(expr.expr, opts, 0);
  const v = expr.variable;

  if (expr.order === 1) {
    return `d/d${v}(${innerStr})`;
  }
  return `d^${expr.order}/d${v}^${expr.order}(${innerStr})`;
}

function renderIntegral<T>(
  expr: Expression<T> & { kind: "integral" },
  opts: Required<TextOptions>
): string {
  const innerStr = render(expr.expr, opts, 0);
  const symbol = opts.unicode ? "∫" : "int";
  return `${symbol}(${innerStr}) d${expr.variable}`;
}

function renderLimit<T>(
  expr: Expression<T> & { kind: "limit" },
  opts: Required<TextOptions>
): string {
  const innerStr = render(expr.expr, opts, 0);
  const arrow = opts.unicode ? "→" : "->";
  let approach = `${expr.variable} ${arrow} ${expr.approaching}`;

  if (expr.direction === "left") {
    approach += "⁻";
  } else if (expr.direction === "right") {
    approach += "⁺";
  }

  return `lim[${approach}](${innerStr})`;
}

function renderSum<T>(expr: Expression<T> & { kind: "sum" }, opts: Required<TextOptions>): string {
  const innerStr = render(expr.expr, opts, 0);
  const fromStr = render(expr.from, opts, 0);
  const toStr = render(expr.to, opts, 0);
  const symbol = opts.unicode ? "Σ" : "sum";
  return `${symbol}[${expr.variable}=${fromStr}..${toStr}](${innerStr})`;
}

function renderProduct<T>(
  expr: Expression<T> & { kind: "product" },
  opts: Required<TextOptions>
): string {
  const innerStr = render(expr.expr, opts, 0);
  const fromStr = render(expr.from, opts, 0);
  const toStr = render(expr.to, opts, 0);
  const symbol = opts.unicode ? "Π" : "prod";
  return `${symbol}[${expr.variable}=${fromStr}..${toStr}](${innerStr})`;
}

function getPrecedence<T>(expr: Expression<T>): number {
  switch (expr.kind) {
    case "constant":
    case "variable":
      return PRECEDENCE.atom;
    case "binary":
      return PRECEDENCE[expr.op];
    case "unary":
      return PRECEDENCE.unary;
    case "function":
    case "derivative":
    case "integral":
    case "limit":
    case "sum":
    case "product":
      return PRECEDENCE.function;
    case "equation":
      return 0;
  }
}

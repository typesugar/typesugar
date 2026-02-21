/**
 * LaTeX Renderer
 *
 * Converts symbolic expressions to LaTeX markup for mathematical typesetting.
 *
 * @example
 * ```typescript
 * const x = var_("x");
 * toLatex(add(mul(x, x), const_(1))); // "x^{2} + 1"
 * toLatex(div(const_(1), x));          // "\\frac{1}{x}"
 * ```
 */

import type { Expression, BinaryOp } from "../expression.js";

/**
 * Operator precedence for proper parenthesization.
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
 * Rendering options for LaTeX output.
 */
export interface LatexOptions {
  /** Use \frac for division (default: true) */
  useFrac?: boolean;
  /** Use \cdot for multiplication (default: false) */
  useCdot?: boolean;
  /** Use implicit multiplication where possible (default: true) */
  implicitMul?: boolean;
  /** Decimal precision for constants (default: 6) */
  precision?: number;
}

const defaultOptions: Required<LatexOptions> = {
  useFrac: true,
  useCdot: false,
  implicitMul: true,
  precision: 6,
};

/**
 * Convert an expression to LaTeX.
 */
export function toLatex<T>(expr: Expression<T>, options: LatexOptions = {}): string {
  const opts = { ...defaultOptions, ...options };
  return render(expr, opts, 0);
}

function render<T>(expr: Expression<T>, opts: Required<LatexOptions>, parentPrec: number): string {
  const result = renderNode(expr, opts);
  const myPrec = getPrecedence(expr);

  if (myPrec < parentPrec) {
    return `\\left(${result}\\right)`;
  }
  return result;
}

function renderNode<T>(expr: Expression<T>, opts: Required<LatexOptions>): string {
  switch (expr.kind) {
    case "constant":
      return renderConstant(expr.value, expr.name, opts);

    case "variable":
      return renderVariable(expr.name);

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
  opts: Required<LatexOptions>
): string {
  if (name) {
    const knownSymbols: Record<string, string> = {
      π: "\\pi",
      e: "e",
      φ: "\\phi",
      "∞": "\\infty",
      "½": "\\frac{1}{2}",
    };
    return knownSymbols[name] || name;
  }
  if (Number.isInteger(value)) {
    return String(value);
  }
  if (value === Math.PI) {
    return "\\pi";
  }
  if (value === Math.E) {
    return "e";
  }
  return value.toPrecision(opts.precision);
}

function renderVariable(name: string): string {
  if (name.length === 1) {
    return name;
  }
  // Multi-character variable names get \text{}
  const greekLetters: Record<string, string> = {
    alpha: "\\alpha",
    beta: "\\beta",
    gamma: "\\gamma",
    delta: "\\delta",
    epsilon: "\\epsilon",
    zeta: "\\zeta",
    eta: "\\eta",
    theta: "\\theta",
    iota: "\\iota",
    kappa: "\\kappa",
    lambda: "\\lambda",
    mu: "\\mu",
    nu: "\\nu",
    xi: "\\xi",
    omicron: "\\omicron",
    pi: "\\pi",
    rho: "\\rho",
    sigma: "\\sigma",
    tau: "\\tau",
    upsilon: "\\upsilon",
    phi: "\\phi",
    chi: "\\chi",
    psi: "\\psi",
    omega: "\\omega",
  };

  if (greekLetters[name.toLowerCase()]) {
    return greekLetters[name.toLowerCase()];
  }

  // Check for subscript notation like x_1, x_n
  const subscriptMatch = name.match(/^([a-zA-Z]+)_(\w+)$/);
  if (subscriptMatch) {
    const [, base, subscript] = subscriptMatch;
    return `${base}_{${subscript}}`;
  }

  return `\\text{${name}}`;
}

function renderBinary<T>(
  expr: BinaryOp<unknown, unknown, T>,
  opts: Required<LatexOptions>
): string {
  switch (expr.op) {
    case "+":
      return `${render(expr.left, opts, PRECEDENCE["+"])} + ${render(expr.right, opts, PRECEDENCE["+"] + 0.5)}`;

    case "-":
      return `${render(expr.left, opts, PRECEDENCE["-"])} - ${render(expr.right, opts, PRECEDENCE["-"] + 0.5)}`;

    case "*":
      return renderMultiplication(expr.left, expr.right, opts);

    case "/":
      return renderDivision(expr.left, expr.right, opts);

    case "^":
      return renderPower(expr.left, expr.right, opts);
  }
}

function renderMultiplication<T>(
  left: Expression<unknown>,
  right: Expression<unknown>,
  opts: Required<LatexOptions>
): string {
  const leftStr = render(left, opts, PRECEDENCE["*"]);
  const rightStr = render(right, opts, PRECEDENCE["*"] + 0.5);

  if (opts.implicitMul && canUseImplicitMul(left, right)) {
    return `${leftStr} ${rightStr}`;
  }

  if (opts.useCdot) {
    return `${leftStr} \\cdot ${rightStr}`;
  }

  return `${leftStr} \\times ${rightStr}`;
}

function canUseImplicitMul<T>(left: Expression<T>, right: Expression<T>): boolean {
  const rightIsVar = right.kind === "variable" || right.kind === "function";
  const leftIsConst = left.kind === "constant";
  const rightIsConst = right.kind === "constant";

  return rightIsVar && !rightIsConst && (leftIsConst || left.kind === "variable");
}

function renderDivision(
  left: Expression<unknown>,
  right: Expression<unknown>,
  opts: Required<LatexOptions>
): string {
  if (opts.useFrac) {
    return `\\frac{${render(left, opts, 0)}}{${render(right, opts, 0)}}`;
  }
  return `${render(left, opts, PRECEDENCE["/"])} / ${render(right, opts, PRECEDENCE["/"] + 0.5)}`;
}

function renderPower(
  left: Expression<unknown>,
  right: Expression<unknown>,
  opts: Required<LatexOptions>
): string {
  const baseStr = render(left, opts, PRECEDENCE["^"] + 0.5);
  const expStr = render(right, opts, 0);

  // Simple exponents don't need braces
  if (
    right.kind === "constant" &&
    Number.isInteger(right.value) &&
    right.value >= 0 &&
    right.value <= 9
  ) {
    return `${baseStr}^${right.value}`;
  }

  return `${baseStr}^{${expStr}}`;
}

function renderUnary<T>(
  expr: Expression<T> & { kind: "unary" },
  opts: Required<LatexOptions>
): string {
  switch (expr.op) {
    case "-":
      return `-${render(expr.arg, opts, PRECEDENCE.unary)}`;
    case "abs":
      return `\\left|${render(expr.arg, opts, 0)}\\right|`;
    case "sqrt":
      return `\\sqrt{${render(expr.arg, opts, 0)}}`;
    case "signum":
      return `\\operatorname{sgn}\\left(${render(expr.arg, opts, 0)}\\right)`;
  }
}

function renderFunction<T>(
  expr: Expression<T> & { kind: "function" },
  opts: Required<LatexOptions>
): string {
  const argStr = render(expr.arg, opts, 0);

  const functionCommands: Record<string, string> = {
    sin: "\\sin",
    cos: "\\cos",
    tan: "\\tan",
    asin: "\\arcsin",
    acos: "\\arccos",
    atan: "\\arctan",
    sinh: "\\sinh",
    cosh: "\\cosh",
    tanh: "\\tanh",
    exp: "\\exp",
    log: "\\log",
    ln: "\\ln",
    log10: "\\log_{10}",
    log2: "\\log_{2}",
    floor: "\\lfloor",
    ceil: "\\lceil",
    round: "\\text{round}",
  };

  const cmd = functionCommands[expr.fn] || `\\text{${expr.fn}}`;

  // Special handling for floor and ceil
  if (expr.fn === "floor") {
    return `\\lfloor ${argStr} \\rfloor`;
  }
  if (expr.fn === "ceil") {
    return `\\lceil ${argStr} \\rceil`;
  }

  return `${cmd}\\left(${argStr}\\right)`;
}

function renderDerivative<T>(
  expr: Expression<T> & { kind: "derivative" },
  opts: Required<LatexOptions>
): string {
  const innerStr = render(expr.expr, opts, 0);
  const v = expr.variable;

  if (expr.order === 1) {
    return `\\frac{d}{d${v}}\\left(${innerStr}\\right)`;
  }
  return `\\frac{d^{${expr.order}}}{d${v}^{${expr.order}}}\\left(${innerStr}\\right)`;
}

function renderIntegral<T>(
  expr: Expression<T> & { kind: "integral" },
  opts: Required<LatexOptions>
): string {
  const innerStr = render(expr.expr, opts, 0);
  return `\\int ${innerStr} \\, d${expr.variable}`;
}

function renderLimit<T>(
  expr: Expression<T> & { kind: "limit" },
  opts: Required<LatexOptions>
): string {
  const innerStr = render(expr.expr, opts, 0);
  let approach = `${expr.variable} \\to ${expr.approaching}`;

  if (expr.direction === "left") {
    approach += "^{-}";
  } else if (expr.direction === "right") {
    approach += "^{+}";
  }

  return `\\lim_{${approach}} ${innerStr}`;
}

function renderSum<T>(expr: Expression<T> & { kind: "sum" }, opts: Required<LatexOptions>): string {
  const innerStr = render(expr.expr, opts, 0);
  const fromStr = render(expr.from, opts, 0);
  const toStr = render(expr.to, opts, 0);
  return `\\sum_{${expr.variable}=${fromStr}}^{${toStr}} ${innerStr}`;
}

function renderProduct<T>(
  expr: Expression<T> & { kind: "product" },
  opts: Required<LatexOptions>
): string {
  const innerStr = render(expr.expr, opts, 0);
  const fromStr = render(expr.from, opts, 0);
  const toStr = render(expr.to, opts, 0);
  return `\\prod_{${expr.variable}=${fromStr}}^{${toStr}} ${innerStr}`;
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

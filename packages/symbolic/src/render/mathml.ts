/**
 * MathML Renderer
 *
 * Converts symbolic expressions to MathML for web display.
 *
 * @example
 * ```typescript
 * const x = var_("x");
 * toMathML(add(mul(x, x), const_(1)));
 * // <math><mrow><msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><mn>1</mn></mrow></math>
 * ```
 */

import type { Expression } from "../expression.js";

/**
 * Rendering options for MathML output.
 */
export interface MathMLOptions {
  /** Include display="block" attribute (default: false) */
  displayBlock?: boolean;
  /** Decimal precision for constants (default: 6) */
  precision?: number;
}

const defaultOptions: Required<MathMLOptions> = {
  displayBlock: false,
  precision: 6,
};

/**
 * Convert an expression to MathML.
 */
export function toMathML<T>(expr: Expression<T>, options: MathMLOptions = {}): string {
  const opts = { ...defaultOptions, ...options };
  const displayAttr = opts.displayBlock ? ' display="block"' : "";
  const content = render(expr, opts);
  return `<math${displayAttr}>${content}</math>`;
}

function render<T>(expr: Expression<T>, opts: Required<MathMLOptions>): string {
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
      return `<mrow>${render(expr.left, opts)}<mo>=</mo>${render(expr.right, opts)}</mrow>`;

    case "sum":
      return renderSum(expr, opts);

    case "product":
      return renderProduct(expr, opts);
  }
}

function renderConstant(
  value: number,
  name: string | undefined,
  opts: Required<MathMLOptions>
): string {
  if (name) {
    const knownEntities: Record<string, string> = {
      π: "<mi>&pi;</mi>",
      e: "<mi>e</mi>",
      φ: "<mi>&phi;</mi>",
      "∞": "<mi>&infin;</mi>",
      "½": "<mfrac><mn>1</mn><mn>2</mn></mfrac>",
    };
    return knownEntities[name] || `<mi>${name}</mi>`;
  }
  if (Number.isInteger(value)) {
    return `<mn>${value}</mn>`;
  }
  return `<mn>${value.toPrecision(opts.precision)}</mn>`;
}

function renderVariable(name: string): string {
  // Handle subscripts like x_1
  const subscriptMatch = name.match(/^([a-zA-Z]+)_(\w+)$/);
  if (subscriptMatch) {
    const [, base, subscript] = subscriptMatch;
    return `<msub><mi>${base}</mi><mn>${subscript}</mn></msub>`;
  }
  return `<mi>${name}</mi>`;
}

function renderBinary<T>(
  expr: Expression<T> & { kind: "binary" },
  opts: Required<MathMLOptions>
): string {
  switch (expr.op) {
    case "+":
      return `<mrow>${render(expr.left, opts)}<mo>+</mo>${render(expr.right, opts)}</mrow>`;

    case "-":
      return `<mrow>${render(expr.left, opts)}<mo>-</mo>${render(expr.right, opts)}</mrow>`;

    case "*":
      return `<mrow>${render(expr.left, opts)}<mo>&times;</mo>${render(expr.right, opts)}</mrow>`;

    case "/":
      return `<mfrac>${render(expr.left, opts)}${render(expr.right, opts)}</mfrac>`;

    case "^":
      return `<msup>${render(expr.left, opts)}${render(expr.right, opts)}</msup>`;
  }
}

function renderUnary<T>(
  expr: Expression<T> & { kind: "unary" },
  opts: Required<MathMLOptions>
): string {
  switch (expr.op) {
    case "-":
      return `<mrow><mo>-</mo>${render(expr.arg, opts)}</mrow>`;

    case "abs":
      return `<mrow><mo>|</mo>${render(expr.arg, opts)}<mo>|</mo></mrow>`;

    case "sqrt":
      return `<msqrt>${render(expr.arg, opts)}</msqrt>`;

    case "signum":
      return `<mrow><mi>sgn</mi><mo>(</mo>${render(expr.arg, opts)}<mo>)</mo></mrow>`;
  }
}

function renderFunction<T>(
  expr: Expression<T> & { kind: "function" },
  opts: Required<MathMLOptions>
): string {
  const argContent = render(expr.arg, opts);

  // Special handling for floor and ceil
  if (expr.fn === "floor") {
    return `<mrow><mo>&lfloor;</mo>${argContent}<mo>&rfloor;</mo></mrow>`;
  }
  if (expr.fn === "ceil") {
    return `<mrow><mo>&lceil;</mo>${argContent}<mo>&rceil;</mo></mrow>`;
  }

  // Map function names
  const fnNames: Record<string, string> = {
    sin: "sin",
    cos: "cos",
    tan: "tan",
    asin: "arcsin",
    acos: "arccos",
    atan: "arctan",
    sinh: "sinh",
    cosh: "cosh",
    tanh: "tanh",
    exp: "exp",
    log: "log",
    ln: "ln",
    log10: "log",
    log2: "log",
    round: "round",
  };

  const fnName = fnNames[expr.fn] || expr.fn;

  // Handle log with base
  if (expr.fn === "log10") {
    return `<mrow><msub><mo>log</mo><mn>10</mn></msub><mo>&ApplyFunction;</mo><mfenced>${argContent}</mfenced></mrow>`;
  }
  if (expr.fn === "log2") {
    return `<mrow><msub><mo>log</mo><mn>2</mn></msub><mo>&ApplyFunction;</mo><mfenced>${argContent}</mfenced></mrow>`;
  }

  return `<mrow><mo>${fnName}</mo><mo>&ApplyFunction;</mo><mfenced>${argContent}</mfenced></mrow>`;
}

function renderDerivative<T>(
  expr: Expression<T> & { kind: "derivative" },
  opts: Required<MathMLOptions>
): string {
  const innerContent = render(expr.expr, opts);
  const v = expr.variable;

  if (expr.order === 1) {
    return `<mrow><mfrac><mi>d</mi><mrow><mi>d</mi><mi>${v}</mi></mrow></mfrac><mfenced>${innerContent}</mfenced></mrow>`;
  }
  return `<mrow><mfrac><msup><mi>d</mi><mn>${expr.order}</mn></msup><mrow><mi>d</mi><msup><mi>${v}</mi><mn>${expr.order}</mn></msup></mrow></mfrac><mfenced>${innerContent}</mfenced></mrow>`;
}

function renderIntegral<T>(
  expr: Expression<T> & { kind: "integral" },
  opts: Required<MathMLOptions>
): string {
  const innerContent = render(expr.expr, opts);
  return `<mrow><mo>&int;</mo>${innerContent}<mi>d</mi><mi>${expr.variable}</mi></mrow>`;
}

function renderLimit<T>(
  expr: Expression<T> & { kind: "limit" },
  opts: Required<MathMLOptions>
): string {
  const innerContent = render(expr.expr, opts);
  let underContent = `<mi>${expr.variable}</mi><mo>&rarr;</mo><mn>${expr.approaching}</mn>`;

  if (expr.direction === "left") {
    underContent += `<msup><mrow></mrow><mo>-</mo></msup>`;
  } else if (expr.direction === "right") {
    underContent += `<msup><mrow></mrow><mo>+</mo></msup>`;
  }

  return `<mrow><munder><mo>lim</mo><mrow>${underContent}</mrow></munder>${innerContent}</mrow>`;
}

function renderSum<T>(
  expr: Expression<T> & { kind: "sum" },
  opts: Required<MathMLOptions>
): string {
  const innerContent = render(expr.expr, opts);
  const fromContent = render(expr.from, opts);
  const toContent = render(expr.to, opts);

  return `<mrow><munderover><mo>&Sum;</mo><mrow><mi>${expr.variable}</mi><mo>=</mo>${fromContent}</mrow>${toContent}</munderover>${innerContent}</mrow>`;
}

function renderProduct<T>(
  expr: Expression<T> & { kind: "product" },
  opts: Required<MathMLOptions>
): string {
  const innerContent = render(expr.expr, opts);
  const fromContent = render(expr.from, opts);
  const toContent = render(expr.to, opts);

  return `<mrow><munderover><mo>&Prod;</mo><mrow><mi>${expr.variable}</mi><mo>=</mo>${fromContent}</mrow>${toContent}</munderover>${innerContent}</mrow>`;
}

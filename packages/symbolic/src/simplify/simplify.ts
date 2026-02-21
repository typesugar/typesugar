/**
 * Expression Simplification
 *
 * Bottom-up recursive simplification with configurable rules.
 *
 * @example
 * ```typescript
 * const x = var_("x");
 * simplify(add(x, ZERO));           // x
 * simplify(mul(const_(2), const_(3))); // 6
 * ```
 */

import type { Expression } from "../expression.js";
import { hasVariable } from "../expression.js";
import { simplificationRules, expressionsEqual, type SimplificationRule } from "./rules.js";

/**
 * Simplification options.
 */
export interface SimplifyOptions {
  /** Maximum iterations to prevent infinite loops (default: 100) */
  maxIterations?: number;
  /** Custom rules to apply (in addition to built-in rules) */
  customRules?: SimplificationRule[];
  /** Only use custom rules, ignore built-in rules */
  customOnly?: boolean;
}

const defaultOptions: Required<SimplifyOptions> = {
  maxIterations: 100,
  customRules: [],
  customOnly: false,
};

/**
 * Simplify an expression by recursively applying simplification rules.
 *
 * @param expr - The expression to simplify
 * @param options - Simplification options
 * @returns The simplified expression
 */
export function simplify<T>(expr: Expression<T>, options: SimplifyOptions = {}): Expression<T> {
  const opts = { ...defaultOptions, ...options };
  const rules = opts.customOnly ? opts.customRules : [...simplificationRules, ...opts.customRules];

  let current = expr;
  let iterations = 0;

  while (iterations < opts.maxIterations) {
    const simplified = simplifyOnce(current, rules);

    if (expressionsEqual(simplified, current)) {
      break;
    }

    current = simplified as Expression<T>;
    iterations++;
  }

  return current;
}

/**
 * Apply one round of simplification (bottom-up).
 */
function simplifyOnce<T>(expr: Expression<T>, rules: SimplificationRule[]): Expression<T> {
  // First, recursively simplify children
  const simplified = simplifyChildren(expr, rules);

  // Then apply rules to the current node
  return applyRules(simplified, rules);
}

/**
 * Recursively simplify child expressions.
 */
function simplifyChildren<T>(expr: Expression<T>, rules: SimplificationRule[]): Expression<T> {
  switch (expr.kind) {
    case "constant":
    case "variable":
      return expr;

    case "binary":
      return {
        ...expr,
        left: simplifyOnce(expr.left, rules),
        right: simplifyOnce(expr.right, rules),
      } as Expression<T>;

    case "unary":
      return {
        ...expr,
        arg: simplifyOnce(expr.arg, rules),
      } as Expression<T>;

    case "function":
      return {
        ...expr,
        arg: simplifyOnce(expr.arg, rules),
      } as Expression<T>;

    case "derivative":
    case "integral":
      return {
        ...expr,
        expr: simplifyOnce(expr.expr, rules),
      } as Expression<T>;

    case "limit":
      return {
        ...expr,
        expr: simplifyOnce(expr.expr, rules),
      } as Expression<T>;

    case "equation":
      return {
        ...expr,
        left: simplifyOnce(expr.left, rules),
        right: simplifyOnce(expr.right, rules),
      } as Expression<T>;

    case "sum":
    case "product":
      return {
        ...expr,
        expr: simplifyOnce(expr.expr, rules),
        from: simplifyOnce(expr.from, rules),
        to: simplifyOnce(expr.to, rules),
      } as Expression<T>;
  }
}

/**
 * Apply all rules to an expression until none apply.
 */
function applyRules<T>(expr: Expression<T>, rules: SimplificationRule[]): Expression<T> {
  let current = expr as Expression<unknown>;

  for (const rule of rules) {
    const result = rule(current);
    if (result !== null) {
      // Rule applied, restart from beginning of rules
      current = result;
    }
  }

  return current as Expression<T>;
}

/**
 * Expand an expression (opposite of simplify in some sense).
 * Applies distributive law and expands powers.
 */
export function expand<T>(expr: Expression<T>): Expression<T> {
  return expandNode(expr) as Expression<T>;
}

function expandNode(expr: Expression<unknown>): Expression<unknown> {
  switch (expr.kind) {
    case "constant":
    case "variable":
      return expr;

    case "binary":
      return expandBinary(expr);

    case "unary":
      return {
        ...expr,
        arg: expandNode(expr.arg),
      };

    case "function":
      return {
        ...expr,
        arg: expandNode(expr.arg),
      };

    default:
      return expr;
  }
}

function expandBinary(expr: Expression<unknown> & { kind: "binary" }): Expression<unknown> {
  const left = expandNode(expr.left);
  const right = expandNode(expr.right);

  if (expr.op === "*") {
    // Distributive law: a * (b + c) = a*b + a*c
    if (right.kind === "binary" && right.op === "+") {
      return {
        kind: "binary",
        op: "+",
        left: expandNode({ kind: "binary", op: "*", left, right: right.left }),
        right: expandNode({ kind: "binary", op: "*", left, right: right.right }),
      };
    }
    // (a + b) * c = a*c + b*c
    if (left.kind === "binary" && left.op === "+") {
      return {
        kind: "binary",
        op: "+",
        left: expandNode({ kind: "binary", op: "*", left: left.left, right }),
        right: expandNode({ kind: "binary", op: "*", left: left.right, right }),
      };
    }
  }

  return { ...expr, left, right };
}

/**
 * Collect like terms in a polynomial expression.
 */
export function collectTerms<T>(expr: Expression<T>, variable: string): Expression<T> {
  // This is a simplified implementation that works for basic cases
  const terms = extractTerms(expr, variable);
  return buildPolynomial(terms, variable) as Expression<T>;
}

interface PolynomialTerm {
  coefficient: number;
  power: number;
}

function extractTerms(expr: Expression<unknown>, v: string): Map<number, number> {
  const terms = new Map<number, number>();

  function addTerm(coeff: number, power: number) {
    const existing = terms.get(power) || 0;
    terms.set(power, existing + coeff);
  }

  function extract(e: Expression<unknown>, multiplier: number): void {
    switch (e.kind) {
      case "constant":
        addTerm(multiplier * e.value, 0);
        break;

      case "variable":
        if (e.name === v) {
          addTerm(multiplier, 1);
        } else {
          addTerm(multiplier, 0);
        }
        break;

      case "binary":
        if (e.op === "+") {
          extract(e.left, multiplier);
          extract(e.right, multiplier);
        } else if (e.op === "-") {
          extract(e.left, multiplier);
          extract(e.right, -multiplier);
        } else if (e.op === "*") {
          extractProduct(e.left, e.right, multiplier);
        } else if (e.op === "^") {
          if (e.left.kind === "variable" && e.left.name === v && e.right.kind === "constant") {
            addTerm(multiplier, e.right.value);
          } else if (!hasVariable(e, v)) {
            addTerm(multiplier, 0);
          } else {
            throw new Error(
              `Cannot collect terms: non-polynomial power expression in variable '${v}'`
            );
          }
        } else if (e.op === "/") {
          if (e.right.kind === "constant") {
            extract(e.left, multiplier / e.right.value);
          } else if (!hasVariable(e.right, v)) {
            extract(e.left, multiplier);
          } else {
            throw new Error(`Cannot collect terms: variable '${v}' appears in denominator`);
          }
        }
        break;

      case "unary":
        if (e.op === "-") {
          extract(e.arg, -multiplier);
        } else {
          throw new Error(
            `Cannot collect terms: unsupported unary '${e.op}' in polynomial for '${v}'`
          );
        }
        break;

      case "function":
        if (!hasVariable(e, v)) {
          addTerm(multiplier, 0);
        } else {
          throw new Error(
            `Cannot collect terms: function '${e.fn}' contains variable '${v}' (not a polynomial)`
          );
        }
        break;

      default:
        throw new Error(`Cannot collect terms: unsupported expression kind '${e.kind}'`);
    }
  }

  function extractProduct(
    left: Expression<unknown>,
    right: Expression<unknown>,
    multiplier: number
  ): void {
    // constant * expr
    if (left.kind === "constant") {
      extract(right, multiplier * left.value);
      return;
    }
    // expr * constant
    if (right.kind === "constant") {
      extract(left, multiplier * right.value);
      return;
    }
    // variable * variable
    if (
      left.kind === "variable" &&
      right.kind === "variable" &&
      left.name === v &&
      right.name === v
    ) {
      addTerm(multiplier, 2);
      return;
    }
  }

  extract(expr, 1);
  return terms;
}

function buildPolynomial(terms: Map<number, number>, v: string): Expression<unknown> {
  const sortedPowers = Array.from(terms.keys()).sort((a, b) => b - a);

  if (sortedPowers.length === 0) {
    return { kind: "constant", value: 0 };
  }

  let result: Expression<unknown> | null = null;

  for (const power of sortedPowers) {
    const coeff = terms.get(power)!;
    if (coeff === 0) continue;

    let term: Expression<unknown>;

    if (power === 0) {
      term = { kind: "constant", value: coeff };
    } else if (power === 1) {
      if (coeff === 1) {
        term = { kind: "variable", name: v };
      } else if (coeff === -1) {
        term = { kind: "unary", op: "-", arg: { kind: "variable", name: v } };
      } else {
        term = {
          kind: "binary",
          op: "*",
          left: { kind: "constant", value: coeff },
          right: { kind: "variable", name: v },
        };
      }
    } else {
      const powerExpr: Expression<unknown> = {
        kind: "binary",
        op: "^",
        left: { kind: "variable", name: v },
        right: { kind: "constant", value: power },
      };

      if (coeff === 1) {
        term = powerExpr;
      } else if (coeff === -1) {
        term = { kind: "unary", op: "-", arg: powerExpr };
      } else {
        term = {
          kind: "binary",
          op: "*",
          left: { kind: "constant", value: coeff },
          right: powerExpr,
        };
      }
    }

    if (result === null) {
      result = term;
    } else {
      result = { kind: "binary", op: "+", left: result, right: term };
    }
  }

  return result || { kind: "constant", value: 0 };
}

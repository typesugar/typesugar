/**
 * Red Team Tests for @typesugar/symbolic
 *
 * Attack surfaces:
 * - Division by zero in evaluation
 * - NaN/Infinity propagation
 * - Differentiation edge cases
 * - Circular references in expression trees
 * - Deeply nested expressions
 * - Special functions at domain boundaries
 * - Simplification soundness (0/0, 0^0)
 * - Pattern matching edge cases
 * - Equation solving failures
 * - Integration domain errors
 * - Builder input validation
 * - Rendering of special values
 * - Free vs bound variable tracking
 */
import { describe, it, expect } from "vitest";
import {
  var_,
  const_,
  add,
  sub,
  mul,
  div,
  pow,
  neg,
  sqrt,
  sin,
  cos,
  tan,
  ln,
  exp,
  log,
  log10,
  abs,
  sum,
  product,
  limit,
  equation,
  derivative,
  integral,
  ZERO,
  ONE,
  TWO,
  PI,
  E,
  numericExpr,
} from "../packages/symbolic/src/builders.js";
import { evaluate, partialEvaluate, canEvaluate } from "../packages/symbolic/src/eval.js";
import { diff, nthDiff } from "../packages/symbolic/src/calculus/diff.js";
import {
  integrate,
  tryIntegrate,
  definiteIntegral,
} from "../packages/symbolic/src/calculus/integrate.js";
import {
  computeLimit,
  leftLimit,
  rightLimit,
  limitExists,
} from "../packages/symbolic/src/calculus/limit.js";
import { simplify, expand, collectTerms } from "../packages/symbolic/src/simplify/simplify.js";
import { toText } from "../packages/symbolic/src/render/text.js";
import { toLatex } from "../packages/symbolic/src/render/latex.js";
import { toMathML } from "../packages/symbolic/src/render/mathml.js";
import {
  match,
  patternVar,
  rule,
  rewrite,
  findAll,
  applyRule,
} from "../packages/symbolic/src/pattern.js";
import { solve, solveSystem } from "../packages/symbolic/src/solve.js";
import {
  isConstant,
  isVariable,
  isBinaryOp,
  isZero,
  isOne,
  getVariables,
  getAllVariables,
  hasVariable,
  depth,
  nodeCount,
  isPureConstant,
} from "../packages/symbolic/src/expression.js";

describe("Symbolic Evaluation Edge Cases", () => {
  // ==========================================================================
  // Attack 1: Division by Zero
  // ==========================================================================
  describe("Division by zero", () => {
    it("Division by zero constant throws at construction", () => {
      const x = var_("x");
      // div() validates at construction time - zero constant divisor is rejected
      expect(() => div(x, const_(0))).toThrow("Division by zero");
    });

    it("Division by zero variable throws", () => {
      const x = var_("x");
      const y = var_("y");
      const expr = div(x, y);

      expect(() => evaluate(expr, { x: 5, y: 0 })).toThrow("Division by zero");
    });

    it("Division by expression that evaluates to zero", () => {
      const x = var_("x");
      const expr = div(const_(10), sub(x, x)); // 10 / (x - x) = 10/0

      expect(() => evaluate(expr, { x: 5 })).toThrow("Division by zero");
    });

    it("0/0 is rejected at construction (not deferred to evaluation)", () => {
      // div() validates at construction time - zero constant divisor is rejected
      expect(() => div(const_(0), const_(0))).toThrow("Division by zero");
    });
  });

  // ==========================================================================
  // Attack 2: Square Root of Negative Numbers
  // ==========================================================================
  describe("Square root edge cases", () => {
    it("Square root of negative number throws", () => {
      const expr = sqrt(const_(-1));

      expect(() => evaluate(expr, {})).toThrow("Square root of negative number");
    });

    it("Square root of negative variable throws", () => {
      const x = var_("x");
      const expr = sqrt(x);

      expect(() => evaluate(expr, { x: -4 })).toThrow("Square root of negative number");
    });

    it("Square root of zero is zero", () => {
      const expr = sqrt(ZERO);

      expect(evaluate(expr, {})).toBe(0);
    });

    it("Square root of very small positive number", () => {
      const expr = sqrt(const_(1e-300));

      expect(evaluate(expr, {})).toBeCloseTo(Math.sqrt(1e-300));
    });
  });

  // ==========================================================================
  // Attack 3: Logarithm Domain Errors
  // ==========================================================================
  describe("Logarithm edge cases", () => {
    it("Log of zero throws", () => {
      const expr = ln(ZERO);

      expect(() => evaluate(expr, {})).toThrow("Logarithm of non-positive number");
    });

    it("Log of negative number throws", () => {
      const x = var_("x");
      const expr = ln(x);

      expect(() => evaluate(expr, { x: -1 })).toThrow("Logarithm of non-positive number");
    });

    it("Log10 of zero throws", () => {
      const expr = log10(ZERO);

      expect(() => evaluate(expr, {})).toThrow("Logarithm of non-positive number");
    });

    it("Log of very small positive number", () => {
      const expr = ln(const_(1e-300));

      const result = evaluate(expr, {});
      expect(result).toBeLessThan(0);
      expect(Number.isFinite(result)).toBe(true);
    });
  });

  // ==========================================================================
  // Attack 4: NaN and Infinity Propagation
  // ==========================================================================
  describe("NaN and Infinity handling", () => {
    it("Infinity in bindings", () => {
      const x = var_("x");
      const expr = mul(x, const_(2));

      const result = evaluate(expr, { x: Infinity });
      expect(result).toBe(Infinity);
    });

    it("Negative infinity in bindings", () => {
      const x = var_("x");
      const expr = add(x, const_(1));

      const result = evaluate(expr, { x: -Infinity });
      expect(result).toBe(-Infinity);
    });

    it("NaN in bindings propagates", () => {
      const x = var_("x");
      const expr = add(x, const_(1));

      const result = evaluate(expr, { x: NaN });
      expect(Number.isNaN(result)).toBe(true);
    });

    it("Infinity - Infinity is NaN", () => {
      const x = var_("x");
      const expr = sub(x, x);

      const result = evaluate(expr, { x: Infinity });
      expect(Number.isNaN(result)).toBe(true);
    });

    it("0 * Infinity is NaN", () => {
      const x = var_("x");
      const y = var_("y");
      const expr = mul(x, y);

      const result = evaluate(expr, { x: 0, y: Infinity });
      expect(Number.isNaN(result)).toBe(true);
    });
  });

  // ==========================================================================
  // Attack 5: Power Edge Cases
  // ==========================================================================
  describe("Power edge cases", () => {
    it("0^0 is 1 in JavaScript", () => {
      const expr = pow(const_(0), const_(0));

      expect(evaluate(expr, {})).toBe(1);
    });

    it("0^negative is Infinity", () => {
      const expr = pow(const_(0), const_(-1));

      expect(evaluate(expr, {})).toBe(Infinity);
    });

    it("Negative base with fractional exponent is NaN", () => {
      const expr = pow(const_(-2), const_(0.5));

      const result = evaluate(expr, {});
      expect(Number.isNaN(result)).toBe(true);
    });

    it("Very large exponent causes overflow", () => {
      const expr = pow(const_(2), const_(1024));

      const result = evaluate(expr, {});
      expect(result).toBe(Infinity);
    });
  });

  // ==========================================================================
  // Attack 6: Sum and Product Bounds
  // ==========================================================================
  describe("Sum and product bounds edge cases", () => {
    it("Sum with reversed bounds (from > to)", () => {
      const i = var_("i");
      const expr = sum(i, "i", const_(5), const_(1));

      const result = evaluate(expr, {});
      expect(result).toBe(0);
    });

    it("Product with reversed bounds", () => {
      const i = var_("i");
      const expr = product(i, "i", const_(5), const_(1));

      const result = evaluate(expr, {});
      expect(result).toBe(1);
    });

    it("Sum with non-integer bounds rounds", () => {
      const i = var_("i");
      const expr = sum(i, "i", const_(1.7), const_(3.2));

      const result = evaluate(expr, {});
      expect(result).toBe(2 + 3);
    });

    it("Sum over small range", () => {
      const i = var_("i");
      const expr = sum(i, "i", const_(1), const_(5));

      const result = evaluate(expr, {});
      expect(result).toBe(1 + 2 + 3 + 4 + 5);
    });

    it("Product over small range", () => {
      const i = var_("i");
      const expr = product(i, "i", const_(1), const_(5));

      const result = evaluate(expr, {});
      expect(result).toBe(120);
    });
  });

  // ==========================================================================
  // Attack 7: Limit Edge Cases
  // ==========================================================================
  describe("Limit evaluation edge cases", () => {
    it("Limit of 1/x as x->0 (discontinuous) throws", () => {
      const x = var_("x");
      const expr = limit(div(ONE, x), "x", 0);

      expect(() => evaluate(expr, {})).toThrow();
    });

    it("Limit from left returns very large negative", () => {
      const x = var_("x");
      const expr = limit(div(ONE, x), "x", 0, "left");

      const result = evaluate(expr, {});
      expect(result).toBeLessThan(-1e9);
    });

    it("Limit from right returns very large positive", () => {
      const x = var_("x");
      const expr = limit(div(ONE, x), "x", 0, "right");

      const result = evaluate(expr, {});
      expect(result).toBeGreaterThan(1e9);
    });

    it("Limit that exists (continuous function)", () => {
      const x = var_("x");
      const expr = limit(pow(x, const_(2)), "x", 3);

      const result = evaluate(expr, {});
      expect(result).toBeCloseTo(9);
    });
  });

  // ==========================================================================
  // Attack 8: Unbound Variables
  // ==========================================================================
  describe("Unbound variable handling", () => {
    it("Unbound variable throws in strict mode", () => {
      const x = var_("x");
      const expr = add(x, ONE);

      expect(() => evaluate(expr, {})).toThrow("Variable 'x' is not bound");
    });

    it("Unbound variable uses default in non-strict mode", () => {
      const x = var_("x");
      const expr = add(x, ONE);

      const result = evaluate(expr, {}, { strict: false, defaultValue: 10 });
      expect(result).toBe(11);
    });

    it("Typo in variable name", () => {
      const x = var_("x");
      const expr = add(x, ONE);

      expect(() => evaluate(expr, { X: 5 })).toThrow("Variable 'x' is not bound");
    });
  });
});

describe("Symbolic Differentiation Edge Cases", () => {
  // ==========================================================================
  // Attack 9: Differentiation of Undefined Functions
  // ==========================================================================
  describe("Differentiation special cases", () => {
    it("Derivative of constant is zero", () => {
      const expr = const_(42);
      const deriv = diff(expr, "x");

      expect(evaluate(deriv, {})).toBe(0);
    });

    it("Derivative of variable with respect to itself", () => {
      const x = var_("x");
      const deriv = diff(x, "x");

      expect(evaluate(deriv, { x: 5 })).toBe(1);
    });

    it("Derivative of variable with respect to different variable", () => {
      const x = var_("x");
      const deriv = diff(x, "y");

      expect(evaluate(deriv, { x: 5 })).toBe(0);
    });

    it("Derivative of floor is zero (step function)", () => {
      const x = var_("x");
      const expr = { kind: "function" as const, fn: "floor" as const, arg: x };
      const deriv = diff(expr, "x");

      expect(evaluate(deriv, { x: 2.5 })).toBe(0);
    });

    it("Higher-order derivatives", () => {
      const x = var_("x");
      const expr = pow(x, const_(3));

      const d1 = diff(expr, "x");
      expect(evaluate(d1, { x: 2 })).toBeCloseTo(12);

      const d2 = nthDiff(expr, "x", 2);
      expect(evaluate(d2, { x: 2 })).toBeCloseTo(12);

      const d3 = nthDiff(expr, "x", 3);
      expect(evaluate(d3, { x: 2 })).toBeCloseTo(6);

      const d4 = nthDiff(expr, "x", 4);
      expect(evaluate(d4, { x: 2 })).toBe(0);
    });
  });

  // ==========================================================================
  // Attack 10: Chain Rule Edge Cases
  // ==========================================================================
  describe("Chain rule edge cases", () => {
    it("Nested function differentiation", () => {
      const x = var_("x");
      const expr = sin(cos(x));

      const deriv = diff(expr, "x");
      expect(evaluate(deriv, { x: 0 })).toBeCloseTo(0);
    });

    it("Deeply nested chain rule", () => {
      const x = var_("x");
      const expr = exp(exp(exp(x)));

      const deriv = diff(expr, "x");
      const result = evaluate(deriv, { x: 0 });
      expect(Number.isFinite(result)).toBe(true);
    });
  });

  // ==========================================================================
  // Attack 11: Differentiation with respect to bound variable in sum/product
  // ==========================================================================
  describe("Differentiation of sum/product", () => {
    it("Cannot differentiate with respect to sum index variable", () => {
      const i = var_("i");
      const expr = sum(pow(i, const_(2)), "i", const_(1), const_(10));

      expect(() => diff(expr, "i")).toThrow(
        "Cannot differentiate sum with respect to its index variable 'i'"
      );
    });

    it("Can differentiate sum with respect to free variable", () => {
      const x = var_("x");
      const i = var_("i");
      const expr = sum(mul(x, i), "i", const_(1), const_(3));

      const deriv = diff(expr, "x");
      expect(evaluate(deriv, { x: 5 })).toBe(6);
    });
  });
});

describe("Symbolic Expression Rendering Edge Cases", () => {
  // ==========================================================================
  // Attack 12: Special Characters in Rendering
  // ==========================================================================
  describe("Rendering edge cases", () => {
    it("Renders named constants correctly", () => {
      expect(toText(PI)).toBe("π");
      expect(toText(E)).toBe("e");
    });

    it("Renders negative numbers correctly", () => {
      const expr = const_(-42);
      expect(toText(expr)).toBe("-42");
    });

    it("Renders nested expressions with parentheses", () => {
      const x = var_("x");
      const expr = mul(add(x, ONE), sub(x, ONE));

      const text = toText(expr);
      expect(text).toContain("(");
      expect(text).toContain(")");
    });

    it("LaTeX special characters are escaped", () => {
      const x = var_("x");
      const expr = pow(x, const_(2));

      const latex = toLatex(expr);
      expect(latex).toContain("^");
    });
  });

  // ==========================================================================
  // Attack 13: Very Long Expression Trees
  // ==========================================================================
  describe("Very long expression trees", () => {
    it("Deeply nested additions", () => {
      let expr = const_(1);
      for (let i = 0; i < 100; i++) {
        expr = add(expr, const_(1));
      }

      expect(evaluate(expr, {})).toBe(101);
    });

    it("Wide expression tree", () => {
      const x = var_("x");
      let expr = x;
      for (let i = 0; i < 100; i++) {
        expr = add(expr, x);
      }

      expect(evaluate(expr, { x: 1 })).toBe(101);
    });
  });
});

describe("Partial Evaluation Edge Cases", () => {
  // ==========================================================================
  // Attack 14: Partial Evaluation with Division by Zero
  // ==========================================================================
  describe("Partial evaluation safety", () => {
    it("Partial evaluation doesn't throw on division by zero (deferred)", () => {
      const x = var_("x");
      const y = var_("y");
      const expr = div(x, y);

      const partial = partialEvaluate(expr, { x: 10 });
      expect(partial.kind).toBe("binary");
    });

    it("Division by zero constant is rejected at construction", () => {
      const x = var_("x");
      // div() validates at construction time - zero constant divisor is rejected
      expect(() => div(x, const_(0))).toThrow("Division by zero");
    });
  });

  // ==========================================================================
  // Attack 15: canEvaluate false positives
  // ==========================================================================
  describe("canEvaluate accuracy", () => {
    it("canEvaluate returns true when all variables bound", () => {
      const x = var_("x");
      const y = var_("y");
      const expr = add(x, y);

      expect(canEvaluate(expr, { x: 1, y: 2 })).toBe(true);
    });

    it("canEvaluate returns false when variable missing", () => {
      const x = var_("x");
      const y = var_("y");
      const expr = add(x, y);

      expect(canEvaluate(expr, { x: 1 })).toBe(false);
    });

    it("canEvaluate returns false for unevaluated derivative", () => {
      const x = var_("x");
      const expr = { kind: "derivative" as const, expr: x, variable: "x", order: 1 };

      expect(canEvaluate(expr, { x: 1 })).toBe(false);
    });
  });
});

// ============================================================================
// NEW RED TEAM TESTS — Previously uncovered attack surfaces
// ============================================================================

describe("Simplification Soundness", () => {
  // ==========================================================================
  // Attack 16: Simplification of 0/0 and 0^0
  // ==========================================================================
  describe("Zero-related simplification rules", () => {
    it("0/0 is NOT simplified to 1 (would be unsound)", () => {
      const expr = div(const_(0), const_(0));
      const result = simplify(expr);

      // divSameRule should NOT fire when both sides are zero
      expect(isOne(result)).toBe(false);
    });

    it("0^0 is NOT simplified to 1 (indeterminate)", () => {
      const expr = pow(const_(0), const_(0));
      const result = simplify(expr);

      // powZeroRule should NOT fire when base is zero
      expect(isOne(result)).toBe(false);
    });

    it("x/x simplifies to 1 (assumes variable is non-zero)", () => {
      // Note: Simplifier can only guard against LITERAL zero, not symbolic zero.
      // For variables, it assumes non-zero. This is standard CAS behavior.
      const x = var_("x");
      const expr = div(x, x);
      const result = simplify(expr);

      expect(isOne(result)).toBe(true);
    });

    it("x^0 simplifies to 1 (assumes variable is non-zero)", () => {
      // Note: Simplifier can only guard against LITERAL zero, not symbolic zero.
      // For variables, it assumes non-zero. This is standard CAS behavior.
      const x = var_("x");
      const expr = pow(x, ZERO);
      const result = simplify(expr);

      expect(isOne(result)).toBe(true);
    });
  });

  // ==========================================================================
  // Attack 17: Constant Folding with Special Values
  // ==========================================================================
  describe("Constant folding edge cases", () => {
    it("NaN constants cannot be created (throws at construction)", () => {
      // const_() rejects NaN at construction time - this is by design
      // to prevent NaN from entering the expression tree
      expect(() => const_(NaN)).toThrow("Cannot create a constant from NaN");
    });

    it("Infinity arithmetic is NOT folded (non-finite result blocked)", () => {
      const expr = add(const_(Infinity), const_(1));
      const result = simplify(expr);

      // Non-finite results prevent constant folding per constantFoldingRule guard
      // The expression should remain unfoldable - verify it's still a binary op
      expect(isBinaryOp(result)).toBe(true);
      if (isBinaryOp(result)) {
        expect(result.op).toBe("+");
      }
    });

    it("Division by zero is NOT constant-folded", () => {
      const expr = div(const_(1), const_(0));
      const result = simplify(expr);

      // Should remain as 1/0, not fold (since it would throw)
      expect(isConstant(result)).toBe(false);
      expect(isBinaryOp(result)).toBe(true);
    });

    it("Double negation cancels", () => {
      const x = var_("x");
      const expr = neg(neg(x));
      const result = simplify(expr);

      expect(isVariable(result)).toBe(true);
    });
  });

  // ==========================================================================
  // Attack 18: expand() blowup
  // ==========================================================================
  describe("Expand edge cases", () => {
    it("Expand of constant is identity", () => {
      const result = expand(const_(42));
      expect(isConstant(result) && result.value === 42).toBe(true);
    });

    it("Expand distributes multiplication over addition", () => {
      const x = var_("x");
      const expr = mul(const_(2), add(x, ONE));
      const result = expand(expr);

      // 2*(x+1) → 2*x + 2*1
      expect(evaluate(result, { x: 3 })).toBe(8);
    });

    it("Expand handles nested distribution", () => {
      const x = var_("x");
      const expr = mul(add(x, ONE), add(x, TWO));
      const result = expand(expr);

      // (x+1)(x+2) evaluates same as original
      expect(evaluate(result, { x: 3 })).toBe(20);
    });
  });

  // ==========================================================================
  // Attack 19: collectTerms dropping non-polynomial terms
  // ==========================================================================
  describe("collectTerms edge cases", () => {
    it("Throws on function-containing terms", () => {
      const x = var_("x");
      const expr = add(sin(x), x); // sin(x) + x is not polynomial

      expect(() => collectTerms(expr, "x")).toThrow("not a polynomial");
    });

    it("Handles pure constants correctly", () => {
      const expr = add(const_(3), const_(4));
      const result = collectTerms(expr, "x");

      expect(evaluate(result, {})).toBe(7);
    });

    it("Collects simple linear terms", () => {
      const x = var_("x");
      const expr = add(x, x);
      const result = collectTerms(expr, "x");

      expect(evaluate(result, { x: 5 })).toBe(10);
    });

    it("Throws when variable appears in denominator", () => {
      const x = var_("x");
      const expr = add(div(ONE, x), x); // 1/x + x is not polynomial

      expect(() => collectTerms(expr, "x")).toThrow("denominator");
    });
  });
});

describe("Pattern Matching Edge Cases", () => {
  // ==========================================================================
  // Attack 20: Same-name pattern variables must match same expression
  // ==========================================================================
  describe("Pattern variable consistency", () => {
    it("Same-name pattern vars must match identical expressions", () => {
      const $a = patternVar("a");
      const pattern = add($a, $a); // a + a
      const x = var_("x");
      const y = var_("y");

      // x + x matches (both "a" bind to x)
      expect(match(add(x, x), pattern)).not.toBeNull();

      // x + y does NOT match (first "a"=x, second "a"=y, conflict)
      expect(match(add(x, y), pattern)).toBeNull();
    });

    it("Different-name pattern vars can match different expressions", () => {
      const $a = patternVar("a");
      const $b = patternVar("b");
      const pattern = add($a, $b);
      const x = var_("x");
      const y = var_("y");

      const bindings = match(add(x, y), pattern);
      expect(bindings).not.toBeNull();
      expect(isVariable(bindings!.get("a")!)).toBe(true);
      expect(isVariable(bindings!.get("b")!)).toBe(true);
    });
  });

  // ==========================================================================
  // Attack 21: Pattern constraints
  // ==========================================================================
  describe("Pattern variable constraints", () => {
    it("Constant constraint rejects variables", () => {
      const $n = patternVar("n", "constant");
      const x = var_("x");

      expect(match(x, $n)).toBeNull();
      expect(match(const_(5), $n)).not.toBeNull();
    });

    it("Variable constraint rejects constants", () => {
      const $v = patternVar("v", "variable");

      expect(match(const_(5), $v)).toBeNull();
      expect(match(var_("x"), $v)).not.toBeNull();
    });

    it("Any constraint matches everything", () => {
      const $a = patternVar("a", "any");

      expect(match(const_(5), $a)).not.toBeNull();
      expect(match(var_("x"), $a)).not.toBeNull();
      expect(match(add(var_("x"), ONE), $a)).not.toBeNull();
    });
  });

  // ==========================================================================
  // Attack 22: Rewrite loop detection
  // ==========================================================================
  describe("Rewrite termination", () => {
    it("Commutative rule terminates (via maxIterations)", () => {
      const $a = patternVar("a");
      const $b = patternVar("b");

      // a + b → b + a will oscillate
      const commuteAdd = rule(add($a, $b), add($b, $a));

      const x = var_("x");
      const y = var_("y");

      // Should terminate (hits maxIterations) and not throw
      const result = rewrite(add(x, y), [commuteAdd], 10);
      expect(result).toBeDefined();
    });

    it("Productive rule converges", () => {
      const $a = patternVar("a");
      // 0 + a → a (always simplifies)
      const removeZeroAdd = rule(add(ZERO, $a), $a);

      const x = var_("x");
      const result = rewrite(add(ZERO, x), [removeZeroAdd]);
      expect(isVariable(result)).toBe(true);
    });
  });

  // ==========================================================================
  // Attack 23: findAll edge cases
  // ==========================================================================
  describe("findAll", () => {
    it("Finds all matching subexpressions with constrained pattern", () => {
      // Use "variable" constraint so we only match actual variable nodes
      const $v = patternVar("v", "variable");
      const x = var_("x");
      const expr = add(mul(x, x), add(x, ONE));

      // Find all occurrences of variables
      const results = findAll(expr, $v);
      // Should find exactly 3 occurrences of x (two in mul, one in add)
      expect(results.length).toBe(3);
      // All matches should be variable nodes
      for (const r of results) {
        expect(isVariable(r.expr)).toBe(true);
      }
    });

    it("Finds all multiplications with structured pattern", () => {
      const $a = patternVar("a");
      const $b = patternVar("b");
      const pattern = mul($a, $b);
      const x = var_("x");
      const expr = add(mul(x, x), mul(x, ONE));

      const results = findAll(expr, pattern);
      // Should find exactly 2 multiplication nodes
      expect(results.length).toBe(2);
      // All matches should be binary operations with *
      for (const r of results) {
        expect(isBinaryOp(r.expr) && r.expr.op === "*").toBe(true);
      }
    });

    it("Returns empty array when pattern does not match", () => {
      const x = var_("x");
      const y = var_("y");
      // Pattern looking for division - expr has no division
      const pattern = div(patternVar("a"), patternVar("b"));
      const expr = add(x, y);

      const results = findAll(expr, pattern);
      // Should be empty - no division in add(x, y)
      expect(results).toEqual([]);
    });
  });

  // ==========================================================================
  // Attack 24: Unbound pattern variable in replacement
  // ==========================================================================
  describe("Pattern substitution errors", () => {
    it("Throws for unbound pattern variable in replacement", () => {
      const $a = patternVar("a");
      const $b = patternVar("b");
      const $c = patternVar("c");

      // Pattern matches a+b, replacement uses c which is never bound
      const badRule = rule(add($a, $b), add($a, $c));

      const x = var_("x");
      const y = var_("y");

      // applyRule should throw because $c is unbound after matching
      expect(() => applyRule(add(x, y), badRule)).toThrow("Unbound pattern variable");
    });
  });
});

describe("Equation Solving Edge Cases", () => {
  // ==========================================================================
  // Attack 25: No solution
  // ==========================================================================
  describe("Unsolvable equations", () => {
    it("Contradictory equation returns failure", () => {
      // 0 = 5 (no x to solve for in a tautology/contradiction)
      const eq = equation(ZERO, const_(5));
      const result = solve(eq, "x");

      expect(result.success).toBe(false);
    });

    it("Identity equation returns empty solutions", () => {
      // x - x = 0 → 0 = 0 (true for all x)
      const x = var_("x");
      const expr = sub(x, x); // simplifies to 0
      const result = solve(expr, "x");

      // 0 = 0 is always true, so technically every x is a solution
      expect(result.success).toBe(true);
      expect(result.solutions).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Attack 26: Quadratic with no real roots
  // ==========================================================================
  describe("Complex roots", () => {
    it("Quadratic with negative discriminant fails", () => {
      const x = var_("x");
      // x² + 1 = 0 → discriminant = -4 < 0
      const expr = add(pow(x, TWO), ONE);
      const result = solve(expr, "x");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toContain("No real solutions");
      }
    });

    it("Perfect square has one solution", () => {
      const x = var_("x");
      // x² - 2x + 1 = 0 → (x-1)² = 0
      const expr = sub(add(pow(x, TWO), ONE), mul(TWO, x));
      const result = solve(expr, "x");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.solutions.length).toBe(1);
        expect(evaluate(result.solutions[0], {})).toBeCloseTo(1);
      }
    });
  });

  // ==========================================================================
  // Attack 27: System of equations edge cases
  // ==========================================================================
  describe("System solving", () => {
    it("Mismatched equations and variables throws", () => {
      const x = var_("x");
      const y = var_("y");

      expect(() => solveSystem([{ left: add(x, y), right: const_(5) }], ["x", "y"])).toThrow(
        "Number of equations must equal number of variables"
      );
    });

    it("Singular system (dependent equations) returns null", () => {
      const x = var_("x");
      const y = var_("y");

      // x + y = 5 and 2x + 2y = 10 are dependent
      const result = solveSystem(
        [
          { left: add(x, y), right: const_(5) },
          { left: add(mul(TWO, x), mul(TWO, y)), right: const_(10) },
        ],
        ["x", "y"]
      );

      expect(result).toBeNull();
    });

    it("3+ equations throws not-yet-supported", () => {
      const x = var_("x");
      const y = var_("y");
      const z = var_("z");

      expect(() =>
        solveSystem(
          [
            { left: x, right: ONE },
            { left: y, right: ONE },
            { left: z, right: ONE },
          ],
          ["x", "y", "z"]
        )
      ).toThrow("not yet supported");
    });
  });
});

describe("Integration Edge Cases", () => {
  // ==========================================================================
  // Attack 28: Integration of unsupported expressions
  // ==========================================================================
  describe("Unsupported integrals", () => {
    it("Integration by parts not supported", () => {
      const x = var_("x");
      const expr = mul(x, sin(x)); // ∫x·sin(x) needs integration by parts

      const result = tryIntegrate(expr, "x");
      expect(result.success).toBe(false);
    });

    it("Cannot integrate derivative node", () => {
      const x = var_("x");
      const expr = derivative(x, "x");

      expect(() => integrate(expr, "x")).toThrow("Cannot integrate");
    });

    it("Cannot integrate equation", () => {
      const x = var_("x");
      const eq = equation(x, ONE);

      expect(() => integrate(eq, "x")).toThrow("Cannot integrate");
    });

    it("sqrt integration not directly supported", () => {
      const x = var_("x");
      const expr = sqrt(x);

      expect(() => integrate(expr, "x")).toThrow();
    });
  });

  // ==========================================================================
  // Attack 29: Integration verification (FTC)
  // ==========================================================================
  describe("Fundamental Theorem verification", () => {
    it("Integral of derivative recovers original (for polynomials)", () => {
      const x = var_("x");
      const original = pow(x, const_(3)); // x³
      const derived = diff(original, "x"); // 3x²
      const integrated = integrate(derived, "x"); // x³ (up to constant)

      // F(5) - F(0) should equal original(5) - original(0) = 125
      const f5 = evaluate(integrated, { x: 5 });
      const f0 = evaluate(integrated, { x: 0 });
      expect(f5 - f0).toBeCloseTo(125);
    });
  });

  // ==========================================================================
  // Attack 30: definiteIntegral edge cases
  // ==========================================================================
  describe("Definite integrals", () => {
    it("Definite integral of x from 0 to 1 is 0.5", () => {
      const x = var_("x");
      const result = definiteIntegral(x, "x", 0, 1);
      expect(evaluate(result, {})).toBeCloseTo(0.5);
    });

    it("Definite integral with reversed bounds flips sign", () => {
      const x = var_("x");
      const fwd = evaluate(definiteIntegral(x, "x", 0, 1), {});
      const rev = evaluate(definiteIntegral(x, "x", 1, 0), {});

      expect(fwd).toBeCloseTo(-rev);
    });
  });
});

describe("Limit Computation Edge Cases", () => {
  // ==========================================================================
  // Attack 31: L'Hôpital's rule
  // ==========================================================================
  describe("L'Hôpital's rule", () => {
    it("sin(x)/x → 1 as x→0", () => {
      const x = var_("x");
      const result = computeLimit(div(sin(x), x), "x", 0);

      expect(result.exists).toBe(true);
      if (result.exists) {
        expect(evaluate(result.value, {})).toBeCloseTo(1);
      }
    });

    it("limitExists returns true for continuous functions", () => {
      const x = var_("x");
      expect(limitExists(add(x, ONE), "x", 0)).toBe(true);
    });

    it("limitExists returns false for 1/x at 0", () => {
      const x = var_("x");
      expect(limitExists(div(ONE, x), "x", 0)).toBe(false);
    });
  });
});

describe("Builder Input Validation", () => {
  // ==========================================================================
  // Attack 32: var_() with problematic names
  // ==========================================================================
  describe("Variable name validation", () => {
    it("Empty string variable name throws", () => {
      expect(() => var_("")).toThrow("Variable name must be non-empty");
    });

    it("Single character variable names work", () => {
      const x = var_("x");
      expect(isVariable(x)).toBe(true);
    });

    it("Unicode variable names work", () => {
      const theta = var_("θ");
      expect(isVariable(theta)).toBe(true);
      expect(evaluate(theta, { θ: 3.14 })).toBeCloseTo(3.14);
    });

    it("Variable names with underscores work", () => {
      const x1 = var_("x_1");
      expect(isVariable(x1)).toBe(true);
      expect(evaluate(x1, { x_1: 42 })).toBe(42);
    });
  });

  // ==========================================================================
  // Attack 33: const_() with special values
  // ==========================================================================
  describe("Constant construction edge cases", () => {
    it("NaN constant construction is rejected", () => {
      // NaN is rejected at construction time to prevent it from
      // entering the expression tree (where it would cause issues)
      expect(() => const_(NaN)).toThrow("Cannot create a constant from NaN");
    });

    it("Infinity constant evaluates to Infinity", () => {
      const expr = const_(Infinity);
      expect(evaluate(expr, {})).toBe(Infinity);
    });

    it("-0 constant evaluates to -0", () => {
      const expr = const_(-0);
      expect(Object.is(evaluate(expr, {}), -0)).toBe(true);
    });

    it("Very large constant", () => {
      const expr = const_(Number.MAX_SAFE_INTEGER);
      expect(evaluate(expr, {})).toBe(Number.MAX_SAFE_INTEGER);
    });

    it("Very small constant (subnormal)", () => {
      const expr = const_(5e-324);
      expect(evaluate(expr, {})).toBe(5e-324);
    });
  });

  // ==========================================================================
  // Attack 34: Numeric typeclass instance
  // ==========================================================================
  describe("numericExpr instance", () => {
    it("toNumber throws for non-constant", () => {
      const x = var_("x");
      expect(() => numericExpr.toNumber(x)).toThrow("Cannot convert non-constant");
    });

    it("toNumber works for constant", () => {
      expect(numericExpr.toNumber(const_(42))).toBe(42);
    });

    it("zero and one produce correct constants", () => {
      expect(evaluate(numericExpr.zero(), {})).toBe(0);
      expect(evaluate(numericExpr.one(), {})).toBe(1);
    });

    it("fromNumber creates a constant", () => {
      const result = numericExpr.fromNumber(7);
      expect(isConstant(result)).toBe(true);
      expect(evaluate(result, {})).toBe(7);
    });
  });
});

describe("Rendering Special Cases", () => {
  // ==========================================================================
  // Attack 35: Rendering special numeric values
  // ==========================================================================
  describe("Special value rendering", () => {
    it("NaN constants are rejected at construction (cannot render)", () => {
      // NaN cannot even be created as a constant, so rendering is N/A
      expect(() => const_(NaN)).toThrow("Cannot create a constant from NaN");
    });

    it("Infinity renders as text", () => {
      const expr = const_(Infinity);
      const text = toText(expr);
      expect(text).toContain("Infinity");
    });

    it("Floating point precision in text rendering", () => {
      const expr = const_(1 / 3);
      const text = toText(expr);
      // Should not be infinite decimal
      expect(text.length).toBeLessThan(30);
    });
  });

  // ==========================================================================
  // Attack 36: LaTeX rendering edge cases
  // ==========================================================================
  describe("LaTeX rendering edge cases", () => {
    it("Greek letters are converted", () => {
      expect(toLatex(var_("alpha"))).toBe("\\alpha");
      expect(toLatex(var_("theta"))).toBe("\\theta");
      expect(toLatex(var_("omega"))).toBe("\\omega");
    });

    it("Subscript notation works", () => {
      expect(toLatex(var_("x_1"))).toBe("x_{1}");
      expect(toLatex(var_("a_n"))).toBe("a_{n}");
    });

    it("Multi-character non-Greek gets \\text{}", () => {
      expect(toLatex(var_("speed"))).toBe("\\text{speed}");
    });

    it("Fraction rendering", () => {
      const x = var_("x");
      const latex = toLatex(div(ONE, x));
      expect(latex).toContain("\\frac");
    });

    it("Sum and product LaTeX", () => {
      const i = var_("i");
      const sumExpr = sum(i, "i", const_(1), const_(10));
      const latex = toLatex(sumExpr);
      expect(latex).toContain("\\sum");
    });
  });

  // ==========================================================================
  // Attack 37: MathML rendering
  // ==========================================================================
  describe("MathML rendering", () => {
    it("MathML wraps in <math> tag", () => {
      const x = var_("x");
      const mathml = toMathML(x);
      expect(mathml).toContain("<math");
      expect(mathml).toContain("</math>");
    });

    it("MathML renders addition with <mo>", () => {
      const x = var_("x");
      const mathml = toMathML(add(x, ONE));
      expect(mathml).toContain("<mo>+</mo>");
    });

    it("MathML renders power with <msup>", () => {
      const x = var_("x");
      const mathml = toMathML(pow(x, TWO));
      expect(mathml).toContain("<msup>");
    });
  });
});

describe("Free vs Bound Variable Tracking", () => {
  // ==========================================================================
  // Attack 38: getVariables excludes bound variables
  // ==========================================================================
  describe("getVariables correctness", () => {
    it("Sum index variable is excluded from free variables", () => {
      const i = var_("i");
      const expr = sum(i, "i", const_(1), const_(5));

      const vars = getVariables(expr);
      expect(vars.has("i")).toBe(false);
    });

    it("Free variable inside sum IS included", () => {
      const x = var_("x");
      const i = var_("i");
      const expr = sum(mul(x, i), "i", const_(1), const_(5));

      const vars = getVariables(expr);
      expect(vars.has("x")).toBe(true);
      expect(vars.has("i")).toBe(false);
    });

    it("Product index variable is excluded", () => {
      const k = var_("k");
      const expr = product(k, "k", const_(1), const_(3));

      const vars = getVariables(expr);
      expect(vars.has("k")).toBe(false);
    });

    it("getAllVariables includes bound variables", () => {
      const i = var_("i");
      const expr = sum(i, "i", const_(1), const_(5));

      const allVars = getAllVariables(expr);
      expect(allVars.has("i")).toBe(true);
    });

    it("hasVariable uses free variable semantics", () => {
      const i = var_("i");
      const expr = sum(i, "i", const_(1), const_(5));

      expect(hasVariable(expr, "i")).toBe(false);
    });

    it("canEvaluate works with bound variables in sum", () => {
      const i = var_("i");
      const expr = sum(i, "i", const_(1), const_(5));

      // No free variables, should be evaluable
      expect(canEvaluate(expr, {})).toBe(true);
      expect(evaluate(expr, {})).toBe(15);
    });
  });

  // ==========================================================================
  // Attack 39: Expression utility functions
  // ==========================================================================
  describe("Expression utilities", () => {
    it("isPureConstant for various expression types", () => {
      expect(isPureConstant(const_(5))).toBe(true);
      expect(isPureConstant(var_("x"))).toBe(false);
      expect(isPureConstant(add(const_(1), const_(2)))).toBe(true);
      expect(isPureConstant(add(const_(1), var_("x")))).toBe(false);
    });

    it("depth handles all node types", () => {
      expect(depth(const_(1))).toBe(1);
      expect(depth(var_("x"))).toBe(1);
      expect(depth(add(var_("x"), ONE))).toBe(2);
      expect(depth(sin(var_("x")))).toBe(2);
      expect(depth(neg(var_("x")))).toBe(2);
    });

    it("nodeCount handles all node types", () => {
      expect(nodeCount(const_(1))).toBe(1);
      expect(nodeCount(add(var_("x"), ONE))).toBe(3);

      const x = var_("x");
      const complex = add(mul(x, x), sub(x, ONE));
      expect(nodeCount(complex)).toBe(7);
    });
  });
});

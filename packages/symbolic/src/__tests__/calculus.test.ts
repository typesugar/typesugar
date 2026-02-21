import { describe, it, expect } from "vitest";
import {
  var_,
  const_,
  add,
  mul,
  div,
  pow,
  sin,
  cos,
  exp,
  ln,
} from "../builders.js";
import { diff, nthDiff } from "../calculus/diff.js";
import { integrate, tryIntegrate } from "../calculus/integrate.js";
import { computeLimit, leftLimit, rightLimit } from "../calculus/limit.js";
import { evaluate } from "../eval.js";
import { simplify } from "../simplify/simplify.js";
import { toText } from "../render/text.js";

describe("Differentiation", () => {
  const x = var_("x");

  describe("basic rules", () => {
    it("d/dx(c) = 0", () => {
      const result = diff(const_(5), "x");
      expect(evaluate(result, {})).toBe(0);
    });

    it("d/dx(x) = 1", () => {
      const result = diff(x, "x");
      expect(evaluate(result, {})).toBe(1);
    });

    it("d/dx(y) = 0 when differentiating with respect to x", () => {
      const result = diff(var_("y"), "x");
      expect(evaluate(result, {})).toBe(0);
    });
  });

  describe("sum rule", () => {
    it("d/dx(f + g) = df/dx + dg/dx", () => {
      const expr = add(mul(const_(2), x), const_(3));
      const result = simplify(diff(expr, "x"));
      expect(evaluate(result, {})).toBe(2);
    });
  });

  describe("product rule", () => {
    it("d/dx(x * x) = 2x", () => {
      const expr = mul(x, x);
      const result = simplify(diff(expr, "x"));
      expect(evaluate(result, { x: 3 })).toBe(6);
    });
  });

  describe("quotient rule", () => {
    it("d/dx(1/x) = -1/x²", () => {
      const expr = div(const_(1), x);
      const result = diff(expr, "x");
      expect(evaluate(result, { x: 2 })).toBeCloseTo(-0.25);
    });
  });

  describe("power rule", () => {
    it("d/dx(x²) = 2x", () => {
      const expr = pow(x, const_(2));
      const result = simplify(diff(expr, "x"));
      expect(evaluate(result, { x: 3 })).toBe(6);
    });

    it("d/dx(x³) = 3x²", () => {
      const expr = pow(x, const_(3));
      const result = simplify(diff(expr, "x"));
      expect(evaluate(result, { x: 2 })).toBe(12);
    });
  });

  describe("chain rule with trigonometric functions", () => {
    it("d/dx(sin(x)) = cos(x)", () => {
      const result = diff(sin(x), "x");
      expect(evaluate(result, { x: 0 })).toBe(1);
    });

    it("d/dx(cos(x)) = -sin(x)", () => {
      const result = diff(cos(x), "x");
      expect(evaluate(result, { x: 0 })).toBeCloseTo(0);
      expect(evaluate(result, { x: Math.PI / 2 })).toBeCloseTo(-1);
    });
  });

  describe("exponential and logarithm", () => {
    it("d/dx(e^x) = e^x", () => {
      const result = diff(exp(x), "x");
      expect(evaluate(result, { x: 0 })).toBe(1);
      expect(evaluate(result, { x: 1 })).toBeCloseTo(Math.E);
    });

    it("d/dx(ln(x)) = 1/x", () => {
      const result = diff(ln(x), "x");
      expect(evaluate(result, { x: 2 })).toBeCloseTo(0.5);
    });
  });

  describe("nthDiff", () => {
    it("computes second derivative", () => {
      const expr = pow(x, const_(3)); // x³
      const result = simplify(nthDiff(expr, "x", 2)); // 6x
      expect(evaluate(result, { x: 2 })).toBe(12);
    });
  });
});

describe("Integration", () => {
  const x = var_("x");

  describe("basic integrals", () => {
    it("∫c dx = cx", () => {
      const result = integrate(const_(5), "x");
      expect(evaluate(result, { x: 2 })).toBe(10);
    });

    it("∫x dx = x²/2", () => {
      const result = integrate(x, "x");
      expect(evaluate(result, { x: 4 })).toBe(8);
    });

    it("∫x² dx = x³/3", () => {
      const result = integrate(pow(x, const_(2)), "x");
      expect(evaluate(result, { x: 3 })).toBeCloseTo(9);
    });
  });

  describe("sum rule", () => {
    it("∫(f + g) dx = ∫f dx + ∫g dx", () => {
      const expr = add(x, const_(1));
      const result = integrate(expr, "x");
      // Should be x²/2 + x
      expect(evaluate(result, { x: 2 })).toBe(4); // 2 + 2
    });
  });

  describe("trigonometric integrals", () => {
    it("∫sin(x) dx = -cos(x)", () => {
      const result = integrate(sin(x), "x");
      // -cos(π/2) = 0, -cos(0) = -1
      expect(evaluate(result, { x: 0 })).toBeCloseTo(-1);
    });

    it("∫cos(x) dx = sin(x)", () => {
      const result = integrate(cos(x), "x");
      expect(evaluate(result, { x: Math.PI / 2 })).toBeCloseTo(1);
    });
  });

  describe("exponential integrals", () => {
    it("∫e^x dx = e^x", () => {
      const result = integrate(exp(x), "x");
      expect(evaluate(result, { x: 1 })).toBeCloseTo(Math.E);
    });
  });

  describe("tryIntegrate", () => {
    it("returns success for integrable expressions", () => {
      const result = tryIntegrate(x, "x");
      expect(result.success).toBe(true);
    });

    it("returns failure for non-integrable expressions", () => {
      const result = tryIntegrate(mul(sin(x), cos(x)), "x");
      // This should fail as we don't have integration by parts
      expect(result.success).toBe(false);
    });
  });
});

describe("Limits", () => {
  const x = var_("x");

  describe("direct substitution", () => {
    it("computes limit by direct substitution", () => {
      const expr = add(x, const_(1));
      const result = computeLimit(expr, "x", 2);
      expect(result.exists).toBe(true);
      if (result.exists) {
        expect(evaluate(result.value, {})).toBe(3);
      }
    });
  });

  describe("L'Hôpital's rule", () => {
    it("computes lim sin(x)/x as x→0", () => {
      const expr = div(sin(x), x);
      const result = computeLimit(expr, "x", 0);
      expect(result.exists).toBe(true);
      if (result.exists) {
        expect(evaluate(result.value, {})).toBeCloseTo(1);
      }
    });
  });

  describe("one-sided limits", () => {
    it("computes left limit", () => {
      const expr = x;
      const result = leftLimit(expr, "x", 0);
      expect(result.exists).toBe(true);
    });

    it("computes right limit", () => {
      const expr = x;
      const result = rightLimit(expr, "x", 0);
      expect(result.exists).toBe(true);
    });
  });
});

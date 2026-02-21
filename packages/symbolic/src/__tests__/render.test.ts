import { describe, it, expect } from "vitest";
import {
  var_,
  const_,
  add,
  sub,
  mul,
  div,
  pow,
  sin,
  cos,
  sqrt,
  asin,
  acos,
  floor,
  ceil,
  log2,
  PI,
} from "../builders.js";
import { toText } from "../render/text.js";
import { toLatex } from "../render/latex.js";
import { toMathML } from "../render/mathml.js";

describe("Rendering", () => {
  const x = var_("x");
  const y = var_("y");

  describe("toText", () => {
    it("renders constants", () => {
      expect(toText(const_(42))).toBe("42");
      expect(toText(PI)).toBe("π");
    });

    it("renders variables", () => {
      expect(toText(x)).toBe("x");
    });

    it("renders addition", () => {
      expect(toText(add(x, const_(1)))).toBe("x + 1");
    });

    it("renders subtraction", () => {
      expect(toText(sub(x, const_(1)))).toBe("x - 1");
    });

    it("renders multiplication", () => {
      expect(toText(mul(x, y))).toBe("x * y");
    });

    it("renders division", () => {
      expect(toText(div(x, y))).toBe("x / y");
    });

    it("renders powers", () => {
      expect(toText(pow(x, const_(2)))).toBe("x^2");
    });

    it("renders functions", () => {
      expect(toText(sin(x))).toBe("sin(x)");
      expect(toText(cos(x))).toBe("cos(x)");
    });

    it("handles precedence", () => {
      const expr = add(mul(x, const_(2)), const_(1));
      expect(toText(expr)).toBe("x * 2 + 1");

      const expr2 = mul(add(x, const_(1)), const_(2));
      expect(toText(expr2)).toBe("(x + 1) * 2");
    });

    it("renders floor and ceil", () => {
      expect(toText(floor(x))).toBe("floor(x)");
      expect(toText(ceil(x))).toBe("ceil(x)");
    });

    it("renders asin and acos", () => {
      expect(toText(asin(x))).toBe("asin(x)");
      expect(toText(acos(x))).toBe("acos(x)");
    });

    it("renders log2", () => {
      expect(toText(log2(x))).toBe("log2(x)");
    });
  });

  describe("toText options", () => {
    it("respects unicode option", () => {
      expect(toText(sqrt(x), { unicode: true })).toBe("√(x)");
      expect(toText(sqrt(x), { unicode: false })).toBe("sqrt(x)");
    });

    it("respects precision option", () => {
      const pi = const_(Math.PI);
      const result3 = toText(pi, { precision: 3 });
      const result6 = toText(pi, { precision: 6 });
      expect(result3.length).toBeLessThan(result6.length);
    });
  });

  describe("toLatex", () => {
    it("renders constants", () => {
      expect(toLatex(const_(42))).toBe("42");
      expect(toLatex(PI)).toBe("\\pi");
    });

    it("renders fractions", () => {
      expect(toLatex(div(const_(1), x))).toBe("\\frac{1}{x}");
    });

    it("renders powers", () => {
      expect(toLatex(pow(x, const_(2)))).toBe("x^2");
      expect(toLatex(pow(x, const_(10)))).toBe("x^{10}");
    });

    it("renders square roots", () => {
      expect(toLatex(sqrt(x))).toBe("\\sqrt{x}");
    });

    it("renders trigonometric functions", () => {
      expect(toLatex(sin(x))).toBe("\\sin\\left(x\\right)");
      expect(toLatex(cos(x))).toBe("\\cos\\left(x\\right)");
    });

    it("handles Greek letter variable names", () => {
      expect(toLatex(var_("alpha"))).toBe("\\alpha");
      expect(toLatex(var_("theta"))).toBe("\\theta");
    });

    it("handles subscript notation", () => {
      expect(toLatex(var_("x_1"))).toBe("x_{1}");
    });

    it("renders floor and ceil with brackets", () => {
      expect(toLatex(floor(x))).toBe("\\lfloor x \\rfloor");
      expect(toLatex(ceil(x))).toBe("\\lceil x \\rceil");
    });

    it("renders arcsin and arccos", () => {
      expect(toLatex(asin(x))).toBe("\\arcsin\\left(x\\right)");
      expect(toLatex(acos(x))).toBe("\\arccos\\left(x\\right)");
    });

    it("renders log2", () => {
      expect(toLatex(log2(x))).toBe("\\log_{2}\\left(x\\right)");
    });
  });

  describe("toLatex options", () => {
    it("respects useFrac option", () => {
      const expr = div(const_(1), x);
      expect(toLatex(expr, { useFrac: true })).toBe("\\frac{1}{x}");
      expect(toLatex(expr, { useFrac: false })).toBe("1 / x");
    });

    it("respects useCdot option", () => {
      const expr = mul(const_(2), const_(3));
      expect(toLatex(expr, { useCdot: true, implicitMul: false })).toContain("\\cdot");
      expect(toLatex(expr, { useCdot: false, implicitMul: false })).toContain("\\times");
    });

    it("respects implicitMul option", () => {
      const expr = mul(const_(2), x);
      expect(toLatex(expr, { implicitMul: true })).toBe("2 x");
      expect(toLatex(expr, { implicitMul: false, useCdot: false })).toBe("2 \\times x");
    });

    it("respects precision option", () => {
      const val = const_(1.23456789);
      const result3 = toLatex(val, { precision: 3 });
      const result6 = toLatex(val, { precision: 6 });
      expect(result3.length).toBeLessThan(result6.length);
    });
  });

  describe("toMathML", () => {
    it("wraps in math element", () => {
      const result = toMathML(x);
      expect(result).toMatch(/^<math>/);
      expect(result).toMatch(/<\/math>$/);
    });

    it("renders variables as mi", () => {
      expect(toMathML(x)).toContain("<mi>x</mi>");
    });

    it("renders constants as mn", () => {
      expect(toMathML(const_(42))).toContain("<mn>42</mn>");
    });

    it("renders fractions as mfrac", () => {
      expect(toMathML(div(const_(1), x))).toContain("<mfrac>");
    });

    it("renders powers as msup", () => {
      expect(toMathML(pow(x, const_(2)))).toContain("<msup>");
    });

    it("renders square roots as msqrt", () => {
      expect(toMathML(sqrt(x))).toContain("<msqrt>");
    });
  });
});

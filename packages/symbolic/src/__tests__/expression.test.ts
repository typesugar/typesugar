import { describe, it, expect } from "vitest";
import {
  var_,
  const_,
  add,
  mul,
  pow,
  neg,
  sin,
  abs,
  asin,
  acos,
  floor,
  ceil,
  log,
  log2,
  square,
  cube,
  recip,
  ZERO,
  ONE,
  PI,
  E,
} from "../builders.js";
import {
  isConstant,
  isVariable,
  isBinaryOp,
  isZero,
  isOne,
  getVariables,
  hasVariable,
  isPureConstant,
  depth,
  nodeCount,
} from "../expression.js";
import { expressionsEqual, type SimplificationRule } from "../simplify/rules.js";
import { simplify } from "../simplify/simplify.js";

describe("Expression AST", () => {
  describe("builders", () => {
    it("creates constants", () => {
      const c = const_(42);
      expect(c.kind).toBe("constant");
      expect(c.value).toBe(42);
    });

    it("creates named constants", () => {
      expect(PI.name).toBe("π");
      expect(PI.value).toBeCloseTo(Math.PI);
      expect(E.name).toBe("e");
      expect(E.value).toBeCloseTo(Math.E);
    });

    it("creates variables", () => {
      const x = var_("x");
      expect(x.kind).toBe("variable");
      expect(x.name).toBe("x");
    });

    it("creates binary operations", () => {
      const x = var_("x");
      const expr = add(x, const_(1));
      expect(expr.kind).toBe("binary");
      expect(expr.op).toBe("+");
    });

    it("creates unary operations", () => {
      const x = var_("x");
      const expr = neg(x);
      expect(expr.kind).toBe("unary");
      expect(expr.op).toBe("-");
    });

    it("creates function calls", () => {
      const x = var_("x");
      const expr = sin(x);
      expect(expr.kind).toBe("function");
      expect(expr.fn).toBe("sin");
    });

    it("creates abs (unary)", () => {
      const x = var_("x");
      const expr = abs(x);
      expect(expr.kind).toBe("unary");
      expect(expr.op).toBe("abs");
    });

    it("creates inverse trig functions", () => {
      const x = var_("x");
      expect(asin(x).fn).toBe("asin");
      expect(acos(x).fn).toBe("acos");
    });

    it("creates floor and ceil", () => {
      const x = var_("x");
      expect(floor(x).fn).toBe("floor");
      expect(ceil(x).fn).toBe("ceil");
    });

    it("creates log and log2", () => {
      const x = var_("x");
      expect(log(x).fn).toBe("log");
      expect(log2(x).fn).toBe("log2");
    });

    it("creates square and cube (convenience builders)", () => {
      const x = var_("x");
      const sq = square(x);
      const cb = cube(x);

      expect(sq.kind).toBe("binary");
      expect(sq.op).toBe("^");
      if (sq.kind === "binary" && sq.right.kind === "constant") {
        expect(sq.right.value).toBe(2);
      }

      expect(cb.kind).toBe("binary");
      expect(cb.op).toBe("^");
      if (cb.kind === "binary" && cb.right.kind === "constant") {
        expect(cb.right.value).toBe(3);
      }
    });

    it("creates recip (1/x)", () => {
      const x = var_("x");
      const r = recip(x);
      expect(r.kind).toBe("binary");
      expect(r.op).toBe("/");
      if (r.kind === "binary" && r.left.kind === "constant") {
        expect(r.left.value).toBe(1);
      }
    });
  });

  describe("type guards", () => {
    it("isConstant", () => {
      expect(isConstant(const_(1))).toBe(true);
      expect(isConstant(var_("x"))).toBe(false);
    });

    it("isVariable", () => {
      expect(isVariable(var_("x"))).toBe(true);
      expect(isVariable(const_(1))).toBe(false);
    });

    it("isBinaryOp", () => {
      const x = var_("x");
      expect(isBinaryOp(add(x, x))).toBe(true);
      expect(isBinaryOp(neg(x))).toBe(false);
    });

    it("isZero and isOne", () => {
      expect(isZero(ZERO)).toBe(true);
      expect(isZero(const_(0))).toBe(true);
      expect(isZero(const_(1))).toBe(false);
      expect(isOne(ONE)).toBe(true);
      expect(isOne(const_(1))).toBe(true);
      expect(isOne(const_(0))).toBe(false);
    });
  });

  describe("utilities", () => {
    it("getVariables", () => {
      const x = var_("x");
      const y = var_("y");
      const expr = add(mul(x, y), pow(x, const_(2)));
      const vars = getVariables(expr);
      expect(vars.has("x")).toBe(true);
      expect(vars.has("y")).toBe(true);
      expect(vars.size).toBe(2);
    });

    it("hasVariable", () => {
      const x = var_("x");
      const expr = mul(x, const_(2));
      expect(hasVariable(expr, "x")).toBe(true);
      expect(hasVariable(expr, "y")).toBe(false);
    });

    it("isPureConstant", () => {
      expect(isPureConstant(const_(42))).toBe(true);
      expect(isPureConstant(add(const_(1), const_(2)))).toBe(true);
      expect(isPureConstant(var_("x"))).toBe(false);
      expect(isPureConstant(add(var_("x"), const_(1)))).toBe(false);
    });

    it("depth", () => {
      const x = var_("x");
      expect(depth(x)).toBe(1);
      expect(depth(add(x, const_(1)))).toBe(2);
      expect(depth(add(mul(x, x), const_(1)))).toBe(3);
    });

    it("nodeCount", () => {
      const x = var_("x");
      expect(nodeCount(x)).toBe(1);
      expect(nodeCount(add(x, const_(1)))).toBe(3);
    });
  });

  describe("expressionsEqual", () => {
    it("compares constants", () => {
      expect(expressionsEqual(const_(5), const_(5))).toBe(true);
      expect(expressionsEqual(const_(5), const_(6))).toBe(false);
    });

    it("compares variables", () => {
      expect(expressionsEqual(var_("x"), var_("x"))).toBe(true);
      expect(expressionsEqual(var_("x"), var_("y"))).toBe(false);
    });

    it("compares binary operations", () => {
      const x = var_("x");
      expect(expressionsEqual(add(x, const_(1)), add(x, const_(1)))).toBe(true);
      expect(expressionsEqual(add(x, const_(1)), add(x, const_(2)))).toBe(false);
      expect(expressionsEqual(add(x, const_(1)), mul(x, const_(1)))).toBe(false);
    });

    it("compares unary operations", () => {
      const x = var_("x");
      expect(expressionsEqual(neg(x), neg(x))).toBe(true);
      expect(expressionsEqual(neg(x), neg(var_("y")))).toBe(false);
      expect(expressionsEqual(abs(x), abs(x))).toBe(true);
    });

    it("compares function calls", () => {
      const x = var_("x");
      expect(expressionsEqual(sin(x), sin(x))).toBe(true);
      expect(expressionsEqual(sin(x), asin(x))).toBe(false);
    });

    it("returns false for different kinds", () => {
      expect(expressionsEqual(const_(1), var_("x"))).toBe(false);
    });
  });

  describe("SimplifyOptions", () => {
    it("respects maxIterations option", () => {
      const x = var_("x");
      const expr = add(x, ZERO);
      const result = simplify(expr, { maxIterations: 1 });
      expect(result.kind).toBe("variable");
    });

    it("accepts custom rules", () => {
      const x = var_("x");
      const expr = mul(x, const_(2));

      const customRule: SimplificationRule = (e) => {
        if (e.kind === "binary" && e.op === "*") {
          if (e.right.kind === "constant" && e.right.value === 2) {
            return add(e.left, e.left);
          }
        }
        return null;
      };

      const result = simplify(expr, { customRules: [customRule] });
      expect(result.kind).toBe("binary");
      if (result.kind === "binary") {
        expect(result.op).toBe("+");
      }
    });

    it("respects customOnly option", () => {
      const x = var_("x");
      const expr = add(x, ZERO);

      const result = simplify(expr, { customOnly: true, customRules: [] });
      expect(result.kind).toBe("binary");

      const resultWithBuiltin = simplify(expr, { customOnly: false });
      expect(resultWithBuiltin.kind).toBe("variable");
    });
  });
});

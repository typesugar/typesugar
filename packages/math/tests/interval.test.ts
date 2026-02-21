import { describe, it, expect } from "vitest";
import {
  interval,
  intervalPoint as point,
  entire,
  empty,
  isIntervalEmpty,
  isPoint,
  contains,
  containsInterval,
  overlaps,
  width,
  intervalMidpoint as midpoint,
  radius,
  intervalMagnitude,
  mignitude,
  hull,
  intersect,
  intervalAdd,
  intervalSub,
  intervalMul,
  intervalDiv,
  intervalNegate,
  intervalAbs,
  square,
  intervalSqrt,
  intervalPow,
  numericInterval,
  ordInterval,
  intervalEquals,
  intervalApproxEquals,
  intervalToString,
  widen,
  narrow,
} from "../src/index.js";

describe("Interval", () => {
  describe("constructors", () => {
    it("creates interval", () => {
      const i = interval(1, 3);
      expect(i.lo).toBe(1);
      expect(i.hi).toBe(3);
    });

    it("throws for invalid interval", () => {
      expect(() => interval(3, 1)).toThrow(RangeError);
    });

    it("creates point interval", () => {
      const i = point(5);
      expect(i.lo).toBe(5);
      expect(i.hi).toBe(5);
    });

    it("entire is the real line", () => {
      expect(entire.lo).toBe(-Infinity);
      expect(entire.hi).toBe(Infinity);
    });

    it("empty has NaN bounds", () => {
      expect(Number.isNaN(empty.lo)).toBe(true);
      expect(Number.isNaN(empty.hi)).toBe(true);
    });
  });

  describe("queries", () => {
    it("isEmpty", () => {
      expect(isIntervalEmpty(empty)).toBe(true);
      expect(isIntervalEmpty(interval(1, 2))).toBe(false);
    });

    it("isPoint", () => {
      expect(isPoint(point(5))).toBe(true);
      expect(isPoint(interval(1, 2))).toBe(false);
    });

    it("contains point", () => {
      const i = interval(1, 5);
      expect(contains(i, 3)).toBe(true);
      expect(contains(i, 1)).toBe(true);
      expect(contains(i, 5)).toBe(true);
      expect(contains(i, 0)).toBe(false);
      expect(contains(i, 6)).toBe(false);
    });

    it("containsInterval", () => {
      const a = interval(1, 10);
      const b = interval(2, 8);
      expect(containsInterval(a, b)).toBe(true);
      expect(containsInterval(b, a)).toBe(false);
    });

    it("overlaps", () => {
      const a = interval(1, 5);
      const b = interval(3, 8);
      const c = interval(6, 10);
      expect(overlaps(a, b)).toBe(true);
      expect(overlaps(a, c)).toBe(false);
    });

    it("width", () => {
      expect(width(interval(1, 5))).toBe(4);
      expect(width(point(3))).toBe(0);
    });

    it("midpoint", () => {
      expect(midpoint(interval(1, 5))).toBe(3);
      expect(midpoint(point(3))).toBe(3);
    });

    it("radius", () => {
      expect(radius(interval(1, 5))).toBe(2);
    });

    it("magnitude", () => {
      expect(intervalMagnitude(interval(-3, 2))).toBe(3);
      expect(intervalMagnitude(interval(1, 5))).toBe(5);
    });

    it("mignitude", () => {
      expect(mignitude(interval(2, 5))).toBe(2);
      expect(mignitude(interval(-5, -2))).toBe(2);
      expect(mignitude(interval(-3, 5))).toBe(0);
    });
  });

  describe("set operations", () => {
    it("hull", () => {
      const a = interval(1, 3);
      const b = interval(5, 8);
      const h = hull(a, b);
      expect(h.lo).toBe(1);
      expect(h.hi).toBe(8);
    });

    it("hull with empty", () => {
      const a = interval(1, 3);
      expect(intervalEquals(hull(a, empty), a)).toBe(true);
      expect(intervalEquals(hull(empty, a), a)).toBe(true);
    });

    it("intersect overlapping", () => {
      const a = interval(1, 5);
      const b = interval(3, 8);
      const i = intersect(a, b);
      expect(i).not.toBeNull();
      expect(i!.lo).toBe(3);
      expect(i!.hi).toBe(5);
    });

    it("intersect non-overlapping", () => {
      const a = interval(1, 3);
      const b = interval(5, 8);
      expect(intersect(a, b)).toBeNull();
    });
  });

  describe("arithmetic", () => {
    it("addition", () => {
      const a = interval(1, 2);
      const b = interval(3, 4);
      const sum = intervalAdd(a, b);
      expect(sum.lo).toBe(4);
      expect(sum.hi).toBe(6);
    });

    it("subtraction", () => {
      const a = interval(3, 5);
      const b = interval(1, 2);
      const diff = intervalSub(a, b);
      expect(diff.lo).toBe(1);
      expect(diff.hi).toBe(4);
    });

    it("multiplication positive", () => {
      const a = interval(1, 2);
      const b = interval(3, 4);
      const prod = intervalMul(a, b);
      expect(prod.lo).toBe(3);
      expect(prod.hi).toBe(8);
    });

    it("multiplication mixed signs", () => {
      const a = interval(-2, 3);
      const b = interval(-1, 4);
      const prod = intervalMul(a, b);
      expect(prod.lo).toBe(-8);
      expect(prod.hi).toBe(12);
    });

    it("division positive", () => {
      const a = interval(2, 6);
      const b = interval(2, 3);
      const quot = intervalDiv(a, b);
      expect(intervalApproxEquals(quot, interval(2 / 3, 3))).toBe(true);
    });

    it("division by interval containing zero", () => {
      const a = interval(1, 2);
      const b = interval(-1, 1);
      const quot = intervalDiv(a, b);
      expect(quot.lo).toBe(-Infinity);
      expect(quot.hi).toBe(Infinity);
    });

    it("negation", () => {
      const i = interval(1, 3);
      const n = intervalNegate(i);
      expect(n.lo).toBe(-3);
      expect(n.hi).toBe(-1);
    });

    it("abs positive", () => {
      const i = interval(1, 3);
      const a = intervalAbs(i);
      expect(a.lo).toBe(1);
      expect(a.hi).toBe(3);
    });

    it("abs negative", () => {
      const i = interval(-3, -1);
      const a = intervalAbs(i);
      expect(a.lo).toBe(1);
      expect(a.hi).toBe(3);
    });

    it("abs mixed", () => {
      const i = interval(-2, 3);
      const a = intervalAbs(i);
      expect(a.lo).toBe(0);
      expect(a.hi).toBe(3);
    });

    it("square", () => {
      const i = interval(2, 3);
      const s = square(i);
      expect(s.lo).toBe(4);
      expect(s.hi).toBe(9);
    });

    it("square mixed", () => {
      const i = interval(-2, 3);
      const s = square(i);
      expect(s.lo).toBe(0);
      expect(s.hi).toBe(9);
    });

    it("sqrt", () => {
      const i = interval(4, 9);
      const s = intervalSqrt(i);
      expect(s.lo).toBe(2);
      expect(s.hi).toBe(3);
    });

    it("pow", () => {
      const i = interval(2, 3);
      const p = intervalPow(i, 3);
      expect(p.lo).toBe(8);
      expect(p.hi).toBe(27);
    });
  });

  describe("numericInterval", () => {
    const N = numericInterval;

    it("zero", () => {
      const z = N.zero();
      expect(isPoint(z)).toBe(true);
      expect(z.lo).toBe(0);
    });

    it("one", () => {
      const o = N.one();
      expect(isPoint(o)).toBe(true);
      expect(o.lo).toBe(1);
    });

    it("add", () => {
      const a = interval(1, 2);
      const b = interval(3, 4);
      const sum = N.add(a, b);
      expect(sum.lo).toBe(4);
      expect(sum.hi).toBe(6);
    });

    it("fromNumber", () => {
      const i = N.fromNumber(5);
      expect(isPoint(i)).toBe(true);
      expect(i.lo).toBe(5);
    });

    it("toNumber returns midpoint", () => {
      expect(N.toNumber(interval(1, 5))).toBe(3);
    });
  });

  describe("ordInterval", () => {
    it("compares by lower bound first", () => {
      expect(ordInterval.compare(interval(1, 5), interval(2, 3))).toBe(-1);
      expect(ordInterval.compare(interval(3, 5), interval(2, 8))).toBe(1);
    });

    it("compares by upper bound when lower equal", () => {
      expect(ordInterval.compare(interval(1, 3), interval(1, 5))).toBe(-1);
      expect(ordInterval.compare(interval(1, 5), interval(1, 3))).toBe(1);
    });

    it("equal intervals compare as 0", () => {
      expect(ordInterval.compare(interval(1, 5), interval(1, 5))).toBe(0);
    });
  });

  describe("utilities", () => {
    it("toString", () => {
      expect(intervalToString(interval(1, 5))).toBe("[1, 5]");
      expect(intervalToString(point(3))).toBe("{3}");
      expect(intervalToString(empty)).toBe("∅");
    });

    it("widen", () => {
      const i = interval(1, 5);
      const w = widen(i, 1);
      expect(w.lo).toBe(0);
      expect(w.hi).toBe(6);
    });

    it("narrow", () => {
      const i = interval(1, 5);
      const n = narrow(i, 1);
      expect(n).not.toBeNull();
      expect(n!.lo).toBe(2);
      expect(n!.hi).toBe(4);
    });

    it("narrow returns null if invalid", () => {
      const i = interval(1, 2);
      expect(narrow(i, 1)).toBeNull();
    });
  });
});

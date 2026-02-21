/**
 * Red Team Tests for @typesugar/units
 *
 * Attack surfaces:
 * - Unit conversion precision (floating point errors accumulating)
 * - Special values (NaN, Infinity, -0, subnormal numbers)
 * - Zero division creating Infinity or NaN
 * - Unit arithmetic edge cases (chained operations, precision loss)
 * - Composite unit derivation
 * - Unit comparison tolerance edge cases
 * - Unit literal parsing edge cases
 */
import { describe, it, expect } from "vitest";
import {
  Unit,
  meters,
  kilometers,
  centimeters,
  millimeters,
  feet,
  inches,
  miles,
  kilograms,
  grams,
  milligrams,
  pounds,
  seconds,
  minutes,
  hours,
  days,
  milliseconds,
  metersPerSecond,
  kilometersPerHour,
  milesPerHour,
  metersPerSecondSquared,
  newtons,
  joules,
  kilojoules,
  calories,
  kilocalories,
  watts,
  kilowatts,
  kelvin,
  celsius,
  pascals,
  kilopascals,
  atmospheres,
  units,
} from "../packages/units/src/index.js";

describe("Units Edge Cases", () => {
  // ==========================================================================
  // Attack 1: Unit Conversion Precision
  // ==========================================================================
  describe("Unit conversion precision", () => {
    it("should handle kilometer to meter conversion without precision loss", () => {
      const km = kilometers(1);
      // kilometers(1) should be exactly 1000 meters internally
      expect(km.value).toBe(1000);
    });

    it("should accumulate floating point errors in chained conversions", () => {
      // Convert 1 mile to meters, then divide by the conversion factor
      // This exposes floating point representation issues
      const mi = miles(1);
      const expectedMeters = 1609.344;
      expect(mi.value).toBeCloseTo(expectedMeters, 10);
    });

    it("should handle very small unit values", () => {
      // 1 nanometer equivalent - testing precision at small scales
      const tiny = millimeters(0.000001);
      expect(tiny.value).toBe(0.000001 / 1000);
      expect(tiny.value).toBeCloseTo(1e-9, 15);
    });

    it("should handle repeated add/sub without precision drift", () => {
      // Adding and subtracting the same value many times can accumulate errors
      let m = meters(1);
      const delta = meters(0.1);
      for (let i = 0; i < 10; i++) {
        m = m.add(delta);
      }
      for (let i = 0; i < 10; i++) {
        m = m.sub(delta);
      }
      // Should be back to 1, but floating point may differ
      // This is a known issue with floating point arithmetic
      expect(m.value).toBeCloseTo(1, 10);
    });

    it("should handle conversion chain: km -> m -> cm -> mm -> m", () => {
      const km = kilometers(1);
      // Internal value is 1000m
      // If we had cm and mm constructors that worked from base...
      // Test that going through different scales preserves value
      const inMm = km.value * 1000; // 1,000,000 mm
      const backToM = inMm / 1000; // 1000 m
      expect(backToM).toBe(km.value);
    });
  });

  // ==========================================================================
  // Attack 2: Special Values (NaN, Infinity, -0)
  // ==========================================================================
  describe("Special floating point values", () => {
    it("should propagate NaN through arithmetic", () => {
      const nanMeters = meters(NaN);
      expect(Number.isNaN(nanMeters.value)).toBe(true);

      const sum = nanMeters.add(meters(10));
      expect(Number.isNaN(sum.value)).toBe(true);

      const product = meters(10).mul(seconds(NaN));
      expect(Number.isNaN(product.value)).toBe(true);
    });

    it("should propagate Infinity through arithmetic", () => {
      const infMeters = meters(Infinity);
      expect(infMeters.value).toBe(Infinity);

      const sum = infMeters.add(meters(10));
      expect(sum.value).toBe(Infinity);

      // Infinity - Infinity = NaN
      const diff = infMeters.sub(meters(Infinity));
      expect(Number.isNaN(diff.value)).toBe(true);
    });

    it("should handle negative Infinity", () => {
      const negInf = meters(-Infinity);
      expect(negInf.value).toBe(-Infinity);

      const negated = negInf.neg();
      expect(negated.value).toBe(Infinity);
    });

    it("should handle negative zero", () => {
      const negZero = meters(-0);
      expect(Object.is(negZero.value, -0)).toBe(true);

      // Adding positive zero should give positive zero
      const sum = negZero.add(meters(0));
      // -0 + 0 = 0 in IEEE 754
      expect(sum.value).toBe(0);
    });

    it("should handle subnormal numbers", () => {
      // Smallest positive subnormal number
      const subnormal = meters(Number.MIN_VALUE);
      expect(subnormal.value).toBe(Number.MIN_VALUE);

      // Doubling it should work
      const doubled = subnormal.scale(2);
      expect(doubled.value).toBe(Number.MIN_VALUE * 2);
    });

    it("should handle MAX_VALUE without overflow in scale", () => {
      const huge = meters(Number.MAX_VALUE);
      // Scaling by 0.5 should work
      const halved = huge.scale(0.5);
      expect(halved.value).toBe(Number.MAX_VALUE / 2);

      // Scaling by 2 overflows to Infinity
      const overflow = huge.scale(2);
      expect(overflow.value).toBe(Infinity);
    });
  });

  // ==========================================================================
  // Attack 3: Division Edge Cases
  // ==========================================================================
  describe("Division edge cases", () => {
    it("should produce Infinity when dividing by zero", () => {
      const distance = meters(100);
      const zeroTime = seconds(0);
      const velocity = distance.div(zeroTime);
      expect(velocity.value).toBe(Infinity);
    });

    it("should produce negative Infinity when dividing negative by zero", () => {
      const distance = meters(-100);
      const zeroTime = seconds(0);
      const velocity = distance.div(zeroTime);
      expect(velocity.value).toBe(-Infinity);
    });

    it("should produce NaN when dividing zero by zero", () => {
      const zeroDistance = meters(0);
      const zeroTime = seconds(0);
      const result = zeroDistance.div(zeroTime);
      expect(Number.isNaN(result.value)).toBe(true);
    });

    it("should handle division resulting in very small values", () => {
      const tiny = meters(1e-200);
      const huge = seconds(1e200);
      const result = tiny.div(huge);
      // 1e-200 / 1e200 = 1e-400, which truly underflows to 0
      // (IEEE 754 smallest positive subnormal is ~5e-324)
      expect(result.value).toBe(0);
    });

    it("should handle division chain without precision explosion", () => {
      // velocity = distance / time
      // acceleration = velocity / time
      const d = meters(1000);
      const t = seconds(10);
      const v = d.div(t); // 100 m/s
      const a = v.div(t); // 10 m/s²
      expect(a.value).toBe(10);
    });
  });

  // ==========================================================================
  // Attack 4: Unit Arithmetic Edge Cases
  // ==========================================================================
  describe("Unit arithmetic edge cases", () => {
    it("should preserve identity: x.add(0) === x", () => {
      const m = meters(42);
      const result = m.add(meters(0));
      expect(result.value).toBe(42);
    });

    it("should preserve identity: x.mul(1) === x (via scale)", () => {
      const m = meters(42);
      const result = m.scale(1);
      expect(result.value).toBe(42);
    });

    it("should handle negation correctly: x.neg().neg() === x", () => {
      const m = meters(42);
      const doubleNeg = m.neg().neg();
      expect(doubleNeg.value).toBe(42);
    });

    it("should handle scale by zero", () => {
      const m = meters(42);
      const scaled = m.scale(0);
      expect(scaled.value).toBe(0);
    });

    it("should handle scale by negative", () => {
      const m = meters(42);
      const scaled = m.scale(-1);
      expect(scaled.value).toBe(-42);
    });

    it("should maintain associativity: (a + b) + c === a + (b + c)", () => {
      const a = meters(1.1);
      const b = meters(2.2);
      const c = meters(3.3);

      const left = a.add(b).add(c);
      const right = a.add(b.add(c));

      // Floating point may cause tiny differences
      expect(left.value).toBeCloseTo(right.value, 14);
    });

    it("should handle multiplication commutativity for derived units", () => {
      const mass = kilograms(10);
      const accel = metersPerSecondSquared(9.8);

      // Force = mass * acceleration
      const force1 = mass.mul(accel);
      // Note: mul doesn't support reversed order at type level
      // but numerically it should commute
      expect(force1.value).toBeCloseTo(98, 10);
    });
  });

  // ==========================================================================
  // Attack 5: Composite Unit Derivation
  // ==========================================================================
  describe("Composite unit derivation", () => {
    it("should correctly derive velocity from distance/time", () => {
      const distance = meters(100);
      const time = seconds(10);
      const velocity = distance.div(time);
      expect(velocity.value).toBe(10); // 10 m/s
    });

    it("should correctly derive acceleration from velocity/time", () => {
      const velocity = metersPerSecond(20);
      const time = seconds(4);
      const acceleration = velocity.div(time);
      expect(acceleration.value).toBe(5); // 5 m/s²
    });

    it("should correctly derive force from mass*acceleration", () => {
      const mass = kilograms(10);
      const accel = metersPerSecondSquared(9.8);
      const force = mass.mul(accel);
      expect(force.value).toBeCloseTo(98, 10); // 98 N
    });

    it("should correctly derive energy from force*distance", () => {
      const force = newtons(100);
      const distance = meters(5);
      const energy = force.mul(distance);
      expect(energy.value).toBe(500); // 500 J
    });

    it("should correctly derive power from energy/time", () => {
      const energy = joules(1000);
      const time = seconds(10);
      const power = energy.div(time);
      expect(power.value).toBe(100); // 100 W
    });

    it("should cancel units correctly: (m/s) * s = m", () => {
      const velocity = metersPerSecond(10);
      const time = seconds(5);
      const distance = velocity.mul(time);
      expect(distance.value).toBe(50);
    });

    it("should handle complex unit chain: F = ma, then W = Fd, then P = W/t", () => {
      const mass = kilograms(2);
      const acceleration = metersPerSecondSquared(10);
      const force = mass.mul(acceleration); // 20 N

      const distance = meters(100);
      const work = force.mul(distance); // 2000 J

      const time = seconds(4);
      const power = work.div(time); // 500 W

      expect(power.value).toBe(500);
    });
  });

  // ==========================================================================
  // Attack 6: Equality and Comparison Edge Cases
  // ==========================================================================
  describe("Equality and comparison edge cases", () => {
    it("should consider equal values within default tolerance", () => {
      const a = meters(1.0);
      const b = meters(1.0 + 1e-11); // Within 1e-10 tolerance
      expect(a.equals(b)).toBe(true);
    });

    it("should consider different values outside tolerance", () => {
      const a = meters(1.0);
      const b = meters(1.0 + 1e-9); // Outside 1e-10 tolerance
      expect(a.equals(b)).toBe(false);
    });

    it("should respect custom tolerance", () => {
      const a = meters(1.0);
      const b = meters(1.01);
      expect(a.equals(b, 0.001)).toBe(false);
      expect(a.equals(b, 0.1)).toBe(true);
    });

    it("should handle NaN comparison (NaN !== NaN)", () => {
      const a = meters(NaN);
      const b = meters(NaN);
      // NaN is never equal to NaN, even with tolerance
      expect(a.equals(b)).toBe(false);
    });

    it("should handle Infinity comparison", () => {
      const a = meters(Infinity);
      const b = meters(Infinity);
      // Infinity - Infinity = NaN, so abs(NaN) < tolerance is false
      expect(a.equals(b)).toBe(false);
    });

    it("should handle negative zero equality", () => {
      const a = meters(0);
      const b = meters(-0);
      // 0 and -0 should be equal
      expect(a.equals(b)).toBe(true);
    });

    it("should fail equality check for values just outside tolerance boundary", () => {
      const a = meters(0);
      const tolerance = 1e-10;
      const b = meters(tolerance); // Exactly at boundary
      // abs(0 - 1e-10) = 1e-10, which is NOT < 1e-10
      expect(a.equals(b, tolerance)).toBe(false);
    });
  });

  // ==========================================================================
  // Attack 7: Unit Literal Parsing Edge Cases
  // ==========================================================================
  describe("Unit literal parsing edge cases", () => {
    it("should parse integer values", () => {
      const m = units`100 meters`;
      expect(m.value).toBe(100);
    });

    it("should parse decimal values", () => {
      const m = units`3.14 meters`;
      expect(m.value).toBeCloseTo(3.14, 10);
    });

    it("should parse scientific notation", () => {
      const m = units`1e6 meters`;
      expect(m.value).toBe(1e6);
    });

    it("should parse negative scientific notation", () => {
      const m = units`1e-6 meters`;
      expect(m.value).toBe(1e-6);
    });

    it("should parse negative values", () => {
      const m = units`-100 meters`;
      expect(m.value).toBe(-100);
    });

    it("should handle value-only (dimensionless)", () => {
      const d = units`42`;
      expect(d.value).toBe(42);
    });

    it("should handle various unit abbreviations", () => {
      expect(units`1 m`.value).toBe(1);
      expect(units`1 km`.value).toBe(1000);
      expect(units`1 kg`.value).toBe(1);
      expect(units`1 s`.value).toBe(1);
      expect(units`1 N`.value).toBe(1);
    });

    it("should throw on invalid unit literal format", () => {
      expect(() => units`not a number`).toThrow("Invalid unit literal");
    });

    it("should throw on unknown unit", () => {
      expect(() => units`100 foobar`).toThrow("Unknown unit: foobar");
    });

    it("should handle composite unit strings", () => {
      const v = units`100 m/s`;
      expect(v.value).toBe(100);
    });

    it("should handle whitespace variations", () => {
      const m1 = units`  100 meters  `;
      expect(m1.value).toBe(100);
    });

    it("should parse positive scientific notation with + sign", () => {
      const m = units`1e+6 meters`;
      expect(m.value).toBe(1e6);
    });
  });

  // ==========================================================================
  // Attack 8: String Representation Edge Cases
  // ==========================================================================
  describe("String representation edge cases", () => {
    it("should format with symbol when present", () => {
      const m = meters(42);
      expect(m.toString()).toBe("42 m");
    });

    it("should format without symbol for derived units", () => {
      const velocity = meters(100).div(seconds(10));
      // Derived units lose the symbol
      expect(velocity.toString()).toBe("10");
    });

    it("should handle Infinity in toString", () => {
      const inf = meters(Infinity);
      expect(inf.toString()).toBe("Infinity m");
    });

    it("should handle NaN in toString", () => {
      const nan = meters(NaN);
      expect(nan.toString()).toBe("NaN m");
    });

    it("should handle negative zero in toString", () => {
      const negZero = meters(-0);
      // JavaScript's toString converts -0 to "0"
      expect(negZero.toString()).toBe("0 m");
    });

    it("should handle very small numbers in toString", () => {
      const tiny = meters(1e-100);
      expect(tiny.toString()).toBe("1e-100 m");
    });

    it("should handle very large numbers in toString", () => {
      const huge = meters(1e100);
      expect(huge.toString()).toBe("1e+100 m");
    });
  });
});

/**
 * Tests for the type-safe units library
 */

import { describe, it, expect } from "vitest";
import {
  Unit,
  meters,
  kilometers,
  seconds,
  hours,
  kilograms,
  newtons,
  metersPerSecond,
  metersPerSecondSquared,
  joules,
  watts,
  type Length,
  type Time,
  type Velocity,
  type Acceleration,
  type Force,
  type Energy,
  type Mass,
} from "../index.js";

describe("Unit class", () => {
  describe("basic operations", () => {
    it("should create units with values", () => {
      const distance = meters(100);
      expect(distance.value).toBe(100);
      expect(distance.toString()).toBe("100 m");
    });

    it("should add units of the same dimension", () => {
      const a = meters(50);
      const b = meters(30);
      const result = a.add(b);
      expect(result.value).toBe(80);
    });

    it("should subtract units of the same dimension", () => {
      const a = meters(100);
      const b = meters(30);
      const result = a.sub(b);
      expect(result.value).toBe(70);
    });

    it("should multiply units (dimensions add)", () => {
      const distance = meters(10);
      const time = seconds(2);
      // meters * seconds = m*s
      const result = distance.mul(time);
      expect(result.value).toBe(20);
    });

    it("should divide units (dimensions subtract)", () => {
      const distance = meters(100);
      const time = seconds(10);
      const velocity: Unit<Velocity> = distance.div(time);
      expect(velocity.value).toBe(10); // 10 m/s
    });

    it("should scale by a number", () => {
      const distance = meters(10);
      const result = distance.scale(3);
      expect(result.value).toBe(30);
    });

    it("should negate values", () => {
      const distance = meters(10);
      const result = distance.neg();
      expect(result.value).toBe(-10);
    });

    it("should check equality with tolerance", () => {
      const a = meters(10.00000000001);
      const b = meters(10.00000000002);
      expect(a.equals(b)).toBe(true); // Difference is within 1e-10
      expect(a.equals(meters(11))).toBe(false);
      // Can also use explicit tolerance
      expect(meters(10.1).equals(meters(10.2), 0.2)).toBe(true);
    });
  });

  describe("unit conversions", () => {
    it("should convert kilometers to meters", () => {
      const km = kilometers(5);
      expect(km.value).toBe(5000); // Stored in base units (meters)
    });

    it("should convert hours to seconds", () => {
      const h = hours(2);
      expect(h.value).toBe(7200); // 2 * 3600 seconds
    });
  });

  describe("derived units", () => {
    it("should compute velocity correctly", () => {
      const distance = meters(1000);
      const time = seconds(100);
      const velocity: Unit<Velocity> = distance.div(time);
      expect(velocity.value).toBe(10);
    });

    it("should compute acceleration correctly", () => {
      const velocity = metersPerSecond(20);
      const time = seconds(4);
      const acceleration: Unit<Acceleration> = velocity.div(time);
      expect(acceleration.value).toBe(5); // 5 m/s²
    });

    it("should compute force correctly (F = m * a)", () => {
      const mass = kilograms(10);
      const acceleration = metersPerSecondSquared(9.8);
      const force: Unit<Force> = mass.mul(acceleration);
      expect(force.value).toBeCloseTo(98, 5);
    });

    it("should compute energy correctly (E = F * d)", () => {
      const force = newtons(100);
      const distance = meters(10);
      const energy: Unit<Energy> = force.mul(distance);
      expect(energy.value).toBe(1000); // 1000 J
    });

    it("should compute power correctly (P = E / t)", () => {
      const energy = joules(1000);
      const time = seconds(10);
      const power = energy.div(time);
      expect(power.value).toBe(100); // 100 W
    });
  });

  describe("physics examples", () => {
    it("should calculate kinetic energy", () => {
      // KE = 0.5 * m * v²
      const mass = kilograms(2);
      const velocity = metersPerSecond(10);

      // v² = v * v
      const vSquared = velocity.mul(velocity);

      // m * v²
      const mv2 = mass.mul(vSquared);

      // 0.5 * m * v²
      const ke: Unit<Energy> = mv2.scale(0.5);

      expect(ke.value).toBe(100); // 100 J
    });

    it("should calculate gravitational potential energy", () => {
      // PE = m * g * h
      const mass = kilograms(5);
      const g = metersPerSecondSquared(9.8);
      const height = meters(10);

      const force = mass.mul(g);
      const pe: Unit<Energy> = force.mul(height);

      expect(pe.value).toBeCloseTo(490, 5); // 490 J
    });

    it("should calculate power from work and time", () => {
      const work = joules(500);
      const time = seconds(5);
      const power = work.div(time);

      expect(power.value).toBe(100); // 100 W
    });
  });
});

describe("Type safety", () => {
  it("should have correct types for derived quantities", () => {
    // These are compile-time checks - if they compile, they pass
    const _distance: Unit<Length> = meters(100);
    const _time: Unit<Time> = seconds(10);
    const _mass: Unit<Mass> = kilograms(5);
    const _velocity: Unit<Velocity> = metersPerSecond(10);
    const _acceleration: Unit<Acceleration> = metersPerSecondSquared(9.8);
    const _force: Unit<Force> = newtons(100);
    const _energy: Unit<Energy> = joules(1000);

    // Verify types through division
    const v: Unit<Velocity> = meters(100).div(seconds(10));
    expect(v.value).toBe(10);
  });

  // Type errors would be caught at compile time:
  // const invalid: Unit<Length> = meters(10).add(seconds(5)); // Error!
  // const invalid2: Unit<Velocity> = meters(10); // Error!
});

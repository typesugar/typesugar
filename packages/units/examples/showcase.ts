/**
 * @typesugar/units Showcase
 *
 * Self-documenting examples of type-safe physical units:
 * dimensional analysis enforced at compile time, unit constructors,
 * derived quantities, arithmetic operations, and the units`` macro.
 *
 * Type assertions used:
 *   typeAssert<Equal<A, B>>()        - A and B are the same type
 *   typeAssert<Extends<A, B>>()      - A is assignable to B
 *   typeAssert<Not<Equal<A, B>>>()   - A and B are DIFFERENT
 *   typeAssert<Not<Extends<A, B>>>() - A is NOT assignable to B
 *
 * Run:   typesugar run examples/showcase.ts
 * Build: npx tspc && node dist/examples/showcase.js
 */

import { assert, typeAssert, type Equal, type Extends, type Not } from "@typesugar/testing";

import {
  // Unit class and dimension types
  Unit,
  type Dimensions,
  type DimExp,
  type Dimensionless,
  type Length,
  type Mass,
  type Time,
  type Velocity,
  type Acceleration,
  type Force,
  type Energy,
  type Power,
  type Temperature,
  type Pressure,
  type Area,
  type Volume,
  type Frequency,

  // Dimension arithmetic
  type MulDimensions,
  type DivDimensions,
  type SameDimensions,

  // Length constructors
  meters,
  kilometers,
  centimeters,
  millimeters,
  feet,
  inches,
  miles,

  // Mass constructors
  kilograms,
  grams,
  milligrams,
  pounds,

  // Time constructors
  seconds,
  minutes,
  hours,
  days,
  milliseconds,

  // Velocity constructors
  metersPerSecond,
  kilometersPerHour,
  milesPerHour,

  // Acceleration
  metersPerSecondSquared,

  // Force, Energy, Power
  newtons,
  joules,
  kilojoules,
  calories,
  kilocalories,
  watts,
  kilowatts,

  // Temperature
  kelvin,
  celsius,

  // Pressure
  pascals,
  kilopascals,
  atmospheres,

  // Tagged template macro
  units,
} from "../src/index.js";

// ============================================================================
// 1. BASIC UNIT CONSTRUCTION - Type-Safe Physical Quantities
// ============================================================================

const distance = meters(100);
assert(distance.value === 100);
assert(distance.symbol === "m");

const mass = kilograms(5);
assert(mass.value === 5);
assert(mass.symbol === "kg");

const time = seconds(10);
assert(time.value === 10);
assert(time.symbol === "s");

// Units carry their dimensions in the type system
typeAssert<Equal<typeof distance, Unit<Length>>>();
typeAssert<Equal<typeof mass, Unit<Mass>>>();
typeAssert<Equal<typeof time, Unit<Time>>>();

// Different dimension types are distinct
typeAssert<Not<Equal<Unit<Length>, Unit<Mass>>>>();
typeAssert<Not<Equal<Unit<Time>, Unit<Velocity>>>>();

console.log("1. Basic construction: meters(100), kilograms(5), seconds(10)");

// ============================================================================
// 2. UNIT CONVERSIONS - Same Dimension, Different Scale
// ============================================================================

// Length conversions (all stored internally in base SI units)
const km = kilometers(1);
assert(km.value === 1000); // 1 km = 1000 m (stored in meters)

const cm = centimeters(100);
assert(cm.value === 1); // 100 cm = 1 m

const ft = feet(1);
assert(Math.abs(ft.value - 0.3048) < 0.0001);

const mi = miles(1);
assert(Math.abs(mi.value - 1609.344) < 0.001);

// Time conversions
const min = minutes(1);
assert(min.value === 60);

const hr = hours(1);
assert(hr.value === 3600);

const day = days(1);
assert(day.value === 86400);

const ms = milliseconds(1000);
assert(ms.value === 1); // 1000 ms = 1 s

// Mass conversions
const g = grams(1000);
assert(g.value === 1); // 1000 g = 1 kg

const lb = pounds(1);
assert(Math.abs(lb.value - 0.453592) < 0.001);

console.log("2. Unit conversions: km→m, ft→m, hours→s, grams→kg");

// ============================================================================
// 3. SAME-DIMENSION ARITHMETIC - Add and Subtract Compatible Units
// ============================================================================

const d1 = meters(100);
const d2 = meters(50);

// Addition preserves the dimension type
const total = d1.add(d2);
assert(total.value === 150);
typeAssert<Equal<typeof total, Unit<Length>>>();

// Subtraction also preserves dimensions
const diff = d1.sub(d2);
assert(diff.value === 50);
typeAssert<Equal<typeof diff, Unit<Length>>>();

// Negation
const neg = d1.neg();
assert(neg.value === -100);

// Scaling by a dimensionless number
const doubled = d1.scale(2);
assert(doubled.value === 200);
typeAssert<Equal<typeof doubled, Unit<Length>>>();

// Can add different units of the same dimension (both stored in meters)
const mixedDistance = meters(100).add(kilometers(0.5));
assert(mixedDistance.value === 600); // 100m + 500m

// COMPILE ERROR: Can't add meters to seconds
// const invalid = d1.add(time); // Type error!

console.log("3. Same-dimension arithmetic: add, sub, neg, scale");

// ============================================================================
// 4. CROSS-DIMENSION ARITHMETIC - Derived Quantities
// ============================================================================

// Division creates derived units
const velocity = distance.div(time);
assert(velocity.value === 10); // 100m / 10s = 10 m/s
typeAssert<Equal<typeof velocity, Unit<Velocity>>>();

// Multiplication creates derived units
const acceleration = velocity.div(time);
assert(acceleration.value === 1); // 10 m/s / 10s = 1 m/s²
typeAssert<Equal<typeof acceleration, Unit<Acceleration>>>();

const force = mass.mul(acceleration);
assert(force.value === 5); // 5kg * 1 m/s² = 5 N
typeAssert<Equal<typeof force, Unit<Force>>>();

// Energy = Force × Distance
const energy = force.mul(meters(10));
assert(energy.value === 50); // 5N * 10m = 50 J
typeAssert<Equal<typeof energy, Unit<Energy>>>();

// Power = Energy / Time
const power = energy.div(seconds(5));
assert(power.value === 10); // 50J / 5s = 10 W
typeAssert<Equal<typeof power, Unit<Power>>>();

console.log("4. Cross-dimension: velocity, acceleration, force, energy, power");

// ============================================================================
// 5. DIMENSION TYPES - Type-Level Dimensional Analysis
// ============================================================================

// Dimensions are encoded as exponents of SI base units: M^a L^b T^c ...
// Velocity = L^1 T^-1 (length per time)
// Force = M^1 L^1 T^-2 (mass × acceleration)

// MulDimensions adds exponents (multiplication)
type ForceType = MulDimensions<Mass, Acceleration>;
typeAssert<Equal<ForceType, Force>>();

// DivDimensions subtracts exponents (division)
type VelocityType = DivDimensions<Length, Time>;
typeAssert<Equal<VelocityType, Velocity>>();

type AccelerationType = DivDimensions<Velocity, Time>;
typeAssert<Equal<AccelerationType, Acceleration>>();

// SameDimensions checks type-level equality
typeAssert<Equal<SameDimensions<Length, Length>, true>>();
typeAssert<Equal<SameDimensions<Length, Mass>, false>>();

// Dimensionless quantities (all exponents = 0)
const ratio = meters(100).div(meters(50));
assert(ratio.value === 2);
typeAssert<Equal<typeof ratio, Unit<Dimensionless>>>();

console.log("5. Dimension types: MulDimensions, DivDimensions, SameDimensions");

// ============================================================================
// 6. DERIVED UNIT CONSTRUCTORS - Named Physical Quantities
// ============================================================================

// Velocity
const speed1 = metersPerSecond(30);
assert(speed1.value === 30);

const speed2 = kilometersPerHour(108);
assert(Math.abs(speed2.value - 30) < 0.01); // 108 km/h = 30 m/s

const speed3 = milesPerHour(60);
assert(Math.abs(speed3.value - 26.8224) < 0.01);

// Force
const n = newtons(10);
assert(n.value === 10);
typeAssert<Equal<typeof n, Unit<Force>>>();

// Energy
const j = joules(1000);
const kj = kilojoules(1);
assert(kj.value === 1000); // 1 kJ = 1000 J

const cal = calories(1);
assert(Math.abs(cal.value - 4.184) < 0.001); // 1 cal = 4.184 J

const kcal = kilocalories(1);
assert(Math.abs(kcal.value - 4184) < 1);

// Power
const w = watts(1000);
const kw = kilowatts(1);
assert(kw.value === 1000);

// Temperature
const temp1 = kelvin(273.15);
const temp2 = celsius(0);
assert(temp2.symbol === "°C");

// Pressure
const p1 = pascals(101325);
const p2 = kilopascals(101.325);
assert(Math.abs(p2.value - 101325) < 1);

const p3 = atmospheres(1);
assert(p3.value === 101325);

console.log("6. Derived constructors: newtons, joules, watts, kelvin, pascals, etc.");

// ============================================================================
// 7. UNITS TAGGED TEMPLATE - Parse Unit Expressions
// ============================================================================

// The units`` macro parses unit expressions at compile time
// (falls back to runtime parsing when transformer is not active)
const d = units`100 meters`;
assert(d.value === 100);

const s = units`60 km/h`;
assert(Math.abs(s.value - 16.667) < 0.01);

const m = units`5.5 kg`;
assert(m.value === 5.5);

const e = units`1000 J`;
assert(e.value === 1000);

const p = units`1 atm`;
assert(p.value === 101325);

// Supports various unit abbreviations
const d2short = units`42 m`;
assert(d2short.value === 42);

const t = units`30 s`;
assert(t.value === 30);

console.log("7. Units macro: units`100 km/h`, units`5.5 kg`, etc.");

// ============================================================================
// 8. EQUALITY AND COMPARISON - Tolerance-Based Checks
// ============================================================================

const a = meters(1.0);
const b = centimeters(100); // Also 1.0 meter internally

// Equality with default tolerance
assert(a.equals(b));

// Equality with custom tolerance
assert(a.equals(meters(1.0000001), 0.001));
assert(!a.equals(meters(2.0)));

// toString formatting
assert(meters(42).toString() === "42 m");
assert(kilograms(1.5).toString() === "1.5 kg");
assert(new Unit(3.14).toString() === "3.14"); // Dimensionless, no symbol

console.log("8. Equality: tolerance-based comparison, toString formatting");

// ============================================================================
// 9. REAL-WORLD EXAMPLE - Physics: Kinetic Energy
// ============================================================================

// KE = ½mv²
function kineticEnergy(m: Unit<Mass>, v: Unit<Velocity>): Unit<Energy> {
  return m.mul(v).mul(v).scale(0.5);
}

const carMass = kilograms(1500);
const carSpeed = metersPerSecond(30);
const ke = kineticEnergy(carMass, carSpeed);
assert(ke.value === 675000); // 0.5 × 1500 × 30² = 675000 J

// Can't accidentally swap mass and velocity — type error!
// kineticEnergy(carSpeed, carMass); // Compile error!

console.log("9. Physics: KE of 1500kg car at 30m/s =", ke.value, "J");

// ============================================================================
// 10. REAL-WORLD EXAMPLE - Dimensional Analysis Catches Bugs
// ============================================================================

// Calculate gravitational potential energy: PE = mgh
function potentialEnergy(
  m: Unit<Mass>,
  g: Unit<Acceleration>,
  h: Unit<Length>,
): Unit<Energy> {
  return m.mul(g).mul(h);
}

const earthG = metersPerSecondSquared(9.81);
const height = meters(10);
const pe = potentialEnergy(kilograms(2), earthG, height);
assert(Math.abs(pe.value - 196.2) < 0.1);

// Calculate work: W = F·d
function work(f: Unit<Force>, d: Unit<Length>): Unit<Energy> {
  return f.mul(d);
}

const w_result = work(newtons(50), meters(3));
assert(w_result.value === 150);

// Calculate power: P = W/t
function powerFromWork(w: Unit<Energy>, t: Unit<Time>): Unit<Power> {
  return w.div(t);
}

const p_result = powerFromWork(joules(150), seconds(5));
assert(p_result.value === 30);

console.log("10. Dimensional analysis: PE = mgh, W = F·d, P = W/t");

// ============================================================================
// SUMMARY
// ============================================================================

console.log("\n=== @typesugar/units Showcase Complete ===");
console.log(`
Features demonstrated:
  1. Type-safe unit construction (meters, kg, seconds)
  2. Unit conversions (km→m, hours→s, lbs→kg)
  3. Same-dimension arithmetic (add, sub, neg, scale)
  4. Cross-dimension arithmetic (velocity = distance/time)
  5. Type-level dimensional analysis (MulDimensions, DivDimensions)
  6. Derived unit constructors (newtons, joules, watts, pascals)
  7. Units tagged template macro (units\`100 km/h\`)
  8. Tolerance-based equality and formatting
  9. Physics: kinetic energy (½mv²)
 10. Dimensional analysis: PE=mgh, W=F·d, P=W/t

Zero-cost guarantee:
  All dimension checking happens at the type level.
  At runtime, Unit is just a number + optional symbol string.
  No dimension metadata is stored or checked at runtime.
`);

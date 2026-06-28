/**
 * Dry-run scenario: Scientific computing with type-safe physical units.
 *
 * Demonstrates @typesugar/units — dimensional analysis enforced in the type
 * system, with zero-cost runtime representation (every quantity is stored in
 * base SI units). Mixing incompatible dimensions is a compile-time error.
 *
 * Run:   typesugar run src/main.ts
 * Check: typesugar check
 */

import {
  meters,
  kilometers,
  seconds,
  kilograms,
  metersPerSecondSquared,
} from "@typesugar/units";

// --- Kinematics: a falling object -------------------------------------------

const g = metersPerSecondSquared(9.81); // gravitational acceleration
const fallTime = seconds(3);

// distance = ½ · g · t²  (derived dimensionally: (m/s²) · s · s = m)
const halfGT = g.scale(0.5).mul(fallTime); // m/s
const fallDistance = halfGT.mul(fallTime); // m
console.log(`After ${fallTime.value}s of free fall: ${fallDistance.value.toFixed(2)} m`);

// --- Newton's second law: F = m · a -----------------------------------------

const mass = kilograms(2);
const force = mass.mul(g); // kg · m/s² = N (Force)
console.log(`Weight of ${mass.value}kg at the surface: ${force.value.toFixed(2)} N`);

// --- Same-dimension arithmetic across scales --------------------------------

// kilometers and meters share the Length dimension; both stored in metres.
const route = kilometers(1.5).add(meters(250));
console.log(`Total route: ${route.value} m (${(route.value / 1000).toFixed(3)} km)`);

// --- Derived quantity: average velocity = distance / time -------------------

const avgVelocity = route.div(seconds(600)); // m / s = Velocity
console.log(`Average velocity: ${avgVelocity.value.toFixed(3)} m/s`);

// --- Dimensional safety (compile-time) --------------------------------------

// The following would be a TYPE ERROR — you cannot add a Length to a Time:
//   route.add(seconds(1)); // ✗ Argument of type 'Unit<Time>' is not assignable
// Dimensional analysis catches unit mismatches before the program ever runs.

console.log("\n✅ scientific-computing scenario completed");

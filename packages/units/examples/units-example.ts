/**
 * Physical Units Example
 *
 * Demonstrates compile-time dimensional analysis — the type system
 * catches unit mismatches before runtime. Adding meters to seconds
 * is a type error, not a runtime bug.
 */

import {
  meters,
  kilometers,
  seconds,
  hours,
  kilograms,
  metersPerSecond,
  kilometersPerHour,
  units,
} from "@typesugar/units";

console.log("=== Physical Units Example ===\n");

// --- Basic Units ---

console.log("--- Basic Units ---");

const distance = meters(100);
const time = seconds(10);

console.log(`Distance: ${distance.value} ${distance.symbol}`);
console.log(`Time: ${time.value} ${time.symbol}`);

// --- Derived Units Through Operations ---

console.log("\n--- Derived Units ---");

const velocity = distance.div(time);
console.log(`Velocity: ${velocity.value} ${velocity.symbol}`);

const mass = kilograms(5);
const acceleration = velocity.div(time);
const force = mass.mul(acceleration);
console.log(`Force: ${force.value} ${force.symbol}`);

// --- Unit Conversions ---
// All units store values in SI base units internally (.value property).
// To display in different units, divide by the appropriate conversion factor.

console.log("\n--- Conversions ---");

const distanceKm = kilometers(1);
// distanceKm.value is already in meters (SI base unit)
console.log(`1 km = ${distanceKm.value} m`);

const speedKmh = kilometersPerHour(100);
// speedKmh.value is in m/s (SI base unit for velocity)
console.log(`100 km/h = ${speedKmh.value.toFixed(2)} m/s`);

const timeHours = hours(2);
// timeHours.value is in seconds (SI base unit)
// Convert for display: divide by 60 for minutes
console.log(
  `2 hours = ${timeHours.value / 60} minutes = ${timeHours.value} seconds`,
);

// --- Same-Unit Arithmetic ---

console.log("\n--- Same-Unit Arithmetic ---");

const d1 = meters(100);
const d2 = meters(50);
const total = d1.add(d2);
console.log(`${d1.value}m + ${d2.value}m = ${total.value}m`);

// This would be a compile-time error:
// const invalid = d1.add(time);  // Can't add meters to seconds

// --- Unit Literals (with macro) ---

console.log("\n--- Unit Literals ---");

// The units`` macro parses unit expressions at compile time
const speed = units`100 km/h`;
const massUnit = units`5.5 kg`;
const energy = units`1000 J`;

console.log(`Speed: ${speed.value} ${speed.symbol}`);
console.log(`Mass: ${massUnit.value} ${massUnit.symbol}`);
console.log(`Energy: ${energy.value} ${energy.symbol}`);

// --- Physics Calculation ---

console.log("\n--- Physics: Kinetic Energy ---");

// KE = 0.5 * m * v^2
const carMass = kilograms(1500);
const carSpeed = metersPerSecond(30);
const kineticEnergy = carMass.mul(carSpeed).mul(carSpeed).scale(0.5);
console.log(
  `A ${carMass.value}kg car at ${carSpeed.value}m/s has ${kineticEnergy.value}J of kinetic energy`,
);

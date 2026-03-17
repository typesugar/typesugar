//! Dimensional Analysis
//! Type-safe physical quantities that prevent unit errors

import { meters, kilometers, seconds, minutes, hours } from "@typesugar/units";
import { metersPerSecond, kilograms, newtons } from "@typesugar/units";

// Create quantities with units
const distance = kilometers(42.195);
const time = hours(2).add(minutes(1)).add(seconds(39));

console.log("Marathon distance:", distance.toString());
console.log("World record time:", time.toString());

// Unit-safe arithmetic
const speed = distance.div(time);
console.log("Average speed:", speed.toString());

// Convert between units
const distInMeters = meters(distance.value * 1000);
console.log("In meters:", distInMeters.toString());

// Force = mass × acceleration
const mass = kilograms(75);
const acceleration = metersPerSecond(9.81);
const force = newtons(mass.value * acceleration.value);
console.log("\nForce (75kg × 9.81m/s²):", force.toString());

// The Mars Climate Orbiter lesson:
// Mixing units without type safety caused a $327M crash
const thrustLbf = 4.45; // pound-force (imperial)
const thrustN = newtons(thrustLbf * 4.44822); // correct conversion
console.log("\nThrust:", thrustN.toString(), "(properly converted)");

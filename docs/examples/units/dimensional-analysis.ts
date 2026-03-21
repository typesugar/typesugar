//! Dimensional Analysis
//! units macro + type-safe physical quantities

import { units, meters, seconds, kilograms, newtons } from "@typesugar/units";
// units`...` is a compile-time macro that parses unit literals
// 👀 Check JS Output: units`100 meters` → meters(100)
const marathon = units`42195 meters`;
const time = units`7299 seconds`;

console.log("Marathon:", marathon.toString());
console.log("Time:", time.toString());

// Type-safe arithmetic: .div() produces Velocity type
const speed = marathon.div(time);
console.log("Speed:", speed.toString());

// Force = mass × acceleration (F = ma)
const mass = kilograms(75);
const gravity = units`9.81 m/s^2`;
const weight = mass.mul(gravity);
console.log("\nWeight:", weight.toString());

// Unit-safe addition: can only add same dimensions
const leg1 = units`10000 meters`;
const leg2 = units`5000 meters`;
const total = leg1.add(leg2);
console.log("Total distance:", total.toString());

// Compile error if you try: meters(10).add(seconds(5))
// The type system prevents dimension mismatches at compile time

// Try: change "meters" to "km" and watch the macro output change

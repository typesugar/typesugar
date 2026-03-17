//! comptime
//! Evaluate code at compile time

import { comptime } from "typesugar";

// comptime() evaluates its argument at BUILD TIME
// The result is inlined into the output as a literal

// Compile-time math - result is inlined
const factorial5 = comptime(() => {
  let result = 1;
  for (let i = 2; i <= 5; i++) result *= i;
  return result;
});

// Compile-time string building
const greeting = comptime(() => {
  const parts = ["Hello", "from", "compile", "time!"];
  return parts.join(" ");
});

// Compile-time date (frozen at build time)
const buildDate = comptime(() => new Date().toISOString().split("T")[0]);

// Check the JS Output - you'll see literal values, not function calls!
console.log("5! =", factorial5);        // Inlined as: 120
console.log("Greeting:", greeting);     // Inlined as: "Hello from compile time!"
console.log("Built on:", buildDate);    // Inlined as: "2024-XX-XX"

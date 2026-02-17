/**
 * Refinement Types Example
 *
 * Demonstrates type-safe validated values — numbers between 0-255,
 * non-empty strings, valid emails, etc. Predicates enforced at
 * compile time (for literals) and runtime (for dynamic values).
 */

import {
  refinement,
  Refined,
  // Built-in refinements
  Positive,
  NonNegative,
  Int,
  Byte,
  Port,
  NonEmpty,
  Email,
  Url,
} from "@ttfx/type-system";

// --- Using Built-in Refinements ---

console.log("=== Refinement Types Example ===\n");

// Validate a port number
const port = Port.refine(8080);
console.log("Valid port:", port);

// Validate a byte
const byte = Byte.refine(255);
console.log("Valid byte:", byte);

// Non-empty string
const name = NonEmpty.refine("Alice");
console.log("Valid name:", name);

// --- Creating Custom Refinements ---

// Define a custom refinement
type Percentage = Refined<number, "Percentage">;
const Percentage = refinement<number, "Percentage">(
  (n) => n >= 0 && n <= 100,
  "Percentage",
);

const discount = Percentage.refine(25);
console.log("Valid percentage:", discount);

// --- Safe Validation ---

// Using .from() returns undefined if invalid (no throw)
const maybePort = Port.from(-1);
console.log("\nPort.from(-1):", maybePort);

// Using .safe() returns a Result-like object
const result = Email.safe("not-an-email");
console.log("Email.safe('not-an-email'):", result);

const validEmail = Email.safe("user@example.com");
console.log("Email.safe('user@example.com'):", validEmail);

// --- Type Guards ---

const value = 42;
if (Positive.is(value)) {
  // value is now Positive in this branch
  console.log("\n42 is positive:", value);
}

// --- Runtime Validation ---

function listen(port: Port): void {
  console.log(`Listening on port ${port}`);
}

// Must validate before passing
const userPort = 3000;
listen(Port.refine(userPort));

// This would be a type error:
// listen(3000);  // Error: number is not Port

//! Error Accumulation
//! Collect ALL validation errors instead of failing on the first

import { Valid, Invalid, validNel, invalidNel, isValid, isInvalid } from "@typesugar/fp";

// Validated accumulates errors instead of short-circuiting
type VError = string;

function validateName(name: string) {
  return name.length >= 2
    ? validNel<VError, string>(name)
    : invalidNel<VError, string>("Name must be at least 2 characters");
}

function validateAge(age: number) {
  return age >= 0 && age <= 150
    ? validNel<VError, number>(age)
    : invalidNel<VError, number>(`Age ${age} is out of range (0-150)`);
}

function validateEmail(email: string) {
  return email.includes("@")
    ? validNel<VError, string>(email)
    : invalidNel<VError, string>("Email must contain @");
}

// Good data — all valid
const r1 = validateName("Alice");
const r2 = validateAge(30);
const r3 = validateEmail("alice@example.com");
console.log("Good data:");
console.log("  name:", isValid(r1) ? `✓ ${r1.value}` : `✗ ${r1.error}`);
console.log("  age:", isValid(r2) ? `✓ ${r2.value}` : `✗ ${r2.error}`);
console.log("  email:", isValid(r3) ? `✓ ${r3.value}` : `✗ ${r3.error}`);

// Bad data — ALL errors collected
const b1 = validateName("A");
const b2 = validateAge(200);
const b3 = validateEmail("not-an-email");
console.log("\nBad data (all errors at once):");
const errors = [b1, b2, b3]
  .filter(isInvalid)
  .flatMap(v => v.error);
console.log("  Errors:", errors);

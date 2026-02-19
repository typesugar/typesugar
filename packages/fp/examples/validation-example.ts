/**
 * Form Validation with Validated
 *
 * Demonstrates error accumulation using Validated — collecting ALL errors
 * rather than stopping at the first one (which is what Either/Result does).
 */

import {
  Validated,
  valid,
  invalid,
  validNel,
  invalidNel,
  NonEmptyList,
} from "@ttfx/fp";

// --- Types ---

interface ValidationError {
  field: string;
  message: string;
}

interface UserInput {
  username: string;
  email: string;
  password: string;
  age: string;
}

interface ValidUser {
  username: string;
  email: string;
  password: string;
  age: number;
}

// --- Validators ---

function validateUsername(
  input: string,
): Validated<NonEmptyList<ValidationError>, string> {
  if (input.length < 3) {
    return invalidNel({
      field: "username",
      message: "Must be at least 3 chars",
    });
  }
  if (!/^[a-zA-Z0-9_]+$/.test(input)) {
    return invalidNel({ field: "username", message: "Must be alphanumeric" });
  }
  return validNel(input);
}

function validateEmail(
  input: string,
): Validated<NonEmptyList<ValidationError>, string> {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input)) {
    return invalidNel({ field: "email", message: "Invalid email format" });
  }
  return validNel(input);
}

function validatePassword(
  input: string,
): Validated<NonEmptyList<ValidationError>, string> {
  const errors: ValidationError[] = [];

  if (input.length < 8) {
    errors.push({ field: "password", message: "Must be at least 8 chars" });
  }
  if (!/[A-Z]/.test(input)) {
    errors.push({ field: "password", message: "Must have uppercase letter" });
  }
  if (!/[0-9]/.test(input)) {
    errors.push({ field: "password", message: "Must have a number" });
  }

  return errors.length === 0
    ? validNel(input)
    : Validated.invalidNel(NonEmptyList.of(...errors));
}

function validateAge(
  input: string,
): Validated<NonEmptyList<ValidationError>, number> {
  const age = parseInt(input, 10);
  if (isNaN(age)) {
    return invalidNel({ field: "age", message: "Must be a number" });
  }
  if (age < 18) {
    return invalidNel({ field: "age", message: "Must be at least 18" });
  }
  return validNel(age);
}

// --- Combined Validation ---

function validateUser(
  input: UserInput,
): Validated<NonEmptyList<ValidationError>, ValidUser> {
  return Validated.map4(
    validateUsername(input.username),
    validateEmail(input.email),
    validatePassword(input.password),
    validateAge(input.age),
    (username, email, password, age): ValidUser => ({
      username,
      email,
      password,
      age,
    }),
  );
}

// --- Demo ---

console.log("=== Validation Example ===\n");

// Valid input
const validInput: UserInput = {
  username: "john_doe",
  email: "john@example.com",
  password: "SecurePass123",
  age: "25",
};

const validResult = validateUser(validInput);
console.log(
  "Valid input:",
  validResult._tag === "Valid" ? validResult.value : "ERROR",
);

// Invalid input — accumulates ALL errors
const invalidInput: UserInput = {
  username: "jo", // too short
  email: "not-an-email", // invalid format
  password: "weak", // too weak (multiple errors)
  age: "sixteen", // not a number
};

const invalidResult = validateUser(invalidInput);
if (invalidResult._tag === "Invalid") {
  console.log("\nInvalid input errors:");
  NonEmptyList.toArray(invalidResult.error).forEach((e) => {
    console.log(`  ${e.field}: ${e.message}`);
  });
}

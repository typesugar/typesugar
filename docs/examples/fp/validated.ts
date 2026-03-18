//! Error Accumulation
//! Validated.mapN collects ALL errors instead of short-circuiting

import { Validated, validNel, invalidNel } from "@typesugar/fp";
import type { ValidatedNel } from "@typesugar/fp";
import { match } from "@typesugar/std";

// Each validator returns ValidatedNel — errors wrap in NonEmptyList
function validateName(name: string): ValidatedNel<string, string> {
  return name.length >= 2
    ? validNel(name)
    : invalidNel("Name too short (min 2 chars)");
}

function validateAge(age: number): ValidatedNel<string, number> {
  return age >= 0 && age <= 150
    ? validNel(age)
    : invalidNel(`Age ${age} out of range`);
}

function validateEmail(email: string): ValidatedNel<string, string> {
  return email.includes("@")
    ? validNel(email)
    : invalidNel("Email must contain @");
}

interface User { name: string; age: number; email: string }

// mapN combines via applicative — ALL branches run, ALL errors accumulate
const result = Validated.mapN(
  validateName("A"),
  validateAge(200),
  validateEmail("nope"),
  (name, age, email): User => ({ name, age, email })
);

// 👀 Check JS Output — match() compiles to structural checks
const message = match(result)
  .case({ value: v }).then(`Welcome, ${v.name}!`)
  .case({ error: e }).then(`Errors: ${e.head}`)
  .else("unknown");
console.log(message);
// → "Errors: Name too short (min 2 chars)"

// Success case — all validators pass
const good = Validated.mapN(
  validateName("Alice"),
  validateAge(30),
  validateEmail("alice@example.com"),
  (name, age, email): User => ({ name, age, email })
);

const welcome = match(good)
  .case({ value: v }).then(`Welcome, ${v.name} (${v.age})!`)
  .case({ error: e }).then(`Failed: ${e.head}`)
  .else("unknown");
console.log(welcome);
// → "Welcome, Alice (30)!"

// Try: make only one field invalid — the others still validate

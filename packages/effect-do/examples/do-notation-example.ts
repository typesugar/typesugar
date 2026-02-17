/**
 * Do-Notation Example
 *
 * Demonstrates Scala-style for-comprehension syntax for monadic types.
 * Generator syntax transforms into flatMap chains at compile time.
 */

import {
  Do,
  asyncDo,
  For,
  Option,
  Either,
  IO,
  some,
  none,
  right,
  left,
  io,
} from "@ttfx/effect-do";

console.log("=== Do-Notation Example ===\n");

// --- Do() with Option ---

console.log("--- Option Comprehension ---");

function safeDivide(a: number, b: number): Option<number> {
  return b === 0 ? none() : some(a / b);
}

function safeSqrt(n: number): Option<number> {
  return n < 0 ? none() : some(Math.sqrt(n));
}

// Using Do() for Option comprehensions
const calculation = Do(function* () {
  const x = yield* safeDivide(100, 4);
  const y = yield* safeDivide(x, 2);
  const z = yield* safeSqrt(y);
  return z;
});

console.log("100 / 4 / 2 then sqrt:", calculation);

// Fails gracefully
const failed = Do(function* () {
  const x = yield* safeDivide(100, 0); // Division by zero
  const y = yield* safeSqrt(x);
  return y;
});

console.log("100 / 0 then sqrt:", failed);

// --- Do() with Either ---

console.log("\n--- Either Comprehension ---");

function parseNumber(s: string): Either<string, number> {
  const n = parseFloat(s);
  return isNaN(n) ? left(`Invalid number: ${s}`) : right(n);
}

function validatePositive(n: number): Either<string, number> {
  return n > 0 ? right(n) : left(`Must be positive: ${n}`);
}

const parsed = Do(function* () {
  const a = yield* parseNumber("42");
  const b = yield* parseNumber("8");
  const c = yield* validatePositive(a - b);
  return c;
});

console.log("Parse '42', '8', validate positive:", parsed);

const parseFailed = Do(function* () {
  const a = yield* parseNumber("not a number");
  const b = yield* parseNumber("8");
  return a + b;
});

console.log("Parse 'not a number', '8':", parseFailed);

// --- For Comprehension Builder ---

console.log("\n--- For Builder ---");

const forResult = For.from({ x: some(10) })
  .bind("y", ({ x }) => some(x * 2))
  .bind("z", ({ x, y }) => some(x + y))
  .yield(({ x, y, z }) => `x=${x}, y=${y}, z=${z}, sum=${x + y + z}`);

console.log("For comprehension result:", forResult);

// --- asyncDo() with Promises ---

console.log("\n--- Async Comprehension ---");

async function fetchUser(id: number): Promise<{ id: number; name: string }> {
  return { id, name: `User${id}` };
}

async function fetchPosts(userId: number): Promise<string[]> {
  return [`Post1 by ${userId}`, `Post2 by ${userId}`];
}

const asyncProgram = asyncDo(function* () {
  const user = yield* fetchUser(1);
  const posts = yield* fetchPosts(user.id);
  return { user, posts };
});

asyncProgram.then((result) => {
  console.log("Async result:", result);
});

// --- IO Comprehension ---

console.log("\n--- IO Comprehension ---");

const ioProgram = Do(function* () {
  const time = yield* io(() => new Date().toISOString());
  yield* io(() => console.log(`  Started at: ${time}`));
  const result = yield* IO.of(42);
  yield* io(() => console.log(`  Answer: ${result}`));
  return result;
});

console.log("Running IO program:");
ioProgram.run();

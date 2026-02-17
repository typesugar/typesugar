/**
 * IO Monad Example
 *
 * Demonstrates pure effect composition with IO — describe effects as values,
 * then interpret them later. Enables referential transparency for side effects.
 */

import { IO, runIO, runIOSync, pipe } from "@ttfx/cats";

// --- Basic IO Operations ---

// Create IO from side effects
const getTime = IO.delay(() => new Date().toISOString());
const log = (msg: string) => IO.delay(() => console.log(msg));

// Pure value wrapped in IO
const answer = IO.pure(42);

// --- Composing Effects ---

const program = IO.flatMap(getTime, (time) =>
  IO.flatMap(log(`Started at: ${time}`), () =>
    IO.flatMap(answer, (n) =>
      IO.flatMap(log(`The answer is: ${n}`), () =>
        IO.map(getTime, (endTime) => `Finished at: ${endTime}`),
      ),
    ),
  ),
);

// --- Using pipe for cleaner composition ---

const programWithPipe = pipe(
  getTime,
  IO.flatMap((time) => log(`Starting computation at ${time}`)),
  IO.flatMap(() => IO.pure(21 * 2)),
  IO.map((result) => `Result: ${result}`),
);

// --- Demo ---

console.log("=== IO Monad Example ===\n");
console.log("Programs are just descriptions until run:\n");

// Run the first program
console.log("Running program 1:");
runIOSync(program);

console.log("\nRunning program 2:");
const result = runIOSync(programWithPipe);
console.log("Final value:", result);

//! Option & Either
//! Null-safe and error-safe types with zero runtime overhead

import { Some, None, isSome, isNone, Left, Right, isLeft, isRight, pipe } from "@typesugar/fp";

// Option<A> is just A | null — zero-cost at runtime
const found = Some(42);
const missing = None;

console.log("Some(42):", found);
console.log("None:", missing);
console.log("isSome(found):", isSome(found));
console.log("isNone(missing):", isNone(missing));

// Pattern match on Option
function describe(opt: ReturnType<typeof Some> | null) {
  if (isSome(opt)) {
    console.log(`Got value: ${opt}`);
  } else {
    console.log("Nothing here");
  }
}
describe(found);
describe(missing);

// Either<E, A> — typed error handling
function safeDivide(a: number, b: number) {
  return b === 0 ? Left("Division by zero") : Right(a / b);
}

const ok = safeDivide(10, 3);
const err = safeDivide(10, 0);

console.log("\nsafeDivide(10, 3):", isRight(ok) ? `Right(${ok.right})` : `Left(${ok.left})`);
console.log("safeDivide(10, 0):", isLeft(err) ? `Left(${err.left})` : `Right(${err.right})`);

// Compose with pipe
const result = pipe(
  safeDivide(100, 4),
  (e: any) => isRight(e) ? Right(e.right * 2) : e,
  (e: any) => isRight(e) ? `Result: ${e.right}` : `Error: ${e.left}`
);
console.log("\npipe(safeDivide(100, 4), double, format):", result);

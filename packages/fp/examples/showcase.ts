/**
 * @typesugar/fp Showcase
 *
 * Demonstrates functional programming data types with dot-syntax extension methods.
 *
 * With @opaque type macros (PEP-012), importing constructors is sufficient —
 * the type rewrite registry resolves methods automatically:
 *   Some(5).map(n => n * 2) → map(Some(5), n => n * 2)
 *
 * No namespace imports (import * as O) needed.
 *
 * Type assertions used:
 *   typeAssert<Equal<A, B>>()        - A and B are the same type
 *   typeAssert<Extends<A, B>>()      - A is assignable to B
 *   typeAssert<Not<Equal<A, B>>>()   - A and B are DIFFERENT
 *   typeAssert<Not<Extends<A, B>>>() - A is NOT assignable to B
 *
 * Run:   typesugar run examples/showcase.ts
 * Build: npx tspc && node dist/examples/showcase.js
 */

import { assert, typeAssert, type Equal, type Not } from "@typesugar/testing";

import {
  // Constructors & type guards
  Some, None, isSome, isNone,
  Left, Right, isLeft, isRight,
  Cons, Nil, isCons,
  Valid, Invalid, validNel, invalidNel, isValid,

  // Monad transformers (class-based)
  State, Reader, Writer, LogWriterMonoid,

  // IO
  IO, runIOSync,

  // Syntax utilities
  pipe, flow, identity, constant,
  curry, uncurry, flip,
  tuple, fst, snd, swap,
  memoize, memoize1,

  // HKT
  type Option, type Either, type List, type NonEmptyList, type Validated,
} from "../src/index.js";

// Standalone functions — still available for pipe-style and direct calls
import { fromNullable, tryCatch as optionTryCatch, traverse, sequence, Do, bind } from "../src/data/option.js";
import { tryCatch as eitherTryCatch, toOption } from "../src/data/either.js";
import * as L from "../src/data/list.js";
import * as NEL from "../src/data/nonempty-list.js";
import * as V from "../src/data/validated.js";

// Typeclass instances (for Eq/Ord sections)
import { getEq as getOptionEq, getOrd as getOptionOrd } from "../src/data/option.js";
import { getEq as getEitherEq, getOrd as getEitherOrd } from "../src/data/either.js";

// ============================================================================
// 1. OPTION — Zero-Cost Optional Values (Dot Syntax)
// ============================================================================

// Option<A> is @opaque over A | null. Some(x) returns x, None is null.
// Methods resolve via the type rewrite registry — no namespace import needed.
const x: Option<number> = Some(42);
const y: Option<number> = None;

typeAssert<Equal<typeof x, Option<number>>>();
typeAssert<Not<Equal<Option<number>, number | null>>>();

assert(x === 42, "Some(42) is just 42 at runtime");
assert(y === null, "None is just null at runtime");
assert(isSome(x), "isSome detects non-null");
assert(isNone(y), "isNone detects null");

// Dot syntax: Some(5).map(f) → map(Some(5), f) via type rewrite registry
const doubled = Some(5).map(n => n * 2);
assert(doubled === 10, ".map applies function to value");
assert(None.map((n: number) => n * 2) === null, ".map on None returns None");

const chained = Some(3).flatMap(n => n > 0 ? Some(n * 10) : None);
assert(chained === 30, ".flatMap chains computations");

const greeting = Some("world").fold(
  () => "nobody",
  name => `Hello, ${name}!`
);
assert(greeting === "Hello, world!", ".fold handles both cases");

// getOrElse, filter, contains — all with dot syntax
assert((None as Option<number>).getOrElse(() => 99) === 99);
assert(Some(10).filter(n => n > 5) === 10, ".filter keeps matching values");
assert(Some(3).filter(n => n > 5) === null, ".filter removes non-matching");
assert(Some(42).contains(42), ".contains checks equality");

// Standalone functions still work for utility operations
assert(fromNullable(undefined) === null, "fromNullable converts undefined to None");
assert(fromNullable("hi") === "hi", "fromNullable keeps non-null values");
assert(optionTryCatch(() => JSON.parse("bad")) === null, "tryCatch returns None on error");
assert(optionTryCatch(() => JSON.parse('"ok"')) === "ok", "tryCatch returns Some on success");

// Chained dot-syntax operations
const result1 = Some(5)
  .map(n => n * 2)
  .filter(n => n > 5)
  .getOrElse(() => 0);
assert(result1 === 10, "Chained Option operations with dot syntax");

// ============================================================================
// 2. EITHER — Typed Error Handling (Dot Syntax)
// ============================================================================

const success: Either<string, number> = Right(42);
const failure: Either<string, number> = Left("not found");

typeAssert<Equal<typeof success, Either<string, number>>>();
assert(isRight(success) && success.right === 42);
assert(isLeft(failure) && failure.left === "not found");

// Dot syntax on Either
const mapped = success.map(n => n * 2);
assert(isRight(mapped) && mapped.right === 84);

const mappedFail = failure.map(n => n * 2);
assert(isLeft(mappedFail), ".map on Left is a no-op");

// flatMap for sequential validation
const parseAge = (s: string): Either<string, number> => {
  const n = parseInt(s, 10);
  return isNaN(n) ? Left("not a number") : Right(n);
};

const checkAge = (n: number): Either<string, number> =>
  n >= 0 && n <= 150 ? Right(n) : Left("age out of range");

const validAge = parseAge("25").flatMap(checkAge);
assert(isRight(validAge) && validAge.right === 25);

const invalidAge = parseAge("abc").flatMap(checkAge);
assert(isLeft(invalidAge) && invalidAge.left === "not a number");

// tryCatch for exception-safe code
const parsed = eitherTryCatch(
  () => JSON.parse('{"a":1}'),
  (e) => `Parse error: ${e}`
);
assert(isRight(parsed));

// fold / match with dot syntax
const msg = failure.fold(
  err => `Error: ${err}`,
  val => `Value: ${val}`
);
assert(msg === "Error: not found");

// Either to Option conversion
const optFromSuccess = toOption(success);
const optFromFailure = toOption(failure);
assert(optFromSuccess === 42, "toOption extracts Right value");
assert(optFromFailure === null, "toOption converts Left to None");

// Chained Either operations with dot syntax
const result2 = Right<string, number>(10)
  .map(n => n * 2)
  .flatMap(n => n > 10 ? Right(n) : Left("too small"))
  .getOrElse(() => -1);
assert(result2 === 20, "Chained Either operations with dot syntax");

// ============================================================================
// 3. LIST — Persistent Linked List
// ============================================================================

const nums = L.of(1, 2, 3, 4, 5);
typeAssert<Equal<typeof nums, List<number>>>();

assert(L.head(nums) === 1, "head returns first element");
assert(L.length(nums) === 5, "length counts elements");

// map, filter, foldLeft
const squares = L.map(nums, n => n * n);
assert(L.toArray(squares).join(",") === "1,4,9,16,25");

const evens = L.filter(nums, n => n % 2 === 0);
assert(L.toArray(evens).join(",") === "2,4");

const sum = L.foldLeft(nums, 0, (acc, n) => acc + n);
assert(sum === 15, "foldLeft accumulates values");

// Cons / Nil constructors
const manual: List<string> = Cons("a", Cons("b", Nil));
assert(L.length(manual) === 2);
assert(L.head(manual) === "a");

// reverse, append
const reversed = L.reverse(nums);
assert(L.toArray(reversed).join(",") === "5,4,3,2,1");

const combined = L.append(L.of(1, 2), L.of(3, 4));
assert(L.toArray(combined).join(",") === "1,2,3,4");

// flatMap
const expanded = L.flatMap(L.of(1, 2, 3), n => L.of(n, n * 10));
assert(L.toArray(expanded).join(",") === "1,10,2,20,3,30");

// ============================================================================
// 4. NON-EMPTY LIST — At Least One Element
// ============================================================================

const nel = NEL.of(1, 2, 3);
assert(NEL.head(nel) === 1, "NEL always has a head");
assert(NEL.length(nel) === 3);

const nelMapped = NEL.map(nel, n => n * 2);
assert(NEL.toArray(nelMapped).join(",") === "2,4,6");

// fromArray returns Option<NonEmptyList>
const maybeNel = NEL.fromArray([1, 2, 3]);
assert(maybeNel !== null && NEL.head(maybeNel) === 1);
assert(NEL.fromArray([]) === null, "Empty array gives None");

// ============================================================================
// 5. VALIDATED — Accumulating Errors
// ============================================================================

const v1 = validNel(10);
const v2 = invalidNel("too short");
const v3 = invalidNel("missing @");

assert(v1._tag === "Valid" && v1.value === 10);
assert(v2._tag === "Invalid");

// map2Nel combines two ValidatedNel values, accumulating errors
const combined2 = V.map2Nel(
  validNel(1),
  validNel(2),
  (a, b) => a + b
);
assert(combined2._tag === "Valid" && combined2.value === 3);

// When both fail, errors accumulate
const bothFail = V.map2Nel(
  invalidNel("error 1"),
  invalidNel("error 2"),
  (a: number, b: number) => a + b
);
assert(bothFail._tag === "Invalid");
if (bothFail._tag === "Invalid") {
  const errors = NEL.toArray(bothFail.error);
  assert(errors.length === 2, "Both errors accumulated");
  assert(errors[0] === "error 1" && errors[1] === "error 2");
}

// Real-world: form validation that shows ALL errors at once
interface FormData { name: string; email: string }
const validateName = (s: string) =>
  s.length >= 2 ? validNel(s) : invalidNel("Name too short");
const validateEmail = (s: string) =>
  s.includes("@") ? validNel(s) : invalidNel("Invalid email");

const formResult = V.map2Nel(
  validateName("A"),
  validateEmail("bad"),
  (name, email): FormData => ({ name, email })
);
assert(formResult._tag === "Invalid", "Both validations fail");

// ============================================================================
// 6. IO — Pure Effect Composition
// ============================================================================

const pureIO = IO.pure(42);
const delayedIO = IO.delay(() => Date.now());
const mappedIO = IO.map(pureIO, n => n * 2);

const program = IO.flatMap(pureIO, n =>
  IO.map(IO.pure(n + 8), result => `Answer: ${result}`)
);

const ioResult = runIOSync(program);
assert(ioResult === "Answer: 50", "IO composes and runs correctly");

// Error handling with IO
const safeDiv = (a: number, b: number) =>
  b === 0
    ? IO.raiseError<number>(new Error("division by zero"))
    : IO.pure(a / b);

const recovered = IO.handleError(
  safeDiv(10, 0),
  () => IO.pure(-1)
);
assert(runIOSync(recovered) === -1, "IO handles errors gracefully");

// ============================================================================
// 7. MONAD TRANSFORMERS — State, Reader, Writer
// ============================================================================

const counter = State.flatMap(
  State.get<number>(),
  count => State.flatMap(
    State.set(count + 1),
    () => State.pure<number, string>(`count was ${count}`)
  )
);
const [stateResult, finalState] = State.run(counter, 0);
assert(stateResult === "count was 0");
assert(finalState === 1);

const getConfig = Reader.ask<{ port: number }>();
const serverInfo = Reader.map(getConfig, cfg => `Server on port ${cfg.port}`);
const info = Reader.run(serverInfo, { port: 8080 });
assert(info === "Server on port 8080");

const logged = Writer.flatMap(
  Writer.tell(["step 1"]),
  () => Writer.flatMap(
    Writer.tell(["step 2"]),
    () => Writer.writer(42, ["step 3"]),
    LogWriterMonoid
  ),
  LogWriterMonoid
);
const [writerResult, writerLog] = Writer.run(logged);
assert(writerResult === 42);
assert(writerLog.length >= 1, "Writer accumulates log entries");

// ============================================================================
// 8. PIPE & FLOW — Left-to-Right Composition
// ============================================================================

const piped = pipe(
  10,
  x => x * 2,
  x => x + 5,
  x => `Result: ${x}`
);
assert(piped === "Result: 25");

const transform = flow(
  (x: number) => x * 3,
  x => x - 1,
  x => x.toString()
);
assert(transform(5) === "14");
assert(transform(10) === "29");

assert(identity(42) === 42, "identity returns its argument");
assert(constant("hi")(999) === "hi", "constant ignores its second argument");

// ============================================================================
// 9. FUNCTION UTILITIES — Curry, Flip, Tuple
// ============================================================================

const add = (a: number, b: number) => a + b;
const curriedAdd = curry(add);
assert(curriedAdd(3)(4) === 7, "curry converts binary to curried");
assert(uncurry(curriedAdd)(3, 4) === 7, "uncurry reverses curry");

const sub = (a: number, b: number) => a - b;
const flipped = flip(sub);
assert(flipped(3, 10) === 7, "flip swaps arguments: sub(10, 3) = 7");

const pair = tuple(1, "hello");
typeAssert<Equal<typeof pair, [number, string]>>();
assert(fst(pair) === 1, "fst extracts first element");
assert(snd(pair) === "hello", "snd extracts second element");

const swapped = swap(pair);
assert(fst(swapped) === "hello" && snd(swapped) === 1, "swap reverses tuple");

// ============================================================================
// 10. MEMOIZATION — Caching Function Results
// ============================================================================

let callCount = 0;
const expensive = memoize1((n: number) => {
  callCount++;
  return n * n;
});

assert(expensive(5) === 25, "First call computes");
assert(expensive(5) === 25, "Second call uses cache");
assert(callCount === 1, "Only computed once for same input");
assert(expensive(6) === 36, "Different input computes again");
assert(callCount === 2);

let multiCalls = 0;
const multiMemo = memoize((a: number, b: number) => {
  multiCalls++;
  return a + b;
});
assert(multiMemo(1, 2) === 3);
multiMemo(1, 2);
assert(multiCalls === 1, "Multi-arg memoize caches by all args");

// ============================================================================
// 11. HKT FOUNDATION — Higher-Kinded Type Encoding
// ============================================================================

const optVal: Option<number> = 42;
assert(optVal === 42, "HKT: Option<number> is just number at runtime");

const optNone: Option<number> = null;
assert(optNone === null, "HKT: None is just null at runtime");

type _CheckOptionIsUnion = Option<number> extends number | null ? true : false;
const _proof: _CheckOptionIsUnion = true;

// ============================================================================
// 12. TYPECLASS INSTANCES & OPERATORS
// ============================================================================

import {
  eqNumber, eqString, makeEq, makeOrd,
  ordNumber, ordString,
  type Eq, type Ord
} from "../src/typeclasses/eq.js";

const eqOptNum = getOptionEq(eqNumber);
assert(eqOptNum.eqv(Some(1), Some(1)) === true, "Eq.eqv for Option: equal values");
assert(eqOptNum.eqv(Some(1), Some(2)) === false, "Eq.eqv for Option: different values");
assert(eqOptNum.eqv(Some(1), None) === false, "Eq.eqv for Option: Some !== None");
assert(eqOptNum.eqv(None, None) === true, "Eq.eqv for Option: None === None");

const eqEitherStrNum = getEitherEq(eqString, eqNumber);
assert(eqEitherStrNum.eqv(Right(42), Right(42)) === true, "Either Eq: Right === Right");
assert(eqEitherStrNum.eqv(Left("err"), Left("err")) === true, "Either Eq: Left === Left");
assert(eqEitherStrNum.eqv(Right(42), Left("err")) === false, "Either Eq: Right !== Left");

interface Point { x: number; y: number }
const eqPoint: Eq<Point> = makeEq((a, b) => a.x === b.x && a.y === b.y);
assert(eqPoint.eqv({ x: 1, y: 2 }, { x: 1, y: 2 }) === true, "Custom Eq works");

const ordOptNum = getOptionOrd(ordNumber);
assert(ordOptNum.lessThan(Some(1), Some(2)) === true, "Ord.lessThan: 1 < 2");
assert(ordOptNum.lessThan(Some(2), Some(1)) === false, "Ord.lessThan: !(2 < 1)");
assert(ordOptNum.lessThan(None, Some(1)) === true, "Ord.lessThan: None < Some");
assert(ordOptNum.lessThanOrEqual(Some(1), Some(1)) === true, "Ord.lessThanOrEqual: 1 <= 1");
assert(ordOptNum.greaterThan(Some(2), Some(1)) === true, "Ord.greaterThan: 2 > 1");

const ordEitherStrNum = getEitherOrd(ordString, ordNumber);
assert(ordEitherStrNum.lessThan(Left("a"), Left("b")) === true, "Either Ord: Left(a) < Left(b)");
assert(ordEitherStrNum.lessThan(Left("z"), Right(1)) === true, "Either Ord: Left < Right");
assert(ordEitherStrNum.greaterThan(Right(2), Right(1)) === true, "Either Ord: Right(2) > Right(1)");

const ordPoint: Ord<Point> = makeOrd((a, b) => {
  if (a.x !== b.x) return a.x < b.x ? -1 : 1;
  return a.y < b.y ? -1 : a.y > b.y ? 1 : 0;
});
assert(ordPoint.lessThan({ x: 1, y: 2 }, { x: 2, y: 0 }) === true, "Custom Ord works");

// ============================================================================
// 13. TRAVERSE & SEQUENCE
// ============================================================================

const traverseResult = traverse([1, 2, 3], (n: number) => n > 0 ? Some(n * 2) : None);
assert(
  traverseResult !== null &&
  Array.isArray(traverseResult) &&
  traverseResult.join(",") === "2,4,6",
  "traverse with Option: all succeed → Some([...])"
);

const traverseFail = traverse([1, -1, 3], (n: number) => n > 0 ? Some(n * 2) : None);
assert(traverseFail === null, "traverse with Option: any fail → None");

const sequenceResult = sequence([Some(1), Some(2), Some(3)]);
assert(
  sequenceResult !== null &&
  Array.isArray(sequenceResult) &&
  sequenceResult.join(",") === "1,2,3",
  "sequenceArray: all Some → Some([...])"
);

const sequenceFail = sequence([Some(1), None, Some(3)]);
assert(sequenceFail === null, "sequenceArray: any None → None");

// Dot syntax for Option operations
const fmapResult = Some(5).map(n => n * 2);
assert(fmapResult === 10, ".map: Some(5) → 10");

const bindResult = Some(5).flatMap(n => n > 0 ? Some(n * 2) : None);
assert(bindResult === 10, ".flatMap: Some(5) → 10");

const foldResult = Some(5).fold(() => 0, n => n);
assert(foldResult === 5, ".fold: Some(5) → 5");

// ============================================================================
// 14. COMPLETE ZERO-COST FP PIPELINE (Dot Syntax)
// ============================================================================

type ValidationError = string;
type ValidationResult<A> = Either<ValidationError, A>;

function validatePositive(n: number): ValidationResult<number> {
  return n > 0 ? Right(n) : Left("must be positive");
}

function validateMax(max: number) {
  return (n: number): ValidationResult<number> =>
    n <= max ? Right(n) : Left(`must be at most ${max}`);
}

// Compose validations with dot syntax
const validateAge = (n: number): ValidationResult<number> =>
  validatePositive(n).flatMap(validateMax(150));

// Convert to Option when error details don't matter
const safeAge = (n: number): Option<number> =>
  toOption(validateAge(n));

assert(safeAge(25) === 25, "Valid age returns Some");
assert(safeAge(-5) === null, "Invalid age returns None");
assert(safeAge(200) === null, "Age over max returns None");

// ============================================================================
// 15. ADVANCED PATTERNS (Dot Syntax)
// ============================================================================

// Do-notation style with bind
const doStyleResult = pipe(
  Do,
  o => bind("x", () => Some(1))(o),
  o => bind("y", () => Some(2))(o),
  o => bind("z", ({ x, y }: { x: number; y: number }) => Some(x + y))(o),
  o => (o as any).map(({ z }: { z: number }) => z * 10)
);
assert(doStyleResult === 30, "Do-notation style works");

// Complex chained transformations with dot syntax
const complexPipeline = Some({ name: "Alice", score: 85 })
  .filter(p => p.score >= 60)
  .map(p => ({ ...p, grade: p.score >= 90 ? "A" : p.score >= 80 ? "B" : "C" }))
  .map(p => `${p.name}: ${p.grade}`)
  .getOrElse(() => "No result");
assert(complexPipeline === "Alice: B", "Complex pipeline with dot syntax");

// Either/Option interop with dot syntax
const eitherToOption = toOption(
  Right<string, number>(42).map(n => n * 2)
);
const eitherToOptionResult = eitherToOption !== null
  ? Some(eitherToOption).map(n => n + 1).getOrElse(() => 0)
  : 0;
assert(eitherToOptionResult === 85, "Either/Option interop");

// List transformations
const listPipeline = pipe(
  L.of(1, 2, 3, 4, 5),
  xs => L.map(xs, n => n * n),
  xs => L.filter(xs, n => n > 5),
  xs => L.foldLeft(xs, 0, (acc, n) => acc + n)
);
assert(listPipeline === 9 + 16 + 25, "List pipeline: squares > 5 summed");

console.log("✓ All @typesugar/fp showcase tests passed!");

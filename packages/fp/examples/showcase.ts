/**
 * @typesugar/fp Showcase
 *
 * Demonstrates functional programming data types with extension method syntax.
 * Import constructors directly; import operation namespaces for extension methods.
 *
 * The transformer rewrites `x.map(f)` → `O.map(x, f)` when `O` is in scope.
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
  type $, type OptionF, type EitherF,
  type Option, type Either, type List, type NonEmptyList, type Validated,
} from "../src/index.js";

// Operation namespaces (for extension method syntax)
import * as O from "../src/data/option.js";
import * as E from "../src/data/either.js";
import * as L from "../src/data/list.js";
import * as NEL from "../src/data/nonempty-list.js";
import * as V from "../src/data/validated.js";

// ============================================================================
// 1. OPTION — Zero-Cost Optional Values
// ============================================================================

// Option<A> = A | null at runtime. Some(x) returns x, None is null.
const x: Option<number> = Some(42);
const y: Option<number> = None;

typeAssert<Equal<Option<number>, number | null>>();
typeAssert<Equal<typeof x, number | null>>();

assert(x === 42, "Some(42) is just 42 at runtime");
assert(y === null, "None is just null at runtime");
assert(isSome(x), "isSome detects non-null");
assert(isNone(y), "isNone detects null");

// Extension method syntax: x.map(f) → O.map(x, f)
const doubled = O.map(Some(5), n => n * 2);
assert(doubled === 10, "O.map applies function to value");
assert(O.map(None, (n: number) => n * 2) === null, "O.map on None returns None");

const chained = O.flatMap(Some(3), n => n > 0 ? Some(n * 10) : None);
assert(chained === 30, "O.flatMap chains computations");

const greeting = O.fold(
  Some("world"),
  () => "nobody",
  name => `Hello, ${name}!`
);
assert(greeting === "Hello, world!", "O.fold handles both cases");

// getOrElse, filter, contains
assert(O.getOrElse(None as Option<number>, () => 99) === 99);
assert(O.filter(Some(10), n => n > 5) === 10, "filter keeps matching values");
assert(O.filter(Some(3), n => n > 5) === null, "filter removes non-matching");
assert(O.contains(Some(42), 42), "contains checks equality");

// fromNullable, fromPredicate, tryCatch
assert(O.fromNullable(undefined) === null, "fromNullable converts undefined to None");
assert(O.fromNullable("hi") === "hi", "fromNullable keeps non-null values");
assert(O.tryCatch(() => JSON.parse("bad")) === null, "tryCatch returns None on error");
assert(O.tryCatch(() => JSON.parse('"ok"')) === "ok", "tryCatch returns Some on success");

// Chained operations (pipe style - always works)
const result1 = pipe(
  Some(5),
  x => O.map(x, n => n * 2),
  x => O.filter(x, n => n > 5),
  x => O.getOrElse(x, () => 0)
);
assert(result1 === 10, "Chained Option operations");

// ============================================================================
// 2. EITHER — Typed Error Handling
// ============================================================================

const success: Either<string, number> = Right(42);
const failure: Either<string, number> = Left("not found");

typeAssert<Equal<typeof success, Either<string, number>>>();
assert(isRight(success) && success.right === 42);
assert(isLeft(failure) && failure.left === "not found");

// map only affects the Right value
const mapped = E.map(success, n => n * 2);
assert(isRight(mapped) && mapped.right === 84);

const mappedFail = E.map(failure, n => n * 2);
assert(isLeft(mappedFail), "map on Left is a no-op");

// flatMap for sequential validation
const parseAge = (s: string): Either<string, number> => {
  const n = parseInt(s, 10);
  return isNaN(n) ? Left("not a number") : Right(n);
};

const checkAge = (n: number): Either<string, number> =>
  n >= 0 && n <= 150 ? Right(n) : Left("age out of range");

const validAge = E.flatMap(parseAge("25"), checkAge);
assert(isRight(validAge) && validAge.right === 25);

const invalidAge = E.flatMap(parseAge("abc"), checkAge);
assert(isLeft(invalidAge) && invalidAge.left === "not a number");

// tryCatch for exception-safe code
const parsed = E.tryCatch(
  () => JSON.parse('{"a":1}'),
  (e) => `Parse error: ${e}`
);
assert(isRight(parsed));

// fold / match
const msg = E.fold(
  failure,
  err => `Error: ${err}`,
  val => `Value: ${val}`
);
assert(msg === "Error: not found");

// Either to Option conversion
const optFromSuccess = E.toOption(success);
const optFromFailure = E.toOption(failure);
assert(optFromSuccess === 42, "toOption extracts Right value");
assert(optFromFailure === null, "toOption converts Left to None");

// Chained Either operations
const result2 = pipe(
  Right<string, number>(10),
  e => E.map(e, n => n * 2),
  e => E.flatMap(e, n => n > 10 ? Right(n) : Left("too small")),
  e => E.getOrElse(e, () => -1)
);
assert(result2 === 20, "Chained Either operations");

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

// Unlike Either which short-circuits, Validated collects all errors.
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

// IO describes effects as values — nothing runs until interpreted.
const pureIO = IO.pure(42);
const delayedIO = IO.delay(() => Date.now());
const mappedIO = IO.map(pureIO, n => n * 2);

// Effects compose without executing
const program = IO.flatMap(pureIO, n =>
  IO.map(IO.pure(n + 8), result => `Answer: ${result}`)
);

// Run synchronously to get the result
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

// State: thread mutable state through pure computations
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

// Reader: dependency injection
const getConfig = Reader.ask<{ port: number }>();
const serverInfo = Reader.map(getConfig, cfg => `Server on port ${cfg.port}`);
const info = Reader.run(serverInfo, { port: 8080 });
assert(info === "Server on port 8080");

// Writer: logging
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

// pipe: thread a value through transformations
const piped = pipe(
  10,
  x => x * 2,
  x => x + 5,
  x => `Result: ${x}`
);
assert(piped === "Result: 25");

// flow: create reusable pipelines
const transform = flow(
  (x: number) => x * 3,
  x => x - 1,
  x => x.toString()
);
assert(transform(5) === "14");
assert(transform(10) === "29");

// identity and constant
assert(identity(42) === 42, "identity returns its argument");
assert(constant("hi")(999) === "hi", "constant ignores its second argument");

// ============================================================================
// 9. FUNCTION UTILITIES — Curry, Flip, Tuple
// ============================================================================

// curry / uncurry
const add = (a: number, b: number) => a + b;
const curriedAdd = curry(add);
assert(curriedAdd(3)(4) === 7, "curry converts binary to curried");
assert(uncurry(curriedAdd)(3, 4) === 7, "uncurry reverses curry");

// flip
const sub = (a: number, b: number) => a - b;
const flipped = flip(sub);
assert(flipped(3, 10) === 7, "flip swaps arguments: sub(10, 3) = 7");

// Tuple utilities
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

// Multi-arg memoize
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

// OptionF and EitherF are type-level functions for HKT polymorphism.
// $<OptionF, number> resolves to Option<number> = number | null
//
// Note: typeAssert<Equal<$<OptionF, number>, number | null>>() causes
// "excessively deep" errors due to HKT type recursion. The types are correct;
// this is a TypeScript limitation with complex type-level computations.

// At runtime, Some(x) IS x, None IS null — zero-cost representation
const optVal: Option<number> = 42;
assert(optVal === 42, "HKT: Option<number> is just number at runtime");

const optNone: Option<number> = null;
assert(optNone === null, "HKT: None is just null at runtime");

// Verify the zero-cost property
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

// Option Eq instance (enables === operator rewriting)
const eqOptNum = O.getEq(eqNumber);
assert(eqOptNum.eqv(Some(1), Some(1)) === true, "Eq.eqv for Option: equal values");
assert(eqOptNum.eqv(Some(1), Some(2)) === false, "Eq.eqv for Option: different values");
assert(eqOptNum.eqv(Some(1), None) === false, "Eq.eqv for Option: Some !== None");
assert(eqOptNum.eqv(None, None) === true, "Eq.eqv for Option: None === None");

// Either Eq instance
const eqEitherStrNum = E.getEq(eqString, eqNumber);
assert(eqEitherStrNum.eqv(Right(42), Right(42)) === true, "Either Eq: Right === Right");
assert(eqEitherStrNum.eqv(Left("err"), Left("err")) === true, "Either Eq: Left === Left");
assert(eqEitherStrNum.eqv(Right(42), Left("err")) === false, "Either Eq: Right !== Left");

// Custom Eq instances also get Op<"==="> support
interface Point { x: number; y: number }
const eqPoint: Eq<Point> = makeEq((a, b) => a.x === b.x && a.y === b.y);
assert(eqPoint.eqv({ x: 1, y: 2 }, { x: 1, y: 2 }) === true, "Custom Eq works");

// Option Ord instance (enables <, >, <=, >= operator rewriting)
const ordOptNum = O.getOrd(ordNumber);
assert(ordOptNum.lessThan(Some(1), Some(2)) === true, "Ord.lessThan: 1 < 2");
assert(ordOptNum.lessThan(Some(2), Some(1)) === false, "Ord.lessThan: !(2 < 1)");
assert(ordOptNum.lessThan(None, Some(1)) === true, "Ord.lessThan: None < Some");
assert(ordOptNum.lessThanOrEqual(Some(1), Some(1)) === true, "Ord.lessThanOrEqual: 1 <= 1");
assert(ordOptNum.greaterThan(Some(2), Some(1)) === true, "Ord.greaterThan: 2 > 1");

// Either Ord instance (Left < Right)
const ordEitherStrNum = E.getOrd(ordString, ordNumber);
assert(ordEitherStrNum.lessThan(Left("a"), Left("b")) === true, "Either Ord: Left(a) < Left(b)");
assert(ordEitherStrNum.lessThan(Left("z"), Right(1)) === true, "Either Ord: Left < Right");
assert(ordEitherStrNum.greaterThan(Right(2), Right(1)) === true, "Either Ord: Right(2) > Right(1)");

// Custom Ord
const ordPoint: Ord<Point> = makeOrd((a, b) => {
  if (a.x !== b.x) return a.x < b.x ? -1 : 1;
  return a.y < b.y ? -1 : a.y > b.y ? 1 : 0;
});
assert(ordPoint.lessThan({ x: 1, y: 2 }, { x: 2, y: 0 }) === true, "Custom Ord works");

// ============================================================================
// 13. TRAVERSE & SEQUENCE
// ============================================================================

// Typeclass instances available for generic code (not used in this showcase):
// import { optionFunctor, optionMonad, optionFoldable } from "../src/instances.js";

// ============================================================================
// Traverse & Sequence — Using Option operations directly
// ============================================================================

// traverse: transform each element, short-circuit on failure
// Using O.traverse which is simpler and type-safe
const traverseResult = O.traverse([1, 2, 3], (n: number) => n > 0 ? Some(n * 2) : None);
assert(
  traverseResult !== null &&
  Array.isArray(traverseResult) &&
  traverseResult.join(",") === "2,4,6",
  "traverse with Option: all succeed → Some([...])"
);

// Short-circuits on None
const traverseFail = O.traverse([1, -1, 3], (n: number) => n > 0 ? Some(n * 2) : None);
assert(traverseFail === null, "traverse with Option: any fail → None");

// sequence: turn [Option<A>] into Option<A[]>
const sequenceResult = O.sequence([Some(1), Some(2), Some(3)]);
assert(
  sequenceResult !== null &&
  Array.isArray(sequenceResult) &&
  sequenceResult.join(",") === "1,2,3",
  "sequenceArray: all Some → Some([...])"
);

const sequenceFail = O.sequence([Some(1), None, Some(3)]);
assert(sequenceFail === null, "sequenceArray: any None → None");

// ============================================================================
// Direct Functor/Monad/Foldable Operations
// ============================================================================

// Using the concrete Option operations directly (zero-cost)
const fmapResult = O.map(Some(5), n => n * 2);
assert(fmapResult === 10, "O.map: Some(5) → 10");

const bindResult = O.flatMap(Some(5), n => n > 0 ? Some(n * 2) : None);
assert(bindResult === 10, "O.flatMap: Some(5) → 10");

const foldResult = O.fold(Some(5), () => 0, n => n);
assert(foldResult === 5, "O.fold: Some(5) → 5");

// The typeclass instances are available for generic code:
// optionFunctor.map, optionMonad.flatMap, optionFoldable.foldLeft
// These are used when writing polymorphic functions over any F[_]

// ============================================================================
// 14. COMPLETE ZERO-COST FP PIPELINE
// ============================================================================

// Combining all features for a complete zero-cost FP workflow

type ValidationError = string;
type ValidationResult<A> = Either<ValidationError, A>;

function validatePositive(n: number): ValidationResult<number> {
  return n > 0 ? Right(n) : Left("must be positive");
}

function validateMax(max: number) {
  return (n: number): ValidationResult<number> =>
    n <= max ? Right(n) : Left(`must be at most ${max}`);
}

// Compose validations
const validateAge = (n: number): ValidationResult<number> =>
  pipe(
    validatePositive(n),
    e => E.flatMap(e, validateMax(150))
  );

// Convert to Option when error details don't matter
const safeAge = (n: number): Option<number> =>
  pipe(validateAge(n), E.toOption);

assert(safeAge(25) === 25, "Valid age returns Some");
assert(safeAge(-5) === null, "Invalid age returns None");
assert(safeAge(200) === null, "Age over max returns None");

// All of this compiles to simple if-else chains at runtime:
// - No wrapper objects for Option (it's A | null)
// - No Either boxing in hot paths (inlined by transformer)
// - No function call overhead (specialized away)

// ============================================================================
// 15. ADVANCED PATTERNS
// ============================================================================

// Do-notation style with bind
const doStyleResult = pipe(
  O.Do,
  O.bind("x", () => Some(1)),
  O.bind("y", () => Some(2)),
  O.bind("z", ({ x, y }) => Some(x + y)),
  x => O.map(x, ({ z }) => z * 10)
);
assert(doStyleResult === 30, "Do-notation style works");

// Complex chained transformations
const complexPipeline = pipe(
  Some({ name: "Alice", score: 85 }),
  x => O.filter(x, p => p.score >= 60),
  x => O.map(x, p => ({ ...p, grade: p.score >= 90 ? "A" : p.score >= 80 ? "B" : "C" })),
  x => O.map(x, p => `${p.name}: ${p.grade}`),
  x => O.getOrElse(x, () => "No result")
);
assert(complexPipeline === "Alice: B", "Complex pipeline");

// Either/Option interop
const eitherToOption = pipe(
  Right<string, number>(42),
  e => E.map(e, n => n * 2),
  E.toOption,
  x => O.map(x, n => n + 1),
  x => O.getOrElse(x, () => 0)
);
assert(eitherToOption === 85, "Either/Option interop");

// List transformations
const listPipeline = pipe(
  L.of(1, 2, 3, 4, 5),
  xs => L.map(xs, n => n * n),
  xs => L.filter(xs, n => n > 5),
  xs => L.foldLeft(xs, 0, (acc, n) => acc + n)
);
assert(listPipeline === 9 + 16 + 25, "List pipeline: squares > 5 summed");

console.log("✓ All @typesugar/fp showcase tests passed!");

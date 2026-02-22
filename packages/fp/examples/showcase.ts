/**
 * @typesugar/fp Showcase
 *
 * Self-documenting examples of functional programming data types and
 * composition utilities. Covers Option (zero-cost, null-based), Either,
 * List, Validated, IO, monad transformers, pipe/flow, and typeclass laws.
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

import { assert, typeAssert, type Equal, type Extends, type Not } from "@typesugar/testing";

import {
  // Option — zero-cost (null-based)
  Option, Some, None, isSome, isNone,
  type OptionType,

  // Either — tagged union for error handling
  Either, Left, Right, isLeft, isRight,
  type EitherType,

  // List — persistent linked list
  List, Cons, Nil,
  type ListType,

  // NonEmptyList
  NonEmptyList,
  type NonEmptyListType,

  // Validated — error accumulation
  Validated, Valid, Invalid, valid, invalid, validNel, invalidNel,
  type ValidatedType,

  // Monad transformers
  State, IndexedState,
  Reader, Kleisli,
  Writer, LogWriter, LogWriterMonoid,

  // IO — pure effect composition
  IO, runIOSync,

  // Syntax utilities
  pipe, flow, identity, constant,
  curry, uncurry, flip,
  tuple, fst, snd, swap,
  memoize, memoize1,

  // HKT
  type $, type OptionF, type EitherF,
} from "../src/index.js";

// ============================================================================
// 1. OPTION — Zero-Cost Optional Values
// ============================================================================

// Option<A> = A | null at runtime. Some(x) returns x, None is null.
const x: OptionType = Some(42);
const y: OptionType = None;

typeAssert<Equal<OptionType, number | null>>();
typeAssert<Equal<typeof x, number | null>>();

assert(x === 42, "Some(42) is just 42 at runtime");
assert(y === null, "None is just null at runtime");
assert(isSome(x), "isSome detects non-null");
assert(isNone(y), "isNone detects null");

// map, flatMap, fold — all work on A | null directly
const doubled = Option.map(Some(5), n => n * 2);
assert(doubled === 10, "Option.map applies function to value");
assert(Option.map(None, (n: number) => n * 2) === null, "Option.map on None returns None");

const chained = Option.flatMap(Some(3), n => n > 0 ? Some(n * 10) : None);
assert(chained === 30, "Option.flatMap chains computations");

const greeting = Option.fold(
  Some("world"),
  () => "nobody",
  name => `Hello, ${name}!`
);
assert(greeting === "Hello, world!", "Option.fold handles both cases");

// getOrElse, filter, contains
assert(Option.getOrElse(None as OptionType, () => 99) === 99);
assert(Option.filter(Some(10), n => n > 5) === 10, "filter keeps matching values");
assert(Option.filter(Some(3), n => n > 5) === null, "filter removes non-matching");
assert(Option.contains(Some(42), 42), "contains checks equality");

// fromNullable, fromPredicate, tryCatch
assert(Option.fromNullable(undefined) === null, "fromNullable converts undefined to None");
assert(Option.fromNullable("hi") === "hi", "fromNullable keeps non-null values");
assert(Option.tryCatch(() => JSON.parse("bad")) === null, "tryCatch returns None on error");
assert(Option.tryCatch(() => JSON.parse('"ok"')) === "ok", "tryCatch returns Some on success");

// ============================================================================
// 2. EITHER — Typed Error Handling
// ============================================================================

const success: EitherType<string, number> = Right(42);
const failure: EitherType<string, number> = Left("not found");

typeAssert<Equal<typeof success, EitherType<string, number>>>();
assert(isRight(success) && success.right === 42);
assert(isLeft(failure) && failure.left === "not found");

// map only affects the Right value
const mapped = Either.map(success, n => n * 2);
assert(isRight(mapped) && mapped.right === 84);

const mappedFail = Either.map(failure, n => n * 2);
assert(isLeft(mappedFail), "map on Left is a no-op");

// flatMap for sequential validation
const parseAge = (s: string): EitherType<string, number> => {
  const n = parseInt(s, 10);
  return isNaN(n) ? Left("not a number") : Right(n);
};

const validateAge = (n: number): EitherType<string, number> =>
  n >= 0 && n <= 150 ? Right(n) : Left("age out of range");

const validAge = Either.flatMap(parseAge("25"), validateAge);
assert(isRight(validAge) && validAge.right === 25);

const invalidAge = Either.flatMap(parseAge("abc"), validateAge);
assert(isLeft(invalidAge) && invalidAge.left === "not a number");

// tryCatch for exception-safe code
const parsed = Either.tryCatch(
  () => JSON.parse('{"a":1}'),
  (e) => `Parse error: ${e}`
);
assert(isRight(parsed));

// fold / match
const msg = Either.fold(
  failure,
  err => `Error: ${err}`,
  val => `Value: ${val}`
);
assert(msg === "Error: not found");

// ============================================================================
// 3. LIST — Persistent Linked List
// ============================================================================

const nums = List.of(1, 2, 3, 4, 5);
typeAssert<Equal<typeof nums, ListType<number>>>();

assert(List.head(nums) === 1, "head returns first element");
assert(List.length(nums) === 5, "length counts elements");

// map, filter, foldLeft
const squares = List.map(nums, n => n * n);
assert(List.toArray(squares).join(",") === "1,4,9,16,25");

const evens = List.filter(nums, n => n % 2 === 0);
assert(List.toArray(evens).join(",") === "2,4");

const sum = List.foldLeft(nums, 0, (acc, n) => acc + n);
assert(sum === 15, "foldLeft accumulates values");

// Cons / Nil constructors
const manual: ListType<string> = Cons("a", Cons("b", Nil()));
assert(List.length(manual) === 2);
assert(List.head(manual) === "a");

// reverse, concat
const reversed = List.reverse(nums);
assert(List.toArray(reversed).join(",") === "5,4,3,2,1");

const combined = List.concat(List.of(1, 2), List.of(3, 4));
assert(List.toArray(combined).join(",") === "1,2,3,4");

// ============================================================================
// 4. VALIDATED — Accumulating Errors
// ============================================================================

// Unlike Either which short-circuits on first error, Validated collects all errors.
const v1 = validNel(10);
const v2 = invalidNel("too short");
const v3 = invalidNel("missing @");

assert(v1._tag === "Valid" && v1.value === 10);
assert(v2._tag === "Invalid");

// map2 combines two validations, accumulating errors
const combined2 = Validated.map2(
  validNel(1),
  validNel(2),
  (a, b) => a + b
);
assert(combined2._tag === "Valid" && combined2.value === 3);

// When both fail, errors accumulate
const bothFail = Validated.map2(
  invalidNel("error 1"),
  invalidNel("error 2"),
  (a: number, b: number) => a + b
);
assert(bothFail._tag === "Invalid");
if (bothFail._tag === "Invalid") {
  const errors = NonEmptyList.toArray(bothFail.error);
  assert(errors.length === 2, "Both errors accumulated");
  assert(errors[0] === "error 1" && errors[1] === "error 2");
}

// Real-world: form validation that shows ALL errors at once
interface FormData { name: string; email: string }
const validateName = (s: string) =>
  s.length >= 2 ? validNel(s) : invalidNel("Name too short");
const validateEmail = (s: string) =>
  s.includes("@") ? validNel(s) : invalidNel("Invalid email");

const formResult = Validated.map2(
  validateName("A"),
  validateEmail("bad"),
  (name, email): FormData => ({ name, email })
);
assert(formResult._tag === "Invalid", "Both validations fail");

// ============================================================================
// 5. IO — Pure Effect Composition
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
const result = runIOSync(program);
assert(result === "Answer: 50", "IO composes and runs correctly");

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
// 6. MONAD TRANSFORMERS — State, Reader, Writer
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
    () => Writer.of<string[], number>(["step 3"], 42)
  )
);
const [writerResult, log] = Writer.run(logged);
assert(writerResult === 42);
assert(log.length >= 1, "Writer accumulates log entries");

// ============================================================================
// 7. PIPE & FLOW — Left-to-Right Composition
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
// 8. FUNCTION UTILITIES — Curry, Flip, Tuple
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
// 9. MEMOIZATION — Caching Function Results
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
// 10. HKT FOUNDATION — Higher-Kinded Type Encoding
// ============================================================================

// OptionF and EitherF are type-level functions for HKT polymorphism.
// $<OptionF, number> resolves to Option<number> = number | null
typeAssert<Equal<$<OptionF, number>, number | null>>();

// This enables writing generic code over any container:
// function map<F>(F: Functor<F>): <A, B>(fa: $<F, A>, f: (a: A) => B) => $<F, B>
// When F = OptionF, $<OptionF, A> = A | null (zero-cost!)
typeAssert<Equal<$<OptionF, string>, string | null>>();

// ============================================================================
// 11. TRANSFORMER FEATURES — Op<>, @implicits, Return-Type Specialization
// ============================================================================
// The following features require the typesugar transformer to be active.
// They demonstrate how @typesugar/fp integrates with transformer features.

// --- 11.1 Op<> Operator Rewriting ---
// The Eq typeclass methods are annotated with Op<"==="> enabling:
//   optA === optB → eqOption.eqv(optA, optB)
//
// This is a future feature — when transformer is active, you can write:
//   const eqOpt = Option.getEq(eqNumber);
//   @instance const optionEq: Eq<Option<number>> = eqOpt;
//   Some(1) === Some(1)  // transformed to: optionEq.eqv(Some(1), Some(1))
//
// For now, Eq instances work manually:
import { eqNumber } from "../src/typeclasses/eq.js";
const eqOptNum = Option.getEq(eqNumber);
assert(eqOptNum.eqv(Some(1), Some(1)) === true, "Eq.eqv for Option works");
assert(eqOptNum.eqv(Some(1), Some(2)) === false, "Different values are not equal");
assert(eqOptNum.eqv(Some(1), None) === false, "Some !== None");
assert(eqOptNum.eqv(None, None) === true, "None === None");

// Either Eq
import { eqString } from "../src/typeclasses/eq.js";
const eqEitherStrNum = Either.getEq(eqString, eqNumber);
assert(eqEitherStrNum.eqv(Right(42), Right(42)) === true);
assert(eqEitherStrNum.eqv(Left("err"), Left("err")) === true);
assert(eqEitherStrNum.eqv(Right(42), Left("err")) === false);

// --- 11.2 Return-Type Specialization: Either → Option ---
// The transformer can auto-convert Result/Either to Option when needed.
// This pattern is common: Either.toOption discards the error type.

const eitherSuccess = Right(42);
const eitherFailure = Left("error");

const optFromSuccess = Either.toOption(eitherSuccess);
const optFromFailure = Either.toOption(eitherFailure);

assert(optFromSuccess === 42, "toOption extracts Right value");
assert(optFromFailure === null, "toOption converts Left to None");

// Type-level: Either<E, A>.toOption() → Option<A>
typeAssert<Equal<typeof optFromSuccess, number | null>>();

// --- 11.3 Traverse with Applicative ---
// The traverse/sequence functions take an Applicative parameter.
// With @implicits, this could be filled automatically.

import { optionTraverse, optionMonad, arrayTraverse } from "../src/instances.js";
import type { Applicative } from "../src/typeclasses/applicative.js";

// Manual usage (without @implicits):
// traverse over an array, returning Option of array
const traverseResult = arrayTraverse.traverse(optionMonad as unknown as Applicative<OptionF>)(
  [1, 2, 3],
  (n: number) => n > 0 ? Some(n * 2) : None
);
// With all positives, we get Some([2, 4, 6])
assert(
  traverseResult !== null &&
  Array.isArray(traverseResult) &&
  traverseResult.join(",") === "2,4,6",
  "traverse with Option succeeds"
);

// With a None in the mix, the whole thing fails
const traverseFail = arrayTraverse.traverse(optionMonad as unknown as Applicative<OptionF>)(
  [1, -1, 3],
  (n: number) => n > 0 ? Some(n * 2) : None
);
assert(traverseFail === null, "traverse short-circuits on None");

// Future: with @implicits, you could write:
//   @implicits
//   function myTraverse<F, A, B>(F: Traverse<F>, G: Applicative<G>, fa: $<F, A>, f: (a: A) => $<G, B>): $<G, $<F, B>>
//   myTraverse(myList, myFunc)  // Applicative auto-resolved

console.log("✓ All @typesugar/fp showcase tests passed!");

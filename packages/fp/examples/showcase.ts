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
const manual: ListType<string> = Cons("a", Cons("b", Nil));
assert(List.length(manual) === 2);
assert(List.head(manual) === "a");

// reverse, append
const reversed = List.reverse(nums);
assert(List.toArray(reversed).join(",") === "5,4,3,2,1");

const combined = List.append(List.of(1, 2), List.of(3, 4));
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
// These features integrate with the typesugar transformer to provide
// zero-cost abstractions for functional programming.

// --- 11.1 Op<"==="> Operator Rewriting for Eq ---
// Eq typeclass methods are annotated with Op<"==="> enabling operator rewriting.
// When transformer is active: `optA === optB` → `eqOption.eqv(optA, optB)`

import {
  eqNumber, eqString, makeEq, makeOrd,
  ordNumber, ordString,
  type Eq, type Ord
} from "../src/typeclasses/eq.js";

// Option Eq instance (with Op<"==="> on the eqv method)
const eqOptNum = Option.getEq(eqNumber);
assert(eqOptNum.eqv(Some(1), Some(1)) === true, "Eq.eqv for Option: equal values");
assert(eqOptNum.eqv(Some(1), Some(2)) === false, "Eq.eqv for Option: different values");
assert(eqOptNum.eqv(Some(1), None) === false, "Eq.eqv for Option: Some !== None");
assert(eqOptNum.eqv(None, None) === true, "Eq.eqv for Option: None === None");

// Either Eq instance (with Op<"==="> on the eqv method)
const eqEitherStrNum = Either.getEq(eqString, eqNumber);
assert(eqEitherStrNum.eqv(Right(42), Right(42)) === true, "Either Eq: Right === Right");
assert(eqEitherStrNum.eqv(Left("err"), Left("err")) === true, "Either Eq: Left === Left");
assert(eqEitherStrNum.eqv(Right(42), Left("err")) === false, "Either Eq: Right !== Left");

// Custom Eq instances also get Op<"==="> support
interface Point { x: number; y: number }
const eqPoint: Eq<Point> = makeEq((a, b) => a.x === b.x && a.y === b.y);
assert(eqPoint.eqv({ x: 1, y: 2 }, { x: 1, y: 2 }) === true, "Custom Eq works");

// --- 11.1b Op<"<", "<=", ">", ">="> Operator Rewriting for Ord ---
// Ord typeclass now includes Op<>-annotated methods for comparison operators.
// When transformer is active: `optA < optB` → `ordOption.lessThan(optA, optB)`

// Option Ord instance (with Op<> on all comparison methods)
const ordOptNum = Option.getOrd(ordNumber);
assert(ordOptNum.lessThan(Some(1), Some(2)) === true, "Ord.lessThan: 1 < 2");
assert(ordOptNum.lessThan(Some(2), Some(1)) === false, "Ord.lessThan: !(2 < 1)");
assert(ordOptNum.lessThan(None, Some(1)) === true, "Ord.lessThan: None < Some");
assert(ordOptNum.lessThanOrEqual(Some(1), Some(1)) === true, "Ord.lessThanOrEqual: 1 <= 1");
assert(ordOptNum.greaterThan(Some(2), Some(1)) === true, "Ord.greaterThan: 2 > 1");
assert(ordOptNum.greaterThanOrEqual(None, None) === true, "Ord.greaterThanOrEqual: None >= None");

// Either Ord instance (Left < Right)
const ordEitherStrNum = Either.getOrd(ordString, ordNumber);
assert(ordEitherStrNum.lessThan(Left("a"), Left("b")) === true, "Either Ord: Left(a) < Left(b)");
assert(ordEitherStrNum.lessThan(Left("z"), Right(1)) === true, "Either Ord: Left < Right");
assert(ordEitherStrNum.greaterThan(Right(2), Right(1)) === true, "Either Ord: Right(2) > Right(1)");

// Custom Ord with all comparison methods via makeOrd
const ordPoint: Ord<Point> = makeOrd((a, b) => {
  if (a.x !== b.x) return a.x < b.x ? -1 : 1;
  return a.y < b.y ? -1 : a.y > b.y ? 1 : 0;
});
assert(ordPoint.lessThan({ x: 1, y: 2 }, { x: 2, y: 0 }) === true, "Custom Ord: (1,2) < (2,0)");
assert(ordPoint.greaterThanOrEqual({ x: 1, y: 2 }, { x: 1, y: 2 }) === true, "Custom Ord: (1,2) >= (1,2)");

// With transformer active, you can use operators directly:
// const p1: Point = { x: 1, y: 2 };
// const p2: Point = { x: 1, y: 2 };
// p1 === p2  // → transformed to: eqPoint.eqv(p1, p2) → true
// p1 < p2    // → transformed to: ordPoint.lessThan(p1, p2)

// --- 11.2 Return-Type Driven Specialization: Either → Option ---
// The transformer supports automatic type conversion patterns.
// Either.toOption is the canonical example: discards error, keeps success.

const eitherSuccess: Either.Either<string, number> = Right(42);
const eitherFailure: Either.Either<string, number> = Left("error");

// toOption: Either<E, A> → Option<A>
const optFromSuccess = Either.toOption(eitherSuccess);
const optFromFailure = Either.toOption(eitherFailure);

assert(optFromSuccess === 42, "toOption extracts Right value as Some");
assert(optFromFailure === null, "toOption converts Left to None");
typeAssert<Equal<typeof optFromSuccess, number | null>>();

// Chain Either operations with Option fallback
const maybeResult = pipe(
  Either.tryCatch(() => JSON.parse('{"value": 42}'), String),
  e => Either.map(e, (obj: { value: number }) => obj.value),
  Either.toOption
);
assert(maybeResult === 42, "Either→Option pipeline works");

// Invalid input converts to None
const maybeInvalid = pipe(
  Either.tryCatch(() => JSON.parse('invalid'), String),
  e => Either.map(e, (obj: { value: number }) => obj.value),
  Either.toOption
);
assert(maybeInvalid === null, "Either→Option: failure becomes None");

// --- 11.3 Traverse with Applicative (ready for @implicits) ---
// The traverse/sequence functions take an Applicative parameter.
// With @implicits decorator, this parameter would be auto-filled.

import {
  optionMonad, arrayTraverse,
  traverseArray, sequenceArray, fmap, bind, applyF, foldL
} from "../src/instances.js";
import type { Applicative } from "../src/typeclasses/applicative.js";

// Current usage: pass Applicative explicitly
const traverseResult = arrayTraverse.traverse(optionMonad as unknown as Applicative<OptionF>)(
  [1, 2, 3],
  (n: number) => n > 0 ? Some(n * 2) : None
);
assert(
  traverseResult !== null &&
  Array.isArray(traverseResult) &&
  traverseResult.join(",") === "2,4,6",
  "traverse with Option: all succeed → Some([...])"
);

// Short-circuiting on None
const traverseFail = arrayTraverse.traverse(optionMonad as unknown as Applicative<OptionF>)(
  [1, -1, 3],
  (n: number) => n > 0 ? Some(n * 2) : None
);
assert(traverseFail === null, "traverse with Option: any fail → None");

// --- 11.3b @implicits-Ready Helper Functions ---
// These functions are designed for use with the @implicits decorator.
// The Applicative/Functor/Monad parameter comes last for auto-filling.

// traverseArray: explicit Applicative parameter (first)
const traverseResult2 = traverseArray(optionMonad as unknown as Applicative<OptionF>)(
  [1, 2, 3],
  (n: number) => n > 0 ? Some(n * 2) : None
);
assert(
  traverseResult2 !== null && Array.isArray(traverseResult2),
  "traverseArray helper works"
);

// sequenceArray: turn [Option<A>] into Option<A[]>
const sequenceResult = sequenceArray(optionMonad as unknown as Applicative<OptionF>)(
  [Some(1), Some(2), Some(3)]
);
assert(
  sequenceResult !== null &&
  Array.isArray(sequenceResult) &&
  sequenceResult.join(",") === "1,2,3",
  "sequenceArray: all Some → Some([...])"
);

const sequenceFail = sequenceArray(optionMonad as unknown as Applicative<OptionF>)(
  [Some(1), None, Some(3)]
);
assert(sequenceFail === null, "sequenceArray: any None → None");

// fmap: Functor.map helper
import { optionFunctor } from "../src/instances.js";
const fmapResult = fmap(optionFunctor)(Some(5), n => n * 2);
assert(fmapResult === 10, "fmap: Some(5) → 10");
assert(fmap(optionFunctor)(None as number | null, n => n * 2) === null, "fmap: None → None");

// bind: Monad.flatMap helper
const bindResult = bind(optionMonad)(Some(5), n => n > 0 ? Some(n * 2) : None);
assert(bindResult === 10, "bind: Some(5) → 10");

// foldL: Foldable.foldLeft helper
import { optionFoldable } from "../src/instances.js";
const foldResult = foldL(optionFoldable)(Some(5), 0, (acc, n) => acc + n);
assert(foldResult === 5, "foldL: Some(5) → 5");
assert(foldL(optionFoldable)(None as number | null, 0, (acc, n) => acc + n) === 0, "foldL: None → 0");

// --- 11.4 Functor.specialize() Pattern ---
// Zero-cost specialization via fn.specialize(dict) extension.
// When transformer is active, the dictionary is inlined at compile time.

// Example: specialized map for Option
// const optMap = Functor.map.specialize(optionFunctor);
// optMap(Some(1), x => x * 2)  // Compiles to: Some(1) !== null ? (1) * 2 : null

// The optionFunctor instance is already zero-cost:
import { optionFunctor } from "../src/instances.js";
const mappedOpt = optionFunctor.map(Some(5), x => x * 2);
assert(mappedOpt === 10, "optionFunctor.map is zero-cost: returns 10, not Some(10)");
const mappedNone = optionFunctor.map(None as number | null, x => x * 2);
assert(mappedNone === null, "optionFunctor.map(None) returns null");

// --- 11.5 HKT Zero-Cost Verification ---
// Verify that HKT type-level functions resolve correctly at the type level
// while maintaining zero runtime overhead.

// OptionF resolves to the null-based representation
typeAssert<Equal<$<OptionF, number>, number | null>>();
typeAssert<Equal<$<OptionF, string>, string | null>>();

// At runtime, Some(x) IS x, None IS null
const optVal: $<OptionF, number> = 42;
assert(optVal === 42, "HKT: $<OptionF, number> is just number at runtime");

const optNone: $<OptionF, number> = null;
assert(optNone === null, "HKT: None is just null at runtime");

// ============================================================================
// 12. NUMERIC OPERATORS VIA @typesugar/std
// ============================================================================
// When used with @typesugar/std's Numeric typeclass, types like Rational,
// BigDecimal, and Interval support arithmetic operators via Op<> annotations.
//
// The pattern:
//   interface Numeric<A> {
//     add(a: A, b: A): A & Op<"+">;
//     mul(a: A, b: A): A & Op<"*">;
//     sub(a: A, b: A): A & Op<"-">;
//     ...
//   }
//
// Enables: rationalA + rationalB → numericRational.add(rationalA, rationalB)
//
// This is demonstrated in @typesugar/math's showcase with Rational, BigDecimal,
// Interval, and Complex types.

// Example pattern (conceptual — requires @typesugar/std import):
// import { Numeric, numericNumber } from "@typesugar/std";
//
// With the transformer, arithmetic on types with Numeric instances compiles to
// direct method calls. For example with Rational:
//
//   const a = rational(1, 2);
//   const b = rational(1, 3);
//   const c = a + b;
//   // Compiles to: numericRational.add(a, b)
//   // Which evaluates to: rational(5, 6)

// ============================================================================
// 13. @implicits PATTERN — Auto-Fill Typeclass Parameters
// ============================================================================
// The @implicits decorator marks functions as having implicit typeclass params.
// The transformer auto-fills these parameters at call sites.
//
// Pattern:
//   @implicits
//   function sorted<A>(xs: A[], O: Ord<A>): A[] {
//     return [...xs].sort((a, b) => O.compare(a, b));
//   }
//
//   // Call site (O is auto-filled):
//   const result = sorted([3, 1, 2]);
//   // Transforms to: sorted([3, 1, 2], ordNumber)
//
// With FP typeclasses:
//
//   @implicits
//   function traverseArray<G, A, B>(
//     xs: A[],
//     f: (a: A) => $<G, B>,
//     G: Applicative<G>
//   ): $<G, B[]> {
//     return arrayTraverse.traverse(G)(xs, f);
//   }
//
//   // Call site (G is inferred from f's return type):
//   const result = traverseArray([1, 2, 3], n => Some(n * 2));
//   // Transforms to: traverseArray([1, 2, 3], n => Some(n * 2), optionApplicative)
//
// Benefits:
// - Cleaner call sites (no explicit instance passing)
// - Instance resolution at compile time (zero runtime cost)
// - Propagation through nested @implicits calls

// ============================================================================
// 14. COMPLETE ZERO-COST FP PIPELINE
// ============================================================================
// Combining all features for a complete zero-cost FP workflow:

// 1. Define types with zero-cost representations (Option = A | null)
// 2. Typeclass instances with Op<> annotations enable operator syntax
// 3. @implicits auto-fills typeclass params at call sites
// 4. Auto-specialization inlines instance methods at compile time
// 5. Return-type specialization handles type conversions (Either → Option)

// Example: A validation pipeline that compiles to optimal code
type ValidationError = string;
type ValidationResult<A> = Either.Either<ValidationError, A>;

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
    e => Either.flatMap(e, validateMax(150))
  );

// Convert to Option when error details don't matter
const safeAge = (n: number): OptionType =>
  pipe(validateAge(n), Either.toOption);

assert(safeAge(25) === 25, "Valid age returns Some");
assert(safeAge(-5) === null, "Invalid age returns None");
assert(safeAge(200) === null, "Age over max returns None");

// All of this compiles to simple if-else chains at runtime:
// - No wrapper objects for Option
// - No Either boxing in hot paths (inlined by transformer)
// - No function call overhead (specialized away)

console.log("✓ All @typesugar/fp showcase tests passed!");

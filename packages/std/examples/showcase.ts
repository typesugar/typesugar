/**
 * @typesugar/std Showcase
 *
 * Self-documenting examples of the typesugar standard library: typeclasses,
 * extension methods, data types, pattern matching, and do-notation.
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
  // Typeclasses
  type Bounded,
  type Enum,
  type Numeric,
  type Integral,
  type Fractional,
  type Floating,
  type Parseable,
  type ParseResult,
  type Printable,
  type Coercible,
  type Defaultable,
  type Copyable,
  type Sized,
  type Group,
  type Eq,
  type Ord,
  type Ordering,
  type Semigroup,
  type Monoid,
  LT,
  EQ_ORD,
  GT,
  boundedNumber,
  enumNumber,
  numericNumber,
  integralNumber,
  fractionalNumber,
  floatingNumber,
  parseableNumber,
  parseableBoolean,
  printableNumber,
  printableString,
  numberToString,
  stringToNumber,
  defaultNumber,
  defaultString,
  defaultBoolean,
  copyableNumber,
  copyableDate,
  copyableArray,
  sizedString,
  sizedArray,
  groupNumber,
  eqNumber,
  eqString,
  eqBoolean,
  eqDate,
  eqArray,
  eqBy,
  makeEq,
  ordNumber,
  ordString,
  ordBoolean,
  ordDate,
  ordArray,
  ordBy,
  reverseOrd,
  makeOrd,
  semigroupString,
  semigroupNumber,
  semigroupArray,
  monoidString,
  monoidNumber,
  monoidArray,

  // Extension methods
  NumberExt,
  StringExt,
  ArrayExt,
  BooleanExt,
  DateExt,
  ObjectExt,

  // Standalone extension functions
  clamp,
  lerp,
  roundTo,
  isEven,
  isOdd,
  isPrime,
  gcd,
  lcm,
  capitalize,
  camelCase,
  snakeCase,
  kebabCase,
  truncate,
  words,
  isBlank,
  head,
  tail,
  last,
  chunk,
  unique,
  zip,
  partition,
  groupBy as arrayGroupBy,
  sortBy,
  intersperse,
  takeWhile,
  dropWhile,
  flatten,
  compact,
  pick,
  omit,
  deepMerge,

  // Data types
  pair,
  fst,
  snd,
  swap,
  bimap,
  triple,
  range,
  rangeInclusive,
  rangeToArray,
  rangeBy,
  rangeContains,
  rangeMap,
  // Data type typeclass instances
  eqPair,
  ordPair,
  eqTriple,
  ordTriple,
  eqRange,
  ordRange,

  // Macros
  match,
  when,
  otherwise,
  isType,
  P,

  // FlatMap & do-notation
  type FlatMap,
  registerFlatMap,
} from "@typesugar/std";

// ============================================================================
// 1. NUMERIC TYPECLASSES — Bounded, Enum, Numeric, Integral, Fractional
// ============================================================================

// Bounded: types with min/max values
assert(boundedNumber.minBound() === Number.MIN_SAFE_INTEGER);
assert(boundedNumber.maxBound() === Number.MAX_SAFE_INTEGER);

// Enum: successor, predecessor, ordinal conversion
assert(enumNumber.succ(5) === 6);
assert(enumNumber.pred(5) === 4);
assert(enumNumber.toEnum(65) === 65);

// Numeric: ring arithmetic (add, sub, mul) with identity elements
assert(numericNumber.add(3, 4) === 7);
assert(numericNumber.mul(3, 4) === 12);
assert(numericNumber.negate(5) === -5);
assert(numericNumber.abs(-42) === 42);
assert(numericNumber.zero() === 0);
assert(numericNumber.one() === 1);

// Integral: integer division and modulo
assert(integralNumber.div(7, 2) === 3);
assert(integralNumber.mod(7, 2) === 1);
const [quot, rem] = integralNumber.divMod(17, 5);
assert(quot === 3);
assert(rem === 2);

// Fractional: real division
assert(fractionalNumber.div(1, 3) === 1 / 3);
assert(fractionalNumber.recip(4) === 0.25);

// Floating: transcendental functions
assert(floatingNumber.pi() === Math.PI);
assert(floatingNumber.sqrt(16) === 4);
assert(Math.abs(floatingNumber.sin(Math.PI / 2) - 1) < 1e-10);

// ============================================================================
// 2. CONVERSION TYPECLASSES — Parseable, Printable, Coercible, Defaultable
// ============================================================================

// Parseable: safe string-to-value parsing
const parsed = parseableNumber.parse("42");
assert(parsed.ok === true);
if (parsed.ok) assert(parsed.value === 42);

const bad = parseableNumber.parse("not a number");
assert(bad.ok === false);

const boolParsed = parseableBoolean.parse("yes");
assert(boolParsed.ok === true);
if (boolParsed.ok) assert(boolParsed.value === true);

// Printable: human-readable display
assert(printableNumber.display(1234) === "1234");
assert(printableString.display("hello") === "hello");

// Coercible: safe type conversions (Rust From/Into)
assert(numberToString.coerce(42) === "42");
assert(stringToNumber.coerce("3.14") === 3.14);

// Defaultable: sensible default values (Rust Default)
assert(defaultNumber.defaultValue() === 0);
assert(defaultString.defaultValue() === "");
assert(defaultBoolean.defaultValue() === false);

// ============================================================================
// 3. STRUCTURAL TYPECLASSES — Copyable, Sized, Group
// ============================================================================

// Copyable: deep copying (primitives are trivially copied)
assert(copyableNumber.copy(42) === 42);

const now = new Date();
const copied = copyableDate.copy(now);
assert(copied.getTime() === now.getTime());
assert(copied !== now); // different object

const arrCopier = copyableArray(copyableNumber);
const original = [1, 2, 3];
const cloned = arrCopier.copy(original);
assert(cloned[0] === 1 && cloned[1] === 2 && cloned[2] === 3);
assert(cloned !== original);

// Sized: length/empty checks
assert(sizedString.size("hello") === 5);
assert(sizedString.isEmpty("") === true);
assert(sizedString.isEmpty("x") === false);

const numSized = sizedArray<number>();
assert(numSized.size([1, 2, 3]) === 3);
assert(numSized.isEmpty([]) === true);

// Group: monoid with inverse (Semigroup -> Monoid -> Group)
assert(groupNumber.empty() === 0);
assert(groupNumber.combine(3, 4) === 7);
assert(groupNumber.invert(5) === -5);
assert(groupNumber.combine(groupNumber.invert(5), 5) === groupNumber.empty());

// ============================================================================
// 4. EQUALITY & ORDERING — Eq, Ord with Op<> annotations for operator dispatch
// ============================================================================

// Eq: equality comparison (supports Op<"==="> and Op<"!==">)
// The transformer rewrites `a === b` to `eqType.equals(a, b)` for custom types
assert(eqNumber.equals(42, 42) === true);
assert(eqNumber.notEquals(1, 2) === true);
assert(eqString.equals("hello", "hello") === true);

// Eq combinators
const eqArrayNum = eqArray(eqNumber);
assert(eqArrayNum.equals([1, 2, 3], [1, 2, 3]) === true);
assert(eqArrayNum.equals([1, 2], [1, 2, 3]) === false);

// Eq by projection
interface Point { x: number; y: number }
const eqPointByX = eqBy((p: Point) => p.x, eqNumber);
assert(eqPointByX.equals({ x: 1, y: 2 }, { x: 1, y: 99 }) === true);

// Ord: total ordering (supports Op<"<">, Op<"<=">, Op<">">, Op<">=">)
// The transformer rewrites `a < b` to `ordType.lessThan(a, b)` for custom types
assert(ordNumber.compare(1, 2) === LT);
assert(ordNumber.compare(2, 2) === EQ_ORD);
assert(ordNumber.compare(3, 2) === GT);

assert(ordNumber.lessThan(1, 2) === true);
assert(ordNumber.lessThanOrEqual(2, 2) === true);
assert(ordNumber.greaterThan(3, 2) === true);
assert(ordNumber.greaterThanOrEqual(2, 2) === true);

// Ord for strings (lexicographic)
assert(ordString.lessThan("apple", "banana") === true);

// Ord combinators
const ordArrayNum = ordArray(ordNumber);
assert(ordArrayNum.lessThan([1, 2], [1, 3]) === true);
assert(ordArrayNum.lessThan([1, 2], [1, 2, 3]) === true);

// Reverse ordering
const revOrd = reverseOrd(ordNumber);
assert(revOrd.lessThan(3, 1) === true); // 3 < 1 in reverse order

// Ord by projection
const ordPointByX = ordBy((p: Point) => p.x, ordNumber);
assert(ordPointByX.lessThan({ x: 1, y: 99 }, { x: 2, y: 0 }) === true);

// Semigroup: associative combine operation (supports Op<"+">)
// The transformer rewrites `a + b` to `semigroupType.combine(a, b)` for custom types
assert(semigroupNumber.combine(3, 4) === 7);
assert(semigroupString.combine("hello", " world") === "hello world");

const semigroupArr = semigroupArray<number>();
const combined = semigroupArr.combine([1, 2], [3, 4]);
assert(combined.length === 4);
assert(combined[0] === 1 && combined[3] === 4);

// Monoid: Semigroup with identity element
assert(monoidNumber.empty() === 0);
assert(monoidString.empty() === "");
assert(monoidNumber.combine(monoidNumber.empty(), 42) === 42);

const monoidArr = monoidArray<number>();
assert(monoidArr.empty().length === 0);
assert(monoidArr.combine(monoidArr.empty(), [1, 2, 3]).length === 3);

// ============================================================================
// 5. NUMERIC OPERATIONS WITH Op<> — Typeclass-based arithmetic
// ============================================================================

// The Numeric typeclass supports operator dispatch via Op<> annotations:
// - `a + b` → `numericType.add(a, b)` via Op<"+">
// - `a - b` → `numericType.sub(a, b)` via Op<"-">
// - `a * b` → `numericType.mul(a, b)` via Op<"*">
// This enables custom numeric types to work with standard operators.

// Integral typeclass for integer division:
// - `a / b` → `integralType.div(a, b)` via Op<"/"> (floor division)
// - `a % b` → `integralType.mod(a, b)` via Op<"%">

// Fractional typeclass for real division:
// - `a / b` → `fractionalType.div(a, b)` via Op<"/"> (true division)

// Example: Using Numeric for generic arithmetic
function genericSum<A>(xs: A[], N: Numeric<A>): A {
  let acc = N.zero();
  for (const x of xs) {
    acc = N.add(acc, x); // With transformer: acc + x
  }
  return acc;
}
assert(genericSum([1, 2, 3, 4, 5], numericNumber) === 15);

// ============================================================================
// 6. NUMBER EXTENSIONS — Arithmetic, predicates, formatting
// ============================================================================

assert(clamp(150, 0, 100) === 100);
assert(clamp(-5, 0, 100) === 0);
assert(lerp(0, 100, 0.5) === 50);
assert(roundTo(3.14159, 2) === 3.14);

assert(isEven(4) === true);
assert(isOdd(7) === true);
assert(isPrime(17) === true);
assert(isPrime(15) === false);
assert(gcd(12, 8) === 4);
assert(lcm(4, 6) === 12);

// ============================================================================
// 7. STRING EXTENSIONS — Case transforms, parsing, predicates
// ============================================================================

assert(capitalize("hello") === "Hello");
assert(camelCase("hello world") === "helloWorld");
assert(snakeCase("helloWorld") === "hello_world");
assert(kebabCase("HelloWorld") === "hello-world");
assert(truncate("a long string that should be cut", 15) === "a long strin...");
assert(isBlank("") === true);
assert(isBlank("  ") === true);
assert(isBlank("x") === false);

const w = words("camelCaseString");
assert(w.length > 0);

// ============================================================================
// 8. ARRAY EXTENSIONS — Functional collection operations
// ============================================================================

assert(head([1, 2, 3]) === 1);
assert(last([1, 2, 3]) === 3);

const tl = tail([1, 2, 3]);
assert(tl[0] === 2 && tl[1] === 3);

const chunks = chunk([1, 2, 3, 4, 5], 2);
assert(chunks.length === 3);
assert(chunks[0][0] === 1 && chunks[0][1] === 2);
assert(chunks[2][0] === 5);

assert(unique([1, 2, 2, 3, 3, 3])[2] === 3);
assert(unique([1, 2, 2, 3]).length === 3);

const zipped = zip([1, 2, 3], ["a", "b", "c"]);
assert(zipped[0][0] === 1 && zipped[0][1] === "a");

const [evens, odds] = partition([1, 2, 3, 4, 5, 6], (n) => n % 2 === 0);
assert(evens[0] === 2);
assert(odds[0] === 1);

const grouped = arrayGroupBy(["ant", "apple", "bee", "bat"], (s) => s[0]);
assert(grouped.get("a")!.length === 2);
assert(grouped.get("b")!.length === 2);

const sorted = sortBy([{ n: 3 }, { n: 1 }, { n: 2 }], (x) => x.n);
assert(sorted[0].n === 1);

const inter = intersperse([1, 2, 3], 0);
assert(inter.length === 5);
assert(inter[1] === 0);

const taken = takeWhile([1, 2, 3, 4, 5], (n) => n < 4);
assert(taken.length === 3);

const dropped = dropWhile([1, 2, 3, 4, 5], (n) => n < 3);
assert(dropped[0] === 3);

assert(flatten([[1, 2], [3], [4, 5]]).length === 5);
assert(compact([1, null, 2, undefined, 3]).length === 3);

// ============================================================================
// 9. OBJECT EXTENSIONS — pick, omit, deep merge
// ============================================================================

const obj = { a: 1, b: 2, c: 3, d: 4 };

const picked = pick(obj, ["a", "c"]);
assert(picked.a === 1);
assert(picked.c === 3);
assert(!("b" in picked));

const omitted = omit(obj, ["a", "d"]);
assert(omitted.b === 2);
assert(!("a" in omitted));

const merged = deepMerge(
  { theme: { color: "blue", size: 12 } },
  { theme: { color: "red", font: "mono" } }
);
assert((merged as any).theme.color === "red");
assert((merged as any).theme.size === 12);
assert((merged as any).theme.font === "mono");

// ============================================================================
// 10. DATA TYPES — Pair, Triple, Range
// ============================================================================

// Pair: typed 2-tuples with combinators
const p = pair(1, "hello");
assert(fst(p) === 1);
assert(snd(p) === "hello");
typeAssert<Equal<typeof p, readonly [1, "hello"]>>();

const swapped = swap(p);
assert(fst(swapped) === "hello");
assert(snd(swapped) === 1);

const mapped = bimap(pair(3, "hi"), (n) => n * 2, (s) => s.toUpperCase());
assert(fst(mapped) === 6);
assert(snd(mapped) === "HI");

// Triple: typed 3-tuples
const t = triple(1, "two", true);
assert(t[0] === 1 && t[1] === "two" && t[2] === true);

// Range: Scala/Kotlin-style numeric ranges
const r = range(0, 5);
const arr = rangeToArray(r);
assert(arr.length === 5);
assert(arr[0] === 0 && arr[4] === 4);

const inclusive = rangeInclusive(1, 5);
const inclArr = rangeToArray(inclusive);
assert(inclArr.length === 5);
assert(inclArr[4] === 5);

const stepped = rangeBy(range(0, 10), 2);
const steppedArr = rangeToArray(stepped);
assert(steppedArr[0] === 0 && steppedArr[1] === 2 && steppedArr[2] === 4);

assert(rangeContains(range(0, 10), 5) === true);
assert(rangeContains(range(0, 10), 10) === false);

const doubled = rangeMap(range(1, 4), (n) => n * 2);
assert(doubled[0] === 2 && doubled[1] === 4 && doubled[2] === 6);

// --------------------------------------------------------------------------
// 10.4 Typeclass Instances for Data Types
// --------------------------------------------------------------------------

// Pair has Eq and Ord instances that work with Op<> operator dispatch.
// These are generic: you provide Eq/Ord instances for the element types.

const eqPairNumStr = eqPair(eqNumber, eqString);
assert(eqPairNumStr.equals(pair(1, "a"), pair(1, "a")) === true);
assert(eqPairNumStr.equals(pair(1, "a"), pair(2, "a")) === false);
assert(eqPairNumStr.notEquals(pair(1, "a"), pair(1, "b")) === true);

const ordPairNumNum = ordPair(ordNumber, ordNumber);
assert(ordPairNumNum.lessThan(pair(1, 2), pair(1, 3)) === true); // Lexicographic: (1,2) < (1,3)
assert(ordPairNumNum.lessThan(pair(1, 2), pair(2, 1)) === true); // First element differs
assert(ordPairNumNum.compare(pair(1, 1), pair(1, 1)) === EQ_ORD);

// Triple has the same pattern
const eqTripleNum = eqTriple(eqNumber, eqNumber, eqNumber);
assert(eqTripleNum.equals(triple(1, 2, 3), triple(1, 2, 3)) === true);
assert(eqTripleNum.equals(triple(1, 2, 3), triple(1, 2, 4)) === false);

const ordTripleNum = ordTriple(ordNumber, ordNumber, ordNumber);
assert(ordTripleNum.lessThan(triple(1, 2, 3), triple(1, 2, 4)) === true);
assert(ordTripleNum.compare(triple(1, 2, 3), triple(1, 2, 3)) === EQ_ORD);

// Range has concrete Eq and Ord instances (registered for operator dispatch)
const r1 = range(0, 10);
const r2 = range(0, 10);
const r3 = range(0, 20);

assert(eqRange.equals(r1, r2) === true);
assert(eqRange.equals(r1, r3) === false);
assert(ordRange.lessThan(r1, r3) === true); // (0,10) < (0,20) by end

// With transformer active:
// - `pair1 === pair2` would use eqPair
// - `range1 < range2` would use ordRange.lessThan

// ============================================================================
// 11. PATTERN MATCHING — match(), when(), otherwise(), isType(), P
// ============================================================================

// Discriminated union matching (Scala-style)
type Shape =
  | { kind: "circle"; radius: number }
  | { kind: "square"; side: number }
  | { kind: "triangle"; base: number; height: number };

const circle: Shape = { kind: "circle", radius: 5 };
const area = match(circle, {
  circle: ({ radius }) => Math.PI * radius ** 2,
  square: ({ side }) => side ** 2,
  triangle: ({ base, height }) => 0.5 * base * height,
});
assert(Math.abs(area - Math.PI * 25) < 1e-10);

// Literal dispatch
const httpMsg = match(200 as 200 | 404 | 500, {
  200: () => "OK",
  404: () => "Not Found",
  500: () => "Server Error",
});
assert(httpMsg === "OK");

// Guard-based matching with when/otherwise
const category = match(25, [
  when((n: number) => n < 13, () => "child"),
  when((n: number) => n < 18, () => "teen"),
  when((n: number) => n < 65, () => "adult"),
  otherwise(() => "senior"),
]);
assert(category === "adult");

// Type-based matching with isType()
const describe = match("hello" as string | number | boolean, [
  when(isType("string"), (s) => `string(${s})`),
  when(isType("number"), (n) => `number(${n})`),
  otherwise(() => "other"),
]);
assert(describe === "string(hello)");

// Array pattern helpers
const listResult = match([1, 2, 3] as number[], [
  when(P.empty, () => "empty"),
  when(P.length(1), ([x]: number[]) => `single: ${x}`),
  when(P.minLength(2), ([a, b]: number[]) => `starts with ${a}, ${b}`),
  otherwise(() => "fallback"),
]);
assert(listResult === "starts with 1, 2");

// ============================================================================
// 12. DO-NOTATION — let:/yield: and par:/yield: comprehensions
// ============================================================================

// FlatMap is pre-registered for Array, Promise, and other types.
// The comprehension macros desugar to flatMap/map chains at compile time.
//
// NOTE: These examples show the *output* of the transformations, since
// the let:/yield: and par:/yield: syntax requires the typesugar transformer.

// --------------------------------------------------------------------------
// 12.1 Sequential Comprehensions (let:/yield:)
// --------------------------------------------------------------------------

// Basic array comprehension (cartesian product):
//   let: { x << [1, 2, 3]; y << [x * 10, x * 20] }
//   yield: ({ x, y })
// Compiles to:
const arrayComprehension = [1, 2, 3].flatMap((x) =>
  [x * 10, x * 20].map((y) => ({ x, y }))
);
assert(arrayComprehension.length === 6);
assert(arrayComprehension[0].x === 1 && arrayComprehension[0].y === 10);

// Promise chaining (sequential):
//   let: { user << fetchUser(id); posts << fetchPosts(user.id) }
//   yield: ({ user, posts })
// Compiles to:
async function sequentialFetch() {
  const result = await Promise.resolve({ id: 1, name: "Alice" }).then((user) =>
    Promise.resolve([{ userId: user.id, title: "Post" }]).then((posts) => ({
      user,
      posts,
    }))
  );
  assert(result.user.name === "Alice");
  assert(result.posts.length === 1);
}

// Guards (filtering):
//   let: { x << [1, 2, 3, 4, 5]; if (x % 2 === 0) {} }
//   yield: { x }
// Compiles to:
const filtered = [1, 2, 3, 4, 5].map((x) => (x % 2 === 0 ? x : undefined)).filter((x) => x !== undefined);
assert(filtered.length === 2);
assert(filtered[0] === 2 && filtered[1] === 4);

// Pure map step (IIFE):
//   let: { x << [1, 2, 3]; doubled = x * 2; y << [doubled + 1] }
//   yield: { y }
// Compiles to:
const withPureMap = [1, 2, 3].flatMap((x) =>
  ((doubled) => [doubled + 1].map((y) => y))(x * 2)
);
assert(withPureMap[0] === 3); // (1*2)+1

// Discard binding:
//   let: { _ << sideEffect(); x << getValue() }
//   yield: { x }
// The _ binding executes but its value is ignored

// --------------------------------------------------------------------------
// 12.2 Parallel Comprehensions (par:/yield:)
// --------------------------------------------------------------------------

// Promise.all (parallel execution):
//   par: { a << fetchA(); b << fetchB(); c << fetchC() }
//   yield: ({ a, b, c })
// Compiles to:
async function parallelFetch() {
  const result = await Promise.all([
    Promise.resolve("Alice"),
    Promise.resolve(30),
    Promise.resolve(["admin"]),
  ]).then(([name, age, roles]) => ({ name, age, roles }));
  assert(result.name === "Alice");
  assert(result.age === 30);
  assert(result.roles[0] === "admin");
}

// Applicative combination (.map/.ap):
//   par: { a << Box(10); b << Box(20) }
//   yield: { a + b }
// Compiles to:
class Box<A> {
  constructor(public readonly value: A) {}
  map<B>(f: (a: A) => B): Box<B> {
    return new Box(f(this.value));
  }
  ap<B>(this: Box<(a: A) => B>, boxA: Box<A>): Box<B> {
    return new Box(this.value(boxA.value));
  }
}

const applicativeResult = new Box(10)
  .map((a: number) => (b: number) => a + b)
  .ap(new Box(20));
assert(applicativeResult.value === 30);

// Error accumulation with Validation:
//   par: { name << valid("Alice"); age << invalid("age required") }
//   yield: ({ name, age })
// Unlike let:, par: accumulates ALL errors from all bindings

// --------------------------------------------------------------------------
// 12.3 Custom FlatMap Registration
// --------------------------------------------------------------------------

// Register a custom monad for use with let:/yield:
class Task<T> {
  constructor(public readonly run: () => T) {}
  map<U>(f: (t: T) => U): Task<U> {
    return new Task(() => f(this.run()));
  }
  flatMap<U>(f: (t: T) => Task<U>): Task<U> {
    return new Task(() => f(this.run()).run());
  }
}

registerFlatMap("Task", {
  map: (ta: Task<unknown>, f: (a: unknown) => unknown) => ta.map(f),
  flatMap: (ta: Task<unknown>, f: (a: unknown) => Task<unknown>) => ta.flatMap(f),
});

// Now Task works with let:/yield:
//   let: { x << new Task(() => 10); y << new Task(() => x * 2) }
//   yield: { y }
const taskResult = new Task(() => 10).flatMap((x) =>
  new Task(() => x * 2).map((y) => y)
);
assert(taskResult.run() === 20);

// ============================================================================
// 13. TYPE-LEVEL ASSERTIONS — verifying typeclass shapes
// ============================================================================

typeAssert<Extends<typeof numericNumber, Numeric<number>>>();
typeAssert<Extends<typeof integralNumber, Integral<number>>>();
typeAssert<Extends<typeof floatingNumber, Floating<number>>>();
typeAssert<Extends<typeof groupNumber, Group<number>>>();

typeAssert<Extends<typeof eqNumber, Eq<number>>>();
typeAssert<Extends<typeof ordNumber, Ord<number>>>();
typeAssert<Extends<typeof semigroupNumber, Semigroup<number>>>();
typeAssert<Extends<typeof monoidNumber, Monoid<number>>>();

typeAssert<Equal<Ordering, -1 | 0 | 1>>();
typeAssert<Extends<typeof LT, Ordering>>();
typeAssert<Extends<typeof EQ_ORD, Ordering>>();
typeAssert<Extends<typeof GT, Ordering>>();

// ParseResult is a tagged union
type NumParsed = ParseResult<number>;
typeAssert<Equal<NumParsed, { ok: true; value: number; rest: string } | { ok: false; error: string }>>();

// Pair is a readonly tuple
typeAssert<Equal<ReturnType<typeof pair<number, string>>, readonly [number, string]>>();

// ============================================================================
// 14. TRANSFORMER FEATURES — Op<> Operator Dispatch Setup
// ============================================================================

// The @typesugar/std typeclasses are annotated with Op<> for operator dispatch.
// When the transformer is active:
//   - `a === b` on custom types → `eqInstance.equals(a, b)`
//   - `a < b`   on custom types → `ordInstance.lessThan(a, b)`
//   - `a + b`   on custom types → `semigroupInstance.combine(a, b)` or `numericInstance.add(a, b)`
//
// The `registerStdInstances()` macro (or importing @typesugar/std/macros) registers:
// 1. Typeclass definitions with their Op<> syntax mappings (Eq→"===", Ord→"<", etc.)
// 2. Primitive instances (eqNumber, ordNumber, semigroupNumber, etc.)
//
// This enables the transformer's `tryRewriteTypeclassOperator()` to resolve instances.

// Example: How Op<> annotations work in interface definitions
//
// interface Eq<A> {
//   equals(a: A, b: A): boolean & Op<"===">;   // → "===" maps to equals()
//   notEquals(a: A, b: A): boolean & Op<"!==">; // → "!==" maps to notEquals()
// }
//
// interface Ord<A> extends Eq<A> {
//   lessThan(a: A, b: A): boolean & Op<"<">;
//   lessThanOrEqual(a: A, b: A): boolean & Op<"<=">;
//   greaterThan(a: A, b: A): boolean & Op<">">;
//   greaterThanOrEqual(a: A, b: A): boolean & Op<">=">;
// }
//
// interface Numeric<A> {
//   add(a: A, b: A): A & Op<"+">;
//   sub(a: A, b: A): A & Op<"-">;
//   mul(a: A, b: A): A & Op<"*">;
// }

// When transformer sees `point1 === point2` where Point has an Eq instance:
// 1. Gets the type of point1 → "Point"
// 2. Looks up syntaxRegistry for "===" → finds Eq.equals
// 3. Looks up instanceRegistry for Eq<Point> → finds eqPoint instance
// 4. Rewrites to: eqPoint.equals(point1, point2)

// To enable operator dispatch for custom types, either:
// 1. Use @derive(Eq, Ord) to auto-derive instances (recommended)
// 2. Use @instance to register custom instances
// 3. Call registerInstanceWithMeta() programmatically

// Verify the typeclasses have syntax mappings
import { getSyntaxForOperator } from "@typesugar/macros";

const eqSyntax = getSyntaxForOperator("===");
assert(eqSyntax !== undefined, "Eq syntax should be registered for ===");
assert(eqSyntax!.some(e => e.typeclass === "Eq" && e.method === "equals"));

const ordSyntax = getSyntaxForOperator("<");
assert(ordSyntax !== undefined, "Ord syntax should be registered for <");
assert(ordSyntax!.some(e => e.typeclass === "Ord" && e.method === "lessThan"));

const semigroupSyntax = getSyntaxForOperator("+");
assert(semigroupSyntax !== undefined, "Semigroup/Numeric syntax should be registered for +");
// Multiple typeclasses can map to the same operator (Semigroup, Monoid, Group, Numeric)
assert(semigroupSyntax!.length >= 1);

// Verify instances are registered
import { findInstance } from "@typesugar/macros";

const eqNumInst = findInstance("Eq", "number");
assert(eqNumInst !== undefined, "Eq<number> instance should be registered");
assert(eqNumInst!.instanceName === "eqNumber");

const ordNumInst = findInstance("Ord", "number");
assert(ordNumInst !== undefined, "Ord<number> instance should be registered");
assert(ordNumInst!.instanceName === "ordNumber");

const numericNumInst = findInstance("Numeric", "number");
assert(numericNumInst !== undefined, "Numeric<number> instance should be registered");
assert(numericNumInst!.instanceName === "numericNumber");

// ============================================================================
// 15. @IMPLICITS — Auto-Resolution of Typeclass Instances
// ============================================================================

// The @implicits decorator enables automatic resolution of typeclass instances.
// When a function has implicit parameters (Eq<A>, Ord<A>, Numeric<A>, etc.),
// @implicits fills them in at call sites based on type inference.
//
// NOTE: These examples show the DESIGN of @implicits. The actual transformation
// happens at compile time when the typesugar transformer is active.

// --------------------------------------------------------------------------
// 15.1 Manual Dictionary-Passing (Without @implicits)
// --------------------------------------------------------------------------

// Without @implicits, you pass instances explicitly:
function sortWithManual<A>(xs: A[], O: Ord<A>): A[] {
  return [...xs].sort((a, b) => O.compare(a, b));
}

// Caller must provide the instance:
const sortedManual = sortWithManual([3, 1, 4, 1, 5], ordNumber);
assert(sortedManual[0] === 1);
assert(sortedManual[4] === 5);

// --------------------------------------------------------------------------
// 15.2 With @implicits (Design Pattern)
// --------------------------------------------------------------------------

// With @implicits, the transformer resolves instances automatically:
//
// @implicits
// function sortWith<A>(xs: A[], O?: Ord<A>): A[] {
//   return [...xs].sort((a, b) => O!.compare(a, b));
// }
//
// // At call site:
// sortWith([3, 1, 4]); // Transformer infers Ord<number> → ordNumber
//
// Compiles to:
// sortWith([3, 1, 4], ordNumber);

// The fn.specialize(dict) extension provides explicit specialization:
//
// const sortNumbers = sortWith.specialize(ordNumber);
// sortNumbers([3, 1, 4]); // No runtime dictionary lookup
//
// This is the "progressive disclosure" model:
// 1. Operators/methods just work (fully implicit)
// 2. @implicits for generic functions (auto-filled at call site)
// 3. fn.specialize(dict) for explicit named specializations

// --------------------------------------------------------------------------
// 15.3 Generic Operations Using @implicits Pattern
// --------------------------------------------------------------------------

// Generic min using Ord:
function minWith<A>(a: A, b: A, O: Ord<A>): A {
  return O.lessThan(a, b) ? a : b;
}

assert(minWith(10, 5, ordNumber) === 5);
assert(minWith("apple", "banana", ordString) === "apple");

// Generic max using Ord:
function maxWith<A>(a: A, b: A, O: Ord<A>): A {
  return O.greaterThan(a, b) ? a : b;
}

assert(maxWith(10, 5, ordNumber) === 10);
assert(maxWith("apple", "banana", ordString) === "banana");

// Generic clamp using Ord:
function clampWithOrd<A>(value: A, lo: A, hi: A, O: Ord<A>): A {
  if (O.lessThan(value, lo)) return lo;
  if (O.greaterThan(value, hi)) return hi;
  return value;
}

assert(clampWithOrd(50, 0, 100, ordNumber) === 50);
assert(clampWithOrd(-10, 0, 100, ordNumber) === 0);
assert(clampWithOrd(150, 0, 100, ordNumber) === 100);

// Generic combine using Semigroup:
function combineAll<A>(xs: A[], S: Semigroup<A>, zero: A): A {
  return xs.reduce((acc, x) => S.combine(acc, x), zero);
}

assert(combineAll([1, 2, 3, 4], semigroupNumber, 0) === 10);
assert(combineAll(["hello", " ", "world"], semigroupString, "") === "hello world");

// ============================================================================
// 16. SUM TYPE DERIVATION — @derive on Discriminated Unions
// ============================================================================

// The derive macro supports discriminated unions (sum types) in addition to
// product types (records). When you @derive(Eq, Ord) on a union, it:
// 1. Checks the discriminant field first
// 2. Only compares same-variant fields when discriminants match

// --------------------------------------------------------------------------
// 16.1 Example: Result<T, E> Sum Type
// --------------------------------------------------------------------------

// A simple Result type (similar to Rust's Result or fp-ts Either):
type Result<T, E> =
  | { readonly _tag: "Ok"; readonly value: T }
  | { readonly _tag: "Err"; readonly error: E };

// Constructors:
const Ok = <T>(value: T): Result<T, never> => ({ _tag: "Ok", value });
const Err = <E>(error: E): Result<never, E> => ({ _tag: "Err", error });

// Manual Eq instance for Result (shows what @derive(Eq) would generate):
function eqResult<T, E>(eqT: Eq<T>, eqE: Eq<E>): Eq<Result<T, E>> {
  return {
    equals: ((a, b) => {
      // Check discriminant first
      if (a._tag !== b._tag) return false;
      // Compare variant-specific fields
      if (a._tag === "Ok" && b._tag === "Ok") {
        return eqT.equals(a.value, b.value);
      }
      if (a._tag === "Err" && b._tag === "Err") {
        return eqE.equals(a.error, b.error);
      }
      return false;
    }) as Eq<Result<T, E>>["equals"],
    notEquals: ((a, b) => !eqResult(eqT, eqE).equals(a, b)) as Eq<Result<T, E>>["notEquals"],
  };
}

const eqResultNumStr = eqResult(eqNumber, eqString);

// Same variant, same value → equal
assert(eqResultNumStr.equals(Ok(42), Ok(42)) === true);
assert(eqResultNumStr.equals(Err("oops"), Err("oops")) === true);

// Same variant, different value → not equal
assert(eqResultNumStr.equals(Ok(42), Ok(99)) === false);
assert(eqResultNumStr.equals(Err("a"), Err("b")) === false);

// Different variants → not equal
assert(eqResultNumStr.equals(Ok(42), Err("fail") as Result<number, string>) === false);

// --------------------------------------------------------------------------
// 16.2 Example: Tree<A> Recursive Sum Type
// --------------------------------------------------------------------------

// Recursive types demonstrate depth of derivation:
type Tree<A> =
  | { readonly _tag: "Leaf"; readonly value: A }
  | { readonly _tag: "Branch"; readonly left: Tree<A>; readonly right: Tree<A> };

const Leaf = <A>(value: A): Tree<A> => ({ _tag: "Leaf", value });
const Branch = <A>(left: Tree<A>, right: Tree<A>): Tree<A> => ({ _tag: "Branch", left, right });

// Manual recursive Eq (what @derive(Eq) would generate with recursion):
function eqTree<A>(eqA: Eq<A>): Eq<Tree<A>> {
  const eq: Eq<Tree<A>> = {
    equals: ((a, b) => {
      if (a._tag !== b._tag) return false;
      if (a._tag === "Leaf" && b._tag === "Leaf") {
        return eqA.equals(a.value, b.value);
      }
      if (a._tag === "Branch" && b._tag === "Branch") {
        return eq.equals(a.left, b.left) && eq.equals(a.right, b.right);
      }
      return false;
    }) as Eq<Tree<A>>["equals"],
    notEquals: ((a, b) => !eq.equals(a, b)) as Eq<Tree<A>>["notEquals"],
  };
  return eq;
}

const eqTreeNum = eqTree(eqNumber);

const tree1: Tree<number> = Branch(Leaf(1), Branch(Leaf(2), Leaf(3)));
const tree2: Tree<number> = Branch(Leaf(1), Branch(Leaf(2), Leaf(3)));
const tree3: Tree<number> = Branch(Leaf(1), Leaf(99));

assert(eqTreeNum.equals(tree1, tree2) === true);
assert(eqTreeNum.equals(tree1, tree3) === false);

// --------------------------------------------------------------------------
// 16.3 @derive Usage (With Transformer)
// --------------------------------------------------------------------------

// When the transformer is active, you can use @derive directly:
//
// @derive(Eq, Ord)
// type Option<A> =
//   | { readonly _tag: "None" }
//   | { readonly _tag: "Some"; readonly value: A };
//
// // The transformer generates:
// // - eqOption<A>(eqA: Eq<A>): Eq<Option<A>>
// // - ordOption<A>(ordA: Ord<A>): Ord<Option<A>>
//
// // Operators then work automatically:
// const opt1: Option<number> = { _tag: "Some", value: 42 };
// const opt2: Option<number> = { _tag: "Some", value: 42 };
// opt1 === opt2; // Compiles to: eqOption(eqNumber).equals(opt1, opt2)

// ============================================================================
// 17. COMPLETE TRANSFORMER INTEGRATION — How It All Fits Together
// ============================================================================

// Summary of transformer features demonstrated in this showcase:
//
// 1. **Op<> Annotations** (Section 4, 5, 14)
//    - Typeclasses define which operators map to which methods
//    - `Eq<A>.equals → ===`, `Ord<A>.lessThan → <`, `Numeric<A>.add → +`
//
// 2. **Instance Registration** (Section 14)
//    - registerStdInstances() macro registers all std instances
//    - Enables summon<Eq<number>>(), findInstance("Eq", "number"), etc.
//
// 3. **@implicits Pattern** (Section 15)
//    - Generic functions with optional typeclass params
//    - Transformer fills in instances at call sites
//
// 4. **Sum Type Derivation** (Section 16)
//    - @derive works on discriminated unions
//    - Generates discriminant-first comparison logic
//
// 5. **fn.specialize(dict)** (Section 15.2)
//    - Extension method syntax for explicit specialization
//    - Creates zero-cost inlined versions
//
// 6. **let:/yield: and par:/yield:** (Section 12)
//    - Do-notation via FlatMap typeclass
//    - Instance lookup via unified registry

// ============================================================================
// SHOWCASE COMPLETE
// ============================================================================

console.log("✓ @typesugar/std showcase completed successfully");

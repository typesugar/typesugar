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

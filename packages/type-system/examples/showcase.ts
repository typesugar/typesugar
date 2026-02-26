/**
 * @typesugar/type-system Showcase
 *
 * Self-documenting examples of advanced type system extensions:
 * refined types, newtypes, HKT encoding, phantom state machines,
 * existential types, opaque modules, and length-indexed vectors.
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
  // Type-level utilities
  type Equal as TEqual,
  type Not as TNot,
  type And,
  type Or,
  type IsNever,
  type IsAny,
  type IsUnknown,

  // HKT
  type $,
  type ArrayF,
  type PromiseF,
  type SetF,
  type MapF,

  // Existential types
  type Exists,
  type Showable,
  packExists,
  useExists,
  mapExists,
  showable,
  showValue,

  // Refinement types
  type Refined,
  refinement,
  composeRefinements,
  Positive,
  NonNegative,
  Int,
  Byte,
  Port,
  Percentage,
  NonEmpty,
  Email,

  // Subtyping coercions
  declareSubtyping,
  isSubtype,
  widen,

  // Newtype
  type Newtype,
  wrap,
  unwrap,
  newtypeCtor,
  validatedNewtype,

  // Opaque modules
  opaqueModule,
  PositiveInt,
  NonEmptyString,
  EmailAddress,

  // Phantom types / typed builder
  createBuilder,

  // Effect system
  type Pure,
  type IO,
  type Async,
  type HasEffect,
  type CombineEffects,
  effectRegistry,
  registerPure,
  registerEffect,

  // Vec
  Vec,
  isVec,
  type Add,
  type Sub,
} from "../src/index.js";

// ============================================================================
// 1. TYPE-LEVEL BOOLEAN UTILITIES - Compile-Time Type Predicates
// ============================================================================

// Equal checks structural type identity
typeAssert<TEqual<string, string>>();
typeAssert<TNot<TEqual<string, number>>>();

// Extends checks assignability
typeAssert<Extends<"hello", string>>();
typeAssert<Not<Extends<string, "hello">>>();

// Boolean algebra on types
typeAssert<And<true, true>>();
typeAssert<TNot<And<true, false>>>();
typeAssert<Or<true, false>>();
typeAssert<TNot<Or<false, false>>>();

// Type classification
typeAssert<IsNever<never>>();
typeAssert<TNot<IsNever<string>>>();
typeAssert<IsAny<any>>();
typeAssert<TNot<IsAny<unknown>>>();
typeAssert<IsUnknown<unknown>>();
typeAssert<TNot<IsUnknown<any>>>();

console.log("1. Type-level boolean utilities: all type assertions passed");

// ============================================================================
// 2. HIGHER-KINDED TYPES (HKT) - Type Constructors as Parameters
// ============================================================================

// $<F, A> applies a type constructor F to argument A
type StringArray = $<ArrayF, string>;
typeAssert<Equal<StringArray, string[]>>();

type NumPromise = $<PromiseF, number>;
typeAssert<Equal<NumPromise, Promise<number>>>();

type StringSet = $<SetF, string>;
typeAssert<Equal<StringSet, Set<string>>>();

type StringNumMap = $<MapF<string>, number>;
typeAssert<Equal<StringNumMap, Map<string, number>>>();

// HKT enables generic programming over type constructors
interface Functor<F> {
  map<A, B>(fa: $<F, A>, f: (a: A) => B): $<F, B>;
}

const arrayFunctor: Functor<ArrayF> = {
  map: (fa, f) => fa.map(f),
};

const mapped = arrayFunctor.map([1, 2, 3], (x) => x.toString());
assert(mapped[0] === "1");
assert(mapped.length === 3);

console.log("2. HKT encoding: $<ArrayF, string> = string[], functor map works");

// ============================================================================
// 3. REFINEMENT TYPES - Values with Compile-Time Validated Predicates
// ============================================================================

// Built-in refinements validate at the boundary
const port = Port.refine(8080);
assert(port === 8080);
typeAssert<Extends<typeof port, number>>();

const byte = Byte.refine(255);
assert(byte === 255);

const pct = Percentage.refine(75);
assert(pct === 75);

// Type guards for runtime checking
const maybePositive = 42;
if (Positive.is(maybePositive)) {
  assert(maybePositive > 0);
}

// .from() returns undefined on invalid input (no throwing)
const badPort = Port.from(-1);
assert(badPort === undefined);

const goodPort = Port.from(443);
assert(goodPort === 443);

// Custom refinements via composition
const PositiveInteger = composeRefinements(Int, Positive);
const val = PositiveInteger.refine(7);
assert(val === 7);

// Custom refinement from scratch
type EvenNumber = Refined<number, "EvenNumber">;
const Even = refinement<number, "EvenNumber">(
  (n) => n % 2 === 0,
  "EvenNumber",
);
assert(Even.refine(4) === 4);
assert(Even.from(3) === undefined);

// String refinements
const email = Email.refine("user@example.com");
assert(typeof email === "string");

const name = NonEmpty.refine("Alice");
assert(name.length > 0);

console.log("3. Refinement types: Port, Byte, Percentage, custom Even — all validated");

// ============================================================================
// 4. NEWTYPE (ZERO-COST BRANDING) - Type Discrimination Without Runtime Cost
// ============================================================================

// Newtypes create branded types that are just the underlying type at runtime
type UserId = Newtype<number, "UserId">;
type OrderId = Newtype<number, "OrderId">;

const userId = wrap<UserId>(42);
const orderId = wrap<OrderId>(42);

// Same value, but different types — can't mix them up
assert(unwrap(userId) === 42);
assert(unwrap(orderId) === 42);

// Type-level: UserId and OrderId are distinct
typeAssert<Not<Equal<UserId, OrderId>>>();
typeAssert<Not<Extends<UserId, OrderId>>>();

// newtypeCtor creates a reusable constructor (unwrap with unwrap())
const mkUserId = newtypeCtor<UserId>();
const user = mkUserId(100);
assert(unwrap(user) === 100);

// validatedNewtype adds a predicate (throws on invalid input)
type NonNegativeId = Newtype<number, "NonNegativeId">;
const NonNegId = validatedNewtype<NonNegativeId>((n) => n >= 0);
const goodId = NonNegId(5); // Returns the value if valid
assert(unwrap(goodId) === 5);

// Invalid input throws — use try/catch or opaqueModule for safe API
let badIdThrew = false;
try {
  NonNegId(-1);
} catch {
  badIdThrew = true;
}
assert(badIdThrew);

console.log("4. Newtype branding: UserId !== OrderId at type level, same at runtime");

// ============================================================================
// 5. OPAQUE TYPE MODULES - ML-Style Abstract Types
// ============================================================================

// Opaque modules hide the representation and expose only safe operations
const posInt = PositiveInt.tryCreate(42); // tryCreate returns T | undefined
assert(posInt !== undefined);

const nonEmptyStr = NonEmptyString.tryCreate("hello");
assert(nonEmptyStr !== undefined);

const emailAddr = EmailAddress.tryCreate("test@example.com");
assert(emailAddr !== undefined);

const badEmail = EmailAddress.tryCreate("not-an-email");
assert(badEmail === undefined);

// Custom opaque module (curried API: opaqueModule<Repr>(brand, validate)(ops))
const SafeAge = opaqueModule<number>(
  "SafeAge",
  (n) => Number.isInteger(n) && n >= 0 && n <= 150
)({
  toNumber: (n: number) => n,
});
const age = SafeAge.tryCreate(25); // tryCreate returns T | undefined
assert(age !== undefined);
const badAge = SafeAge.tryCreate(-5);
assert(badAge === undefined);

console.log("5. Opaque modules: PositiveInt, NonEmptyString, EmailAddress, custom SafeAge");

// ============================================================================
// 6. PHANTOM TYPES & TYPED BUILDER - Compile-Time Safety Patterns
// ============================================================================

// Phantom types tag values with type-level state without runtime cost
// The Phantom<Data, State> type brands data with a state marker

// Type-safe builder pattern — tracks which fields have been set at type level
interface UserFields {
  name: string;
  email: string;
  age: number;
}

const userBuilder = createBuilder<UserFields>()
  .set("name", "Alice")
  .set("email", "alice@example.com")
  .set("age", 30);

const partialUser = userBuilder.partial();
assert(partialUser.name === "Alice");
assert(partialUser.age === 30);

// The builder tracks set fields at type level
// .build() is only available when all required fields are set (TypedBuilder type)
const completedUser = userBuilder.build();
assert(completedUser.name === "Alice");
assert(completedUser.email === "alice@example.com");
assert(completedUser.age === 30);

// State machine types are defined but runtime tracking requires transformer
// The type-level definition enables compile-time transition validation
type DoorDef = {
  closed: { open: "open"; lock: "locked" };
  open: { close: "closed" };
  locked: { unlock: "closed" };
};
type _DoorStates = keyof DoorDef; // "closed" | "open" | "locked"

console.log("6. Phantom types & typed builder: type-level state tracking");

// ============================================================================
// 7. EXISTENTIAL TYPES - Heterogeneous Collections with Capabilities
// ============================================================================

// Pack values with their capabilities — lose the concrete type, keep the interface
const showableNum: Showable = showable(42, String);
const showableStr: Showable = showable("hello", (s) => `"${s}"`);
const showableBool: Showable = showable(true, String);

// showValue uses the packed function to display the hidden value
assert(showValue(showableNum) === "42");
assert(showValue(showableStr) === '"hello"');
assert(showValue(showableBool) === "true");

// Heterogeneous collection — different types, same interface
const items: Showable[] = [showableNum, showableStr, showableBool];
const displayed = items.map(showValue);
assert(displayed.length === 3);

// Generic existential packing/unpacking
type HasLength = Exists<{ length: number }>;

const packed = packExists({ length: 5, data: [1, 2, 3, 4, 5] });
const len = useExists(packed, (val) => val.length);
assert(len === 5);

// mapExists extracts and transforms: (ex, extract, transform) => transform(extract(ex))
const doubled = mapExists(packed, (val) => val.length, (n) => n * 2);
assert(doubled === 10);

console.log("7. Existential types: heterogeneous Showable[], packExists/useExists");

// ============================================================================
// 8. LENGTH-INDEXED VECTORS (VEC) - Dependent-Type-Style Arrays
// ============================================================================

// Vec tracks array length in the type system
const empty = Vec.empty<number>();
assert((empty as number[]).length === 0);

const single = Vec.singleton("hello");
assert((single as string[]).length === 1);

const three = Vec.from<string, 3>(["a", "b", "c"]);
assert((three as string[]).length === 3);
assert(isVec(three));

// Type-level arithmetic on Vec lengths
type Three = 3;
type Four = Add<Three, 1>;
typeAssert<Equal<Four, 4>>();

type Two = Sub<Three, 1>;
typeAssert<Equal<Two, 2>>();

// Operations preserve length information
const four = Vec.cons("z", three);
assert((four as string[]).length === 4);

const appended = Vec.snoc(three, "d");
assert((appended as string[]).length === 4);

// Tuple constructor infers length
const tup = Vec.tuple(10, 20, 30, 40, 50);
assert((tup as number[]).length === 5);

// Fill and generate
const zeros = Vec.fill(0, 4);
assert((zeros as number[]).length === 4);

const indices = Vec.generate(5, (i) => i);
assert((indices as number[])[2] === 2);

console.log("8. Vec: length-indexed vectors with type-level arithmetic");

// ============================================================================
// 9. EFFECT SYSTEM ANNOTATIONS - Compile-Time Side-Effect Tracking
// ============================================================================

// Register pure and effectful functions for compile-time checking
registerPure("add");
registerEffect("writeFile", ["io"]);
registerEffect("fetchData", ["io", "async"]);

// Query effect annotations
const addEffects = effectRegistry.get("add");
assert(addEffects !== undefined);

const writeEffects = effectRegistry.get("writeFile");
assert(writeEffects !== undefined);

// Type-level effect tracking
type PureEffect = Pure;
type IOEffect = IO;
type AsyncEffect = Async;
type Combined = CombineEffects<IO, Async>;
type HasIO = HasEffect<IO, "io">;
typeAssert<Equal<HasIO, true>>();

console.log("9. Effect annotations: @pure, @effect('io'), compile-time tracking");

// ============================================================================
// 10. SUBTYPING COERCIONS - Safe Widening Between Refined Types
// ============================================================================

// Declare that Positive is a subtype of NonNegative
declareSubtyping("Positive", "NonNegative", {
  proof: "positive_implies_nonneg",
  description: "x > 0 implies x >= 0",
});

// Check subtyping relationships
assert(isSubtype("Positive", "NonNegative") === true);
assert(isSubtype("NonNegative", "Positive") === false);

// Safely widen a Positive to NonNegative
const pos: Positive = Positive.refine(5);
const nn: NonNegative = widen<Positive, NonNegative>(pos);
assert(nn === 5);

console.log("10. Subtyping coercions: Positive → NonNegative (safe widening)");

// ============================================================================
// SUMMARY
// ============================================================================

console.log("\n=== @typesugar/type-system Showcase Complete ===");
console.log(`
Features demonstrated:
  1. Type-level boolean utilities (Equal, Not, And, Or, IsNever, IsAny)
  2. Higher-Kinded Types ($<F, A> encoding, Functor)
  3. Refinement types (Positive, Byte, Port, custom, composition)
  4. Newtype branding (zero-cost type discrimination)
  5. Opaque type modules (ML-style abstract types)
  6. Phantom state machines (compile-time transition safety)
  7. Existential types (heterogeneous collections with capabilities)
  8. Length-indexed vectors (Vec<T, N> with type arithmetic)
  9. Effect system annotations (compile-time purity tracking)
 10. Subtyping coercions (safe widening between refined types)
`);

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
  type Kind,
  type ArrayF,
  type PromiseF,
  type SetF,
  type MapF,
  unsafeCoerce,

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
  Negative,
  Int,
  Byte,
  Port,
  Percentage,
  NonEmpty,
  Email,
  Url,
  Uuid,
  NonEmptyArray,
  MaxLength,
  MinLength,

  // Subtyping coercions
  declareSubtyping,
  isSubtype,
  widen,

  // Newtype
  type Newtype,
  type UnwrapNewtype,
  wrap,
  unwrap,
  newtypeCtor,
  validatedNewtype,

  // Opaque modules
  opaqueModule,
  PositiveInt,
  NonEmptyString,
  EmailAddress,

  // Phantom types / state machines
  type Phantom,
  createStateMachine,
  createBuilder,
  transition,

  // Effect system
  type Pure,
  type IO,
  type Async,
  type EffectsOf,
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
  type Min,
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
const PositiveInt = composeRefinements(Int, Positive);
const val = PositiveInt.refine(7);
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

// newtypeCtor creates reusable constructor/destructor pairs
const [mkUserId, getUserId] = newtypeCtor<UserId>();
const user = mkUserId(100);
assert(getUserId(user) === 100);

// validatedNewtype adds a predicate
type NonNegativeId = Newtype<number, "NonNegativeId">;
const NonNegId = validatedNewtype<NonNegativeId>((n) => n >= 0);
const goodId = NonNegId.create(5);
assert(goodId !== undefined);
const badId = NonNegId.create(-1);
assert(badId === undefined);

console.log("4. Newtype branding: UserId !== OrderId at type level, same at runtime");

// ============================================================================
// 5. OPAQUE TYPE MODULES - ML-Style Abstract Types
// ============================================================================

// Opaque modules hide the representation and expose only safe operations
const PositiveIntMod = PositiveInt; // Re-exported from opaque.ts
const posInt = PositiveIntMod.create(42);
assert(posInt !== undefined);

const nonEmptyStr = NonEmptyString.create("hello");
assert(nonEmptyStr !== undefined);

const emailAddr = EmailAddress.create("test@example.com");
assert(emailAddr !== undefined);

const badEmail = EmailAddress.create("not-an-email");
assert(badEmail === undefined);

// Custom opaque module
const SafeAge = opaqueModule<number, "SafeAge">({
  brand: "SafeAge",
  validate: (n) => Number.isInteger(n) && n >= 0 && n <= 150,
});
const age = SafeAge.create(25);
assert(age !== undefined);
const badAge = SafeAge.create(-5);
assert(badAge === undefined);

console.log("5. Opaque modules: PositiveInt, NonEmptyString, EmailAddress, custom SafeAge");

// ============================================================================
// 6. PHANTOM TYPE STATE MACHINES - Compile-Time State Transition Safety
// ============================================================================

// Define a door state machine with typed transitions
type DoorState = "open" | "closed" | "locked";

const Door = createStateMachine<DoorState>()
  .state("closed", { open: "open", lock: "locked" })
  .state("open", { close: "closed" })
  .state("locked", { unlock: "closed" })
  .build();

// Only valid transitions compile
const closed = Door.initial("closed");
assert(Door.getState(closed) === "closed");

const opened = Door.transition(closed, "open");
assert(Door.getState(opened) === "open");

const closedAgain = Door.transition(opened, "close");
assert(Door.getState(closedAgain) === "closed");

const locked = Door.transition(closedAgain, "lock");
assert(Door.getState(locked) === "locked");

const unlocked = Door.transition(locked, "unlock");
assert(Door.getState(unlocked) === "closed");

// Invalid transitions are type errors:
// Door.transition(opened, "lock");   // Can't lock an open door
// Door.transition(locked, "open");   // Must unlock first

// Typed builder pattern
interface FormData {
  name?: string;
  email?: string;
  age?: number;
}

const FormBuilder = createBuilder<FormData>()
  .field("name", (v: string) => v)
  .field("email", (v: string) => v)
  .field("age", (v: number) => v)
  .build();

const form = FormBuilder.create()
  .set("name", "Alice")
  .set("email", "alice@example.com")
  .set("age", 30);

assert(form.get("name") === "Alice");
assert(form.get("age") === 30);

console.log("6. Phantom state machines: Door (open/closed/locked), typed builder");

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

// mapExists transforms the packed value
const doubled = mapExists(packed, (val) => ({
  ...val,
  length: val.length * 2,
}));
const newLen = useExists(doubled, (val) => val.length);
assert(newLen === 10);

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

/**
 * @typesugar/typeclass Showcase
 *
 * Self-documenting examples of the Scala 3-style typeclass system:
 * @typeclass, @instance, @derive, summon(), extend(), and
 * extension method resolution.
 *
 * NOTE: This showcase uses decorators on interfaces and compile-time
 * macro transformations. It requires the typesugar transformer and
 * CANNOT be run with plain tsx/ts-node/esbuild.
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
  typeclass,
  instance,
  derive,
  summon,
  extend,
  implicit,
  // clearRegistries — not used in showcase, available for test isolation
} from "@typesugar/typeclass";

// ============================================================================
// 1. DEFINING TYPECLASSES — @typeclass decorator
// ============================================================================

// A typeclass declares an interface that types can implement.
// The @typeclass decorator registers it in the compile-time registry
// and makes its methods available as extension methods.

@typeclass
interface Show<A> {
  show(a: A): string;
}

@typeclass
interface Eq<A> {
  equals(a: A, b: A): boolean;
}

@typeclass
interface Ord<A> {
  compare(a: A, b: A): -1 | 0 | 1;
}

@typeclass
interface Semigroup<A> {
  combine(a: A, b: A): A;
}

@typeclass
interface Monoid<A> {
  empty(): A;
  combine(a: A, b: A): A;
}

// Type-level: the interface shape is preserved
typeAssert<Extends<Show<number>, { show(a: number): string }>>();
typeAssert<Extends<Eq<string>, { equals(a: string, b: string): boolean }>>();

// ============================================================================
// 2. PROVIDING INSTANCES — @instance decorator
// ============================================================================

// An instance binds a typeclass to a concrete type.
// After this, summon<Show<number>>() and extend(42).show() both resolve.

@instance(Show, Number)
const numberShow: Show<number> = {
  show: (n) => n.toString(),
};

@instance(Show, String)
const stringShow: Show<string> = {
  show: (s) => `"${s}"`,
};

@instance(Eq, Number)
const numberEq: Eq<number> = {
  equals: (a, b) => a === b,
};

@instance(Eq, String)
const stringEq: Eq<string> = {
  equals: (a, b) => a === b,
};

@instance(Ord, Number)
const numberOrd: Ord<number> = {
  compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0),
};

@instance(Semigroup, String)
const stringSemigroup: Semigroup<string> = {
  combine: (a, b) => a + b,
};

@instance(Monoid, String)
const stringMonoid: Monoid<string> = {
  empty: () => "",
  combine: (a, b) => a + b,
};

// Instances work as plain objects at runtime
assert(numberShow.show(42) === "42");
assert(stringShow.show("hello") === '"hello"');
assert(numberEq.equals(1, 1) === true);
assert(numberEq.equals(1, 2) === false);
assert(numberOrd.compare(3, 5) === -1);
assert(numberOrd.compare(5, 5) === 0);
assert(numberOrd.compare(7, 5) === 1);
assert(stringSemigroup.combine("hello", " world") === "hello world");
assert(stringMonoid.empty() === "");

// ============================================================================
// 3. SUMMONING INSTANCES — summon<TC<T>>()
// ============================================================================

// summon<T>() resolves instances at compile time (Scala 3's summon).
// The transformer replaces it with the registered instance expression.

const showN = summon<Show<number>>();
assert(showN.show(100) === "100");

const eqN = summon<Eq<number>>();
assert(eqN.equals(42, 42) === true);
assert(eqN.equals(42, 43) === false);

const ordN = summon<Ord<number>>();
assert(ordN.compare(1, 2) === -1);

// summon is the bridge between generic code and concrete instances:
function showAll<A>(items: A[], S: Show<A>): string {
  return "[" + items.map((item) => S.show(item)).join(", ") + "]";
}
assert(showAll([1, 2, 3], summon<Show<number>>()) === "[1, 2, 3]");
assert(showAll(["a", "b"], summon<Show<string>>()) === '["a", "b"]');

// ============================================================================
// 4. EXTENSION METHODS — extend() wrapper
// ============================================================================

// extend(value) creates an object with all typeclass methods
// available for that value's type. The transformer resolves which
// instances apply.

const ext42 = extend(42);
assert(ext42.show() === "42");

const extStr = extend("world");
assert(extStr.show() === '"world"');

// extend() makes typeclass methods feel like built-in methods.
// At compile time, extend(42).show() is rewritten to numberShow.show(42)
// — zero-cost, no wrapper allocation.

// ============================================================================
// 5. AUTO-DERIVATION — @deriving decorator
// ============================================================================

// @derive generates instances automatically from the type's structure.
// For product types, it generates field-by-field comparisons.

@derive(Show, Eq)
interface Point {
  x: number;
  y: number;
}

const p1: Point = { x: 1, y: 2 };
const p2: Point = { x: 1, y: 2 };
const p3: Point = { x: 3, y: 4 };

// Derived Show serializes via JSON
assert(extend(p1).show() !== "");

// Derived Eq compares field-by-field
assert(extend(p1).equals(p2) === true);
assert(extend(p1).equals(p3) === false);

@derive(Show, Eq, Ord)
interface Version {
  major: number;
  minor: number;
  patch: number;
}

// Derived Ord gives lexicographic comparison
const v1: Version = { major: 1, minor: 2, patch: 0 };
const v2: Version = { major: 1, minor: 3, patch: 0 };
const ordV = summon<Ord<Version>>();
assert(ordV.compare(v1, v2) === -1);

// ============================================================================
// 6. GENERIC PROGRAMMING — typeclass-polymorphic functions
// ============================================================================

// With typeclasses, you write generic algorithms once and they work
// for any type with the required instances.

function maximum<A>(items: A[], ord: Ord<A>): A {
  return items.reduce((a, b) => (ord.compare(a, b) >= 0 ? a : b));
}

assert(maximum([3, 1, 4, 1, 5, 9], summon<Ord<number>>()) === 9);

function sortWith<A>(items: A[], ord: Ord<A>): A[] {
  return items.slice().sort((a, b) => ord.compare(a, b));
}

const sorted = sortWith([3, 1, 4, 1, 5], numberOrd);
assert(sorted[0] === 1 && sorted[4] === 5);

function concatAll<A>(items: A[], M: Monoid<A>): A {
  return items.reduce((acc, x) => M.combine(acc, x), M.empty());
}

assert(concatAll(["hello", " ", "world"], stringMonoid) === "hello world");

// ============================================================================
// 7. REGISTRY INTROSPECTION — inspecting registered typeclasses/instances
// ============================================================================

// Typeclass definitions are discovered per-program by the op-index (PEP-052) — no
// global reflection registry.

// ============================================================================
// 8. REAL-WORLD EXAMPLE — Config system with typeclasses
// ============================================================================

// A real-world pattern: define domain types, derive instances, use generically.

interface Config {
  host: string;
  port: number;
  debug: boolean;
}

@instance(Show, Config)
const configShow: Show<Config> = {
  show: (c) => `${c.host}:${c.port}${c.debug ? " [DEBUG]" : ""}`,
};

@instance(Eq, Config)
const configEq: Eq<Config> = {
  equals: (a, b) => a.host === b.host && a.port === b.port && a.debug === b.debug,
};

const dev: Config = { host: "localhost", port: 3000, debug: true };
const prod: Config = { host: "api.example.com", port: 443, debug: false };
const devCopy: Config = { host: "localhost", port: 3000, debug: true };

assert(configShow.show(dev) === "localhost:3000 [DEBUG]");
assert(configShow.show(prod) === "api.example.com:443");
assert(configEq.equals(dev, devCopy) === true);
assert(configEq.equals(dev, prod) === false);

// Use in generic context
function logIfChanged<A>(old: A, new_: A, eq: Eq<A>, show: Show<A>): string | null {
  if (eq.equals(old, new_)) return null;
  return `Changed: ${show.show(old)} → ${show.show(new_)}`;
}

const msg = logIfChanged(dev, prod, configEq, configShow);
assert(msg !== null);
assert(msg!.includes("localhost"));
assert(msg!.includes("api.example.com"));

const noChange = logIfChanged(dev, devCopy, configEq, configShow);
assert(noChange === null);

// Reuse sortWith from section 6
function maxWith<A>(items: A[], ord: Ord<A>): A {
  return items.reduce((a, b) => (ord.compare(a, b) >= 0 ? a : b));
}

function sortAndShowItems<A>(items: A[], ord: Ord<A>, show: Show<A>): string {
  const sortedItems = [...items].sort((a, b) => ord.compare(a, b));
  return sortedItems.map((item) => show.show(item)).join(", ");
}

// ============================================================================
// 11. AUTO-SPECIALIZATION — zero-cost calls with registered instances
// ============================================================================

// Specialization is an always-on compiler optimization (PEP-053) — there is
// no macro or extension method to call for it. When you call a function with
// a known typeclass instance as an argument, the transformer automatically
// specializes the call site: the dictionary is eliminated and its methods
// inlined directly.
//
// At compile time:
//   sortWith([1, 2, 3], numberOrd)
// Becomes (if numberOrd is a known instance):
//   [1, 2, 3].slice().sort((a, b) => a < b ? -1 : a > b ? 1 : 0)

// These calls are auto-specialized because numberOrd is a known instance
const autoSpec1 = sortWith([5, 3, 7], numberOrd);
assert(autoSpec1[0] === 3);

const autoSpec2 = maxWith([5, 3, 7], numberOrd);
assert(autoSpec2 === 7);

// Functions with multiple typeclass constraints auto-specialize with all
// dictionaries at once — no special multi-dictionary syntax needed.
const autoSpec3 = sortAndShowItems([3, 1, 2], numberOrd, numberShow);
assert(autoSpec3 === "1, 2, 3");

// The transformer hoists the specialized function and reuses it for identical
// call patterns, ensuring zero runtime overhead.

// ============================================================================
// 12. COMPARING RESOLUTION APPROACHES
// ============================================================================

// There are multiple ways to get a typeclass instance to a generic function:
//
// 1. Pass a known instance directly — auto-specialized
//    sortWith([3, 1, 2], numberOrd)
//    → Dictionary inlined automatically (RECOMMENDED for most cases)
//
// 2. summon<TC<T>>() — Get instance for generic code
//    sortWith([3, 1, 2], summon<Ord<number>>())
//    → Compile-time resolution, explicit at call site

// Manual dictionary passing (auto-specialized)
const manualResult = sortWith([5, 3, 7], numberOrd);
assert(manualResult[0] === 3);

// Using summon for inline resolution
const summonResult = sortWith([5, 3, 7], summon<Ord<number>>());
assert(summonResult[0] === 3);

// ============================================================================
// 13. IMPLICIT PARAMETERS — = implicit() auto-fill
// ============================================================================

// The `= implicit()` default parameter pattern marks function parameters as
// implicit typeclass instances. At call sites, the transformer automatically
// fills in missing typeclass instance arguments — like Scala 3's `using` clauses.
//
// This provides the convenience of auto-resolution while keeping the
// function signature explicit for tooling and documentation.

function showItem<A>(item: A, S: Show<A> = implicit()): string {
  return S.show(item);
}

function compareItems<A>(a: A, b: A, O: Ord<A> = implicit()): -1 | 0 | 1 {
  return O.compare(a, b);
}

// Call without explicit instance — auto-filled from registry
const shown = showItem(42);
assert(shown === "42");

const cmp = compareItems(1, 2);
assert(cmp === -1);

// Explicit instance still works — overrides auto-fill
const customShown = showItem("hello", stringShow);
assert(customShown === '"hello"');

// = implicit() with multiple instances
function showSorted<A>(items: A[], O: Ord<A> = implicit(), S: Show<A> = implicit()): string {
  const sortedItems = [...items].sort((a, b) => O.compare(a, b));
  return sortedItems.map((item) => S.show(item)).join(", ");
}

const sortedDisplay = showSorted([3, 1, 2]);
assert(sortedDisplay === "1, 2, 3");

// ============================================================================
// 14. IMPLICIT PROPAGATION — nested = implicit() calls
// ============================================================================

// When inside a function with = implicit() parameters, resolved instances
// automatically propagate to nested calls that also use = implicit().
// This enables implicit chaining without manual threading.

function outer<A>(item: A, S: Show<A> = implicit()): string {
  // showItem also uses = implicit() — S is automatically passed!
  return `Outer: ${showItem(item)}`;
}

// The Show<number> instance is resolved once and flows through
const nested = outer(100);
assert(nested === "Outer: 100");

// Custom instance flows through too
@instance(Show, Boolean)
const booleanShow: Show<boolean> = {
  show: (b) => (b ? "yes" : "no"),
};

const nestedBool = outer(true);
assert(nestedBool === "Outer: yes");

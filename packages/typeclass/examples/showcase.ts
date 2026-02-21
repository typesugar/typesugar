/**
 * @typesugar/typeclass Showcase
 *
 * Self-documenting examples of the Scala 3-style typeclass system:
 * @typeclass, @instance, @deriving, summon(), extend(), and
 * extension method resolution.
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
  deriving,
  summon,
  extend,
  type TypeclassInfo,
  type InstanceInfo,
  findExtensionMethod,
  getTypeclasses,
  getInstances,
  clearRegistries,
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

// @deriving generates instances automatically from the type's structure.
// For product types, it generates field-by-field comparisons.

@deriving(Show, Eq)
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

@deriving(Show, Eq, Ord)
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

// The compile-time registries are available for tooling and reflection.

const typeclasses = getTypeclasses();
assert(typeclasses.has("Show"));
assert(typeclasses.has("Eq"));
assert(typeclasses.has("Ord"));

const showInfo = typeclasses.get("Show")!;
typeAssert<Extends<typeof showInfo, TypeclassInfo>>();
assert(showInfo.name === "Show");
assert(showInfo.methods.length > 0);
assert(showInfo.methods[0].name === "show");

const instances = getInstances();
assert(instances.size > 0);

// findExtensionMethod resolves which instance provides a method for a type
const found = findExtensionMethod("number", "show");
assert(found !== undefined);
assert(found!.typeclass.name === "Show");

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

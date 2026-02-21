/**
 * @typesugar/hlist Showcase
 *
 * Self-documenting examples of heterogeneous lists with compile-time type
 * tracking. Inspired by Boost.Fusion/Hana and Shapeless — every element's
 * type is tracked individually while the runtime representation is a plain array.
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
  // Construction
  hlist, hnil, labeled, fromArray,

  // Element access
  head, tail, last, init, at, length,

  // Structural operations
  append, prepend, concat, reverse, zip, splitAt,

  // Labeled operations
  get, set, labels, project, merge,

  // Higher-order operations
  map, foldLeft, forEach, toArray,

  // Types
  type HList, type HNil, type Head, type Tail, type Last, type Reverse,
  type Concat, type Zip, type At, type Length,
} from "../src/index.js";

// ============================================================================
// 1. CONSTRUCTION — Creating Typed Heterogeneous Lists
// ============================================================================

// Each element type is tracked individually — not collapsed to a union
const mixed = hlist(42, "hello", true);
typeAssert<Equal<typeof mixed, HList<[number, string, boolean]>>>();

// Empty HList
const empty = hnil();
typeAssert<Equal<typeof empty, HNil>>();

// From a const tuple
const fromTuple = fromArray([1, "a", true] as const);

// The runtime representation is just an array
assert(length(mixed) === 3);
assert(length(empty) === 0);

// ============================================================================
// 2. ELEMENT ACCESS — Type-Safe Positional Indexing
// ============================================================================

const list = hlist(10, "world", false, 3.14);

// head/tail decomposition — types narrow correctly
const h = head(list);
typeAssert<Equal<typeof h, number>>();
assert(h === 10);

const t = tail(list);
typeAssert<Equal<typeof t, HList<[string, boolean, number]>>>();
assert(head(t) === "world");

// last/init — mirror of head/tail
const l = last(list);
typeAssert<Equal<typeof l, number>>();
assert(l === 3.14);

const i = init(list);
assert(length(i) === 3);

// Positional access with at()
const second = at(list, 1);
typeAssert<Equal<typeof second, string>>();
assert(second === "world");

const third = at(list, 2);
typeAssert<Equal<typeof third, boolean>>();
assert(third === false);

// ============================================================================
// 3. STRUCTURAL OPERATIONS — Append, Prepend, Concat, Reverse
// ============================================================================

const base = hlist(1, "a");

// append adds to the end with correct type tracking
const appended = append(base, true);
typeAssert<Equal<typeof appended, HList<[number, string, boolean]>>>();
assert(length(appended) === 3);
assert(at(appended, 2) === true);

// prepend adds to the front
const prepended = prepend(99, base);
typeAssert<Equal<typeof prepended, HList<[number, number, string]>>>();
assert(head(prepended) === 99);

// concat joins two HLists
const left = hlist(1, 2);
const right = hlist("a", "b");
const joined = concat(left, right);
typeAssert<Equal<typeof joined, HList<[number, number, string, string]>>>();
assert(length(joined) === 4);
assert(at(joined, 2) === "a");

// reverse flips element order while tracking types
const rev = reverse(hlist(1, "two", true));
typeAssert<Equal<typeof rev, HList<Reverse<[number, string, boolean]>>>>();
assert(toArray(rev)[0] === true);
assert(toArray(rev)[2] === 1);

// ============================================================================
// 4. ZIP & SPLIT — Combining and Decomposing
// ============================================================================

const names = hlist("Alice", "Bob");
const ages = hlist(30, 25);

// zip pairs elements positionally
const zipped = zip(names, ages);
assert(length(zipped) === 2);
const first = at(zipped, 0) as [string, number];
assert(first[0] === "Alice" && first[1] === 30);

// splitAt decomposes at an index
const [before, after] = splitAt(hlist(1, "two", true, 4), 2);
assert(length(before) === 2);
assert(length(after) === 2);
assert(head(after) === true);

// ============================================================================
// 5. LABELED HLIST — Record-Like Typed Field Access
// ============================================================================

// labeled() creates a record-like HList where fields have string keys
const point = labeled({ x: 10, y: 20, z: 30 });

// Type-safe field access by name
const xVal = get(point, "x");
assert(xVal === 10, "get retrieves field by name");

const zVal = get(point, "z");
assert(zVal === 30);

// labels() returns field names
const fieldNames = labels(point);
assert(fieldNames.length === 3);
assert(fieldNames.includes("x") && fieldNames.includes("y") && fieldNames.includes("z"));

// set() returns a new LabeledHList with one field updated (immutable)
const moved = set(point, "x", 99);
assert(get(moved, "x") === 99, "set creates updated copy");
assert(get(point, "x") === 10, "original is unchanged");

// ============================================================================
// 6. LABELED PROJECTION & MERGE — Selecting and Combining Fields
// ============================================================================

// project selects a subset of fields
const config = labeled({ host: "localhost", port: 8080, debug: true, timeout: 5000 });
const networkOnly = project(config, "host", "port");
assert(get(networkOnly, "host") === "localhost");
assert(get(networkOnly, "port") === 8080);

// merge combines two labeled HLists
const defaults = labeled({ color: "blue" });
const overrides = labeled({ size: 14 });
const merged = merge(defaults, overrides);
assert(get(merged, "color") === "blue");
assert(get(merged, "size") === 14);

// Real-world: config composition
const baseConfig = labeled({ env: "production", logLevel: "info" });
const dbConfig = labeled({ dbHost: "db.example.com", dbPort: 5432 });
const fullConfig = merge(baseConfig, dbConfig);
assert(get(fullConfig, "env") === "production");
assert(get(fullConfig, "dbPort") === 5432);

// ============================================================================
// 7. HIGHER-ORDER OPERATIONS — Map, Fold, ForEach
// ============================================================================

// map applies a function to each element
const nums = hlist(1, 2, 3);
const strs = map(nums, (elem) => String(elem));
assert(toArray(strs).join(",") === "1,2,3");

// foldLeft accumulates over the heterogeneous list
const sizes = hlist("hello", [1, 2, 3], "ab");
const totalLength = foldLeft(sizes, 0, (acc, elem) => {
  if (typeof elem === "string") return acc + elem.length;
  if (Array.isArray(elem)) return acc + elem.length;
  return acc;
});
assert(totalLength === 10, "foldLeft works across different element types");

// forEach for side effects
const collected: string[] = [];
forEach(hlist(1, "two", true), (elem) => {
  collected.push(String(elem));
});
assert(collected.join(",") === "1,two,true");

// toArray extracts the underlying tuple
const arr = toArray(hlist(10, "x", false));
assert(arr.length === 3);
assert(arr[0] === 10 && arr[1] === "x" && arr[2] === false);

// ============================================================================
// 8. REAL-WORLD EXAMPLE — Type-Safe Configuration Builder
// ============================================================================

// HLists shine for building configuration objects where each field has a
// distinct type and you want compile-time guarantees about the shape.
function buildServerConfig() {
  const base = labeled({ host: "0.0.0.0", port: 3000 });
  const tls = labeled({ certPath: "/etc/ssl/cert.pem", keyPath: "/etc/ssl/key.pem" });
  const combined = merge(base, tls);

  assert(get(combined, "host") === "0.0.0.0");
  assert(get(combined, "port") === 3000);
  assert(get(combined, "certPath") === "/etc/ssl/cert.pem");

  // Update a field immutably
  const withCustomPort = set(combined, "port", 8443);
  assert(get(withCustomPort, "port") === 8443);
  assert(get(combined, "port") === 3000, "original unchanged");

  return withCustomPort;
}

const serverConfig = buildServerConfig();
assert(get(serverConfig, "port") === 8443);

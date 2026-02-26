/**
 * @typesugar/fusion Showcase
 *
 * Self-documenting examples of single-pass lazy iterator pipelines and
 * element-wise vector operations. Inspired by Blitz++ expression templates —
 * chains like .filter().map().reduce() execute in one pass with no
 * intermediate arrays.
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

import { assert, typeAssert, type Equal } from "@typesugar/testing";

import {
  // Lazy pipeline
  lazy, range, iterate, repeat, generate,

  // Vector operations
  vec, add, sub, mul, scale, dot,
  magnitude, normalize, mapVec, zipVec, toArray,

  type FusedVec,
} from "../src/index.js";

// ============================================================================
// 1. LAZY PIPELINES — Single-Pass, No Intermediate Arrays
// ============================================================================

// lazy() wraps any iterable. Operations are deferred until a terminal is called.
const result = lazy([1, 2, 3, 4, 5])
  .filter(x => x % 2 === 0)
  .map(x => x * 10)
  .toArray();

assert(result.length === 2);
assert(result[0] === 20 && result[1] === 40, "filter + map in single pass");

// Compare with native: Array.filter().map() creates an intermediate array.
// lazy() fuses the operations — each element goes through filter AND map
// before the next element is even looked at.

// Chaining many operations still produces a single-pass traversal
const complex = lazy([10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
  .filter(x => x > 25)
  .map(x => x / 10)
  .filter(x => x % 2 === 0)
  .map(x => `val:${x}`)
  .toArray();

assert(complex[0] === "val:4");
assert(complex[1] === "val:6");
assert(complex[2] === "val:8");
assert(complex[3] === "val:10");

// ============================================================================
// 2. RANGE & GENERATORS — Creating Lazy Sources
// ============================================================================

// range(start, end) generates numbers lazily
const r = range(1, 6).toArray();
assert(r.length === 5);
assert(r[0] === 1 && r[4] === 5, "range is [start, end)");

// range with step
const evens = range(0, 20, 2).toArray();
assert(evens.length === 10);
assert(evens[0] === 0 && evens[9] === 18);

// iterate: repeatedly apply a function to a seed
const powers = iterate(1, x => x * 2)
  .take(8)
  .toArray();
assert(powers.join(",") === "1,2,4,8,16,32,64,128", "iterate generates powers of 2");

// repeat: infinite stream of a single value
const fives = repeat(5).take(4).toArray();
assert(fives.join(",") === "5,5,5,5");

// generate: infinite stream from a factory function
let counter = 0;
const ids = generate(() => ++counter).take(3).toArray();
assert(ids.join(",") === "1,2,3");

// ============================================================================
// 3. TERMINAL OPERATIONS — Reducing, Finding, Aggregating
// ============================================================================

const data = lazy([3, 1, 4, 1, 5, 9, 2, 6]);

// reduce (fold)
const sum = data.reduce((acc, x) => acc + x, 0);
assert(sum === 31, "reduce accumulates all values");

// sum (numeric shortcut)
const numSum = lazy([1, 2, 3, 4, 5]).sum();
assert(numSum === 15);

// find
const firstBig = lazy([3, 1, 4, 1, 5, 9]).find(x => x > 4);
assert(firstBig === 5, "find returns first match");

const notFound = lazy([1, 2, 3]).find(x => x > 100);
assert(notFound === null, "find returns null when not found");

// some / every
assert(lazy([1, 2, 3]).some(x => x === 2), "some: at least one matches");
assert(!lazy([1, 2, 3]).some(x => x === 99), "some: none match");
assert(lazy([2, 4, 6]).every(x => x % 2 === 0), "every: all match");
assert(!lazy([2, 4, 5]).every(x => x % 2 === 0), "every: not all match");

// count
assert(lazy([1, 2, 3, 4, 5]).filter(x => x > 3).count() === 2);

// first / last
assert(lazy([10, 20, 30]).first() === 10);
assert(lazy([10, 20, 30]).last() === 30);

// min / max
assert(lazy([3, 1, 4, 1, 5]).min() === 1);
assert(lazy([3, 1, 4, 1, 5]).max() === 5);

// ============================================================================
// 4. EARLY TERMINATION — Take, Drop, TakeWhile, DropWhile
// ============================================================================

// take stops after N elements — crucial for infinite sources
const firstSquares = range(1, Infinity)
  .map(x => x * x)
  .take(5)
  .toArray();
assert(firstSquares.join(",") === "1,4,9,16,25", "take enables infinite pipelines");

// drop skips the first N
const afterSkip = range(1, 11).drop(3).toArray();
assert(afterSkip[0] === 4 && afterSkip.length === 7);

// takeWhile stops at first predicate failure
const ascending = lazy([1, 3, 5, 2, 4, 6])
  .takeWhile(x => x < 5)
  .toArray();
assert(ascending.join(",") === "1,3", "takeWhile stops before first failure");

// dropWhile skips until predicate fails, then emits rest
const afterDrop = lazy([1, 3, 5, 2, 4, 6])
  .dropWhile(x => x < 5)
  .toArray();
assert(afterDrop.join(",") === "5,2,4,6");

// ============================================================================
// 5. FLATMAP — Expanding Elements
// ============================================================================

// flatMap maps each element to an iterable and flattens
const expanded = lazy(["hello", "world"])
  .flatMap(word => word.split(""))
  .toArray();
assert(expanded.length === 10, "flatMap expands and flattens");
assert(expanded.join("") === "helloworld");

// Cartesian product via flatMap
const pairs = lazy([1, 2])
  .flatMap(a => [a * 10, a * 100])
  .toArray();
assert(pairs.join(",") === "10,100,20,200");

// ============================================================================
// 6. GROUPING & COLLECTION — GroupBy, ToMap
// ============================================================================

// groupBy partitions elements by a key function
const words = lazy(["ant", "bee", "ape", "bat", "arc"]);
const byFirstLetter = words.groupBy(w => w[0]);
assert(byFirstLetter.get("a")!.length === 3, "3 words starting with 'a'");
assert(byFirstLetter.get("b")!.length === 2, "2 words starting with 'b'");

// toMap builds a Map from key/value extractors
const users = lazy([
  { id: 1, name: "Alice" },
  { id: 2, name: "Bob" },
]);
const byId = users.toMap(u => u.id, u => u.name);
assert(byId.get(1) === "Alice");
assert(byId.get(2) === "Bob");

// ============================================================================
// 7. VEC OPERATIONS — Element-Wise Vector Arithmetic
// ============================================================================

const a = vec([1, 2, 3]);
const b = vec([4, 5, 6]);

typeAssert<Equal<typeof a, FusedVec<number>>>();

// Element-wise add, sub, mul, div
const added = add(a, b);
assert(toArray(added).join(",") === "5,7,9", "element-wise addition");

const subtracted = sub(b, a);
assert(toArray(subtracted).join(",") === "3,3,3");

const multiplied = mul(a, b);
assert(toArray(multiplied).join(",") === "4,10,18");

// scale: multiply every element by a scalar
const scaled = scale(a, 10);
assert(toArray(scaled).join(",") === "10,20,30");

// ============================================================================
// 8. VEC PRODUCTS & NORMS — Dot Product, Magnitude, Normalize
// ============================================================================

// dot product: sum of element-wise products
const d = dot(a, b);
assert(d === 1 * 4 + 2 * 5 + 3 * 6, "dot product = 32");
assert(d === 32);

// magnitude: Euclidean norm
const v = vec([3, 4]);
assert(magnitude(v) === 5, "3-4-5 triangle magnitude = 5");

// normalize: scale to unit length
const unit = normalize(v);
const unitArr = toArray(unit);
assert(Math.abs(unitArr[0] - 0.6) < 1e-10, "normalized x = 0.6");
assert(Math.abs(unitArr[1] - 0.8) < 1e-10, "normalized y = 0.8");
assert(Math.abs(magnitude(unit) - 1.0) < 1e-10, "unit vector has magnitude 1");

// ============================================================================
// 9. VEC HIGHER-ORDER — MapVec, ZipVec
// ============================================================================

// mapVec applies a function to each element
const squares2 = mapVec(a, x => x * x);
assert(toArray(squares2).join(",") === "1,4,9");

// zipVec combines two vectors with a binary function
const combined = zipVec(a, b, (x, y) => x + y);
assert(toArray(combined).join(",") === "5,7,9", "zipVec = element-wise combine");

// ============================================================================
// 10. REAL-WORLD EXAMPLE — Data Processing Pipeline
// ============================================================================

// Processing a stream of sales records in a single pass
interface Sale { product: string; amount: number; region: string }

const sales: Sale[] = [
  { product: "Widget", amount: 100, region: "East" },
  { product: "Gadget", amount: 250, region: "West" },
  { product: "Widget", amount: 150, region: "West" },
  { product: "Gizmo", amount: 50, region: "East" },
  { product: "Gadget", amount: 300, region: "East" },
  { product: "Widget", amount: 200, region: "East" },
];

// Total revenue from East region widgets — single pass, no intermediate arrays
const eastWidgetRevenue = lazy(sales)
  .filter(s => s.region === "East")
  .filter(s => s.product === "Widget")
  .map(s => s.amount)
  .reduce((sum, amt) => sum + amt, 0);

assert(eastWidgetRevenue === 300, "100 + 200 = 300 from East Widget sales");

// Top 3 amounts across all regions
const top3 = lazy(sales)
  .map(s => s.amount)
  .toArray()
  .sort((a, b) => b - a)
  .slice(0, 3);

assert(top3[0] === 300 && top3[1] === 250 && top3[2] === 200);

// Revenue by region using groupBy
const byRegion = lazy(sales).groupBy(s => s.region);
const eastTotal = byRegion.get("East")!.reduce((sum, s) => sum + s.amount, 0);
assert(eastTotal === 650, "East: Widget(100) + Gizmo(50) + Gadget(300) + Widget(200)");

const westTotal = byRegion.get("West")!.reduce((sum, s) => sum + s.amount, 0);
assert(westTotal === 400, "West: Gadget(250) + Widget(150)");

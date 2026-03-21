/**
 * @typesugar/erased Showcase
 *
 * Self-documenting examples of typeclass-based type erasure for heterogeneous
 * collections. Inspired by Rust's `dyn Trait` and Boost.TypeErasure — wrap
 * values of different concrete types into a uniform Erased representation
 * with vtable dispatch.
 *
 * Type assertions used:
 *   typeAssert<Equal<A, B>>()  - A and B are the same type
 *
 * Run:   typesugar run examples/showcase.ts
 * Build: npx tspc && node dist/examples/showcase.js
 */

import { assert, typeAssert, type Equal } from "@typesugar/testing";

import {
  // Construction
  eraseWith, showable, showableEq,
  unwrapErased, callMethod,

  // Convenience dispatch
  show, equals, hash, clone, debug,

  // Collection utilities
  mapErased, filterErased, showAll, sortErased, dedup, groupByHash,

  // Widen / narrow
  widen, narrow, extendCapabilities, hasCapability,

  // Types
  type Erased, type WithShow,
  type ShowCapability, type EqCapability, type OrdCapability, type HashCapability,
} from "../src/index.js";

// ============================================================================
// 1. ERASED VALUES — Wrapping Concrete Types with Vtables
// ============================================================================

// showable() creates an Erased value with Show capability
const erasedNum = showable(42, v => `Num(${v})`);
const erasedStr = showable("hello", v => `Str("${v}")`);

// show() dispatches through the vtable
assert(show(erasedNum) === "Num(42)");
assert(show(erasedStr) === 'Str("hello")');

// The concrete type is forgotten — both are Erased<[ShowCapability]>
typeAssert<Equal<typeof erasedNum, Erased<[ShowCapability]>>>();
typeAssert<Equal<typeof erasedStr, Erased<[ShowCapability]>>>();

// unwrapErased recovers the original value (unsafe — caller must know the type)
const recovered: number = unwrapErased(erasedNum);
assert(recovered === 42);

// ============================================================================
// 2. MULTIPLE CAPABILITIES — Show + Eq, Full Vtables
// ============================================================================

// showableEq creates a value with both Show and Eq capabilities
const p1 = showableEq(
  { x: 1, y: 2 },
  p => `Point(${p.x}, ${p.y})`,
  (a, b) => a.x === b.x && a.y === b.y
);
const p2 = showableEq(
  { x: 1, y: 2 },
  p => `Point(${p.x}, ${p.y})`,
  (a, b) => a.x === b.x && a.y === b.y
);
const p3 = showableEq(
  { x: 3, y: 4 },
  p => `Point(${p.x}, ${p.y})`,
  (a, b) => a.x === b.x && a.y === b.y
);

assert(show(p1) === "Point(1, 2)");
assert(equals(p1, p2), "Same coordinates are equal");
assert(!equals(p1, p3), "Different coordinates are not equal");

// eraseWith for full control over the vtable
const fullErased = eraseWith(100, {
  show: (v: unknown) => `Value(${v})`,
  equals: (a: unknown, b: unknown) => a === b,
  compare: (a: unknown, b: unknown) => (a as number) - (b as number),
  hash: (v: unknown) => (v as number) % 1000,
  clone: (v: unknown) => v,
  debug: (v: unknown) => `[Debug: ${v}]`,
});

assert(show(fullErased) === "Value(100)");
assert(hash(fullErased) === 100);
assert(debug(fullErased) === "[Debug: 100]");

// ============================================================================
// 3. VTABLE DISPATCH — callMethod for Dynamic Invocation
// ============================================================================

// callMethod allows calling any vtable method by name
const result = callMethod(fullErased, "show", 100);
assert(result === "Value(100)");

// Throws on missing methods
let threw = false;
try {
  callMethod(erasedNum, "nonexistent");
} catch (e) {
  threw = true;
  assert(e instanceof Error);
}
assert(threw, "callMethod throws on missing vtable method");

// ============================================================================
// 4. HETEROGENEOUS COLLECTIONS — Different Types, Same Interface
// ============================================================================

// The core value proposition: store different types in one collection
const items: WithShow[] = [
  showable(42, v => `${v}`),
  showable("hello", v => `"${v}"`),
  showable(true, v => `${v}`),
  showable([1, 2, 3], v => `[${v.join(", ")}]`),
];

// showAll dispatches show() on each element
const shown = showAll(items);
assert(shown[0] === "42");
assert(shown[1] === '"hello"');
assert(shown[2] === "true");
assert(shown[3] === "[1, 2, 3]");

// mapErased applies a function to each erased element
const lengths = mapErased(items, e => show(e).length);
assert(lengths[0] === 2);   // "42"
assert(lengths[1] === 7);   // '"hello"'

// filterErased keeps elements matching a predicate
const shortShown = filterErased(items, e => show(e).length <= 4);
assert(shortShown.length === 2);

// ============================================================================
// 5. SORTING & DEDUPLICATION — Ord, Eq, Hash on Erased Values
// ============================================================================

// Create orderable erased values
function ordNum(n: number) {
  return eraseWith(n, {
    show: (v: unknown) => `${v}`,
    equals: (a: unknown, b: unknown) => a === b,
    compare: (a: unknown, b: unknown) => (a as number) - (b as number),
    hash: (v: unknown) => v as number,
  });
}

const unsorted = [ordNum(3), ordNum(1), ordNum(4), ordNum(1), ordNum(5)];

// sortErased uses the Ord capability's compare method
const sorted = sortErased(unsorted);
assert(show(sorted[0]) === "1");
assert(show(sorted[1]) === "1");
assert(show(sorted[2]) === "3");
assert(show(sorted[3]) === "4");
assert(show(sorted[4]) === "5");

// dedup removes consecutive duplicates using Eq
const deduped = dedup(sorted);
assert(deduped.length === 4, "Consecutive duplicate removed");
assert(show(deduped[0]) === "1");
assert(show(deduped[1]) === "3");

// groupByHash buckets elements by hash code
const grouped = groupByHash(unsorted);
const bucket1 = grouped.get(1);
assert(bucket1 !== undefined && bucket1.length === 2, "Hash 1 has two elements");

// ============================================================================
// 6. CLONE — Deep Copying Erased Values
// ============================================================================

const cloneable = eraseWith({ data: [1, 2, 3] }, {
  show: (v: unknown) => JSON.stringify(v),
  clone: (v: unknown) => {
    const obj = v as { data: number[] };
    return { data: [...obj.data] };
  },
});

const cloned = clone(cloneable);
assert(show(cloned) === show(cloneable), "Cloned value shows the same");

// Verify deep copy: modifying clone doesn't affect original
const clonedInner: { data: number[] } = unwrapErased(cloned);
clonedInner.data.push(4);
assert(show(cloneable) === '{"data":[1,2,3]}', "Original unchanged after clone modification");

// ============================================================================
// 7. CAPABILITY WIDENING — Forgetting Capabilities (Zero-Cost)
// ============================================================================

// widen drops capabilities at the type level. Zero-cost — identity at runtime.
const full = eraseWith("test", {
  show: (v: unknown) => `${v}`,
  equals: (a: unknown, b: unknown) => a === b,
  compare: (a: unknown, b: unknown) => String(a).localeCompare(String(b)),
});

// Widen to only Show — we can still show(), but not compare()
const showOnly = widen<
  [ShowCapability, EqCapability, OrdCapability],
  [ShowCapability]
>(full);

assert(show(showOnly) === "test", "Widened value retains Show capability");
typeAssert<Equal<typeof showOnly, Erased<[ShowCapability]>>>();

// ============================================================================
// 8. CAPABILITY NARROWING — Adding Capabilities (Runtime Check)
// ============================================================================

// narrow checks if the vtable has the required methods at runtime
const maybeOrd = narrow<[ShowCapability], [ShowCapability, OrdCapability]>(
  showOnly,
  ["compare"]
);
assert(maybeOrd !== null, "Narrow succeeds when vtable has the method");

// narrow returns null if the capability is missing
const noHash = narrow<[ShowCapability], [ShowCapability, HashCapability]>(
  showable(42, v => `${v}`),
  ["hash"]
);
assert(noHash === null, "Narrow fails when vtable lacks the method");

// extendCapabilities adds new vtable methods
const extended = extendCapabilities<
  [ShowCapability],
  [ShowCapability, HashCapability]
>(
  showable(42, v => `${v}`),
  { hash: (v: unknown) => (v as number) % 100 }
);
assert(hash(extended) === 42, "Extended value gains new capability");

// hasCapability probes for a method without committing to narrowing
assert(hasCapability(full, "show"), "full has show");
assert(hasCapability(full, "compare"), "full has compare");
assert(!hasCapability(showable(1, String), "compare"), "showable lacks compare");

// ============================================================================
// 9. REAL-WORLD EXAMPLE — Plugin System with Capabilities
// ============================================================================

// Imagine a plugin system where plugins have different capabilities.
// Some can render, some can serialize, some can do both.

interface Plugin { name: string; version: string }

function makePlugin(plugin: Plugin, capabilities: {
  render?: (p: Plugin) => string;
  serialize?: (p: Plugin) => string;
}) {
  const vtable: Record<string, Function> = {
    show: (v: unknown) => {
      const p = v as Plugin;
      return `${p.name}@${p.version}`;
    },
  };
  if (capabilities.render) {
    vtable["render"] = (v: unknown) => capabilities.render!(v as Plugin);
  }
  if (capabilities.serialize) {
    vtable["serialize"] = (v: unknown) => capabilities.serialize!(v as Plugin);
  }
  return eraseWith(plugin, vtable as any);
}

const pluginA = makePlugin(
  { name: "chart", version: "1.0" },
  { render: p => `<Chart v${p.version}/>`, serialize: p => JSON.stringify(p) }
);
const pluginB = makePlugin(
  { name: "logger", version: "2.1" },
  { serialize: p => JSON.stringify(p) }
);
const pluginC = makePlugin(
  { name: "theme", version: "0.5" },
  { render: p => `<Theme v${p.version}/>` }
);

const allPlugins = [pluginA, pluginB, pluginC];

// All plugins are showable
const names = allPlugins.map(p => show(p));
assert(names[0] === "chart@1.0");
assert(names[1] === "logger@2.1");
assert(names[2] === "theme@0.5");

// Filter to only renderable plugins
const renderable = allPlugins.filter(p => hasCapability(p, "render"));
assert(renderable.length === 2, "chart and theme can render");

// Filter to only serializable plugins
const serializable = allPlugins.filter(p => hasCapability(p, "serialize"));
assert(serializable.length === 2, "chart and logger can serialize");

// ============================================================================
// 10. REAL-WORLD EXAMPLE — Heterogeneous Event Log
// ============================================================================

// Different event types stored in one collection, all showable and equatable
type EventData =
  | { type: "click"; x: number; y: number }
  | { type: "keypress"; key: string }
  | { type: "scroll"; offset: number };

function eraseEvent(event: EventData) {
  return showableEq(
    event,
    e => {
      switch (e.type) {
        case "click": return `Click(${e.x}, ${e.y})`;
        case "keypress": return `Key("${e.key}")`;
        case "scroll": return `Scroll(${e.offset})`;
      }
    },
    (a, b) => JSON.stringify(a) === JSON.stringify(b)
  );
}

const events = [
  eraseEvent({ type: "click", x: 10, y: 20 }),
  eraseEvent({ type: "click", x: 10, y: 20 }),  // Consecutive duplicate
  eraseEvent({ type: "keypress", key: "Enter" }),
  eraseEvent({ type: "scroll", offset: 100 }),
  eraseEvent({ type: "keypress", key: "Enter" }),
];

const eventLog = showAll(events);
assert(eventLog[0] === "Click(10, 20)");
assert(eventLog[1] === "Click(10, 20)");  // Second click
assert(eventLog[2] === 'Key("Enter")');
assert(eventLog[3] === "Scroll(100)");

// dedup removes consecutive identical events
const dedupedEvents = dedup(events);
assert(dedupedEvents.length === 4, "Consecutive duplicate click removed");

// ============================================================================
// 11. AUTO-DERIVATION — @derive with erased() for Automatic Vtable Generation
// ============================================================================

// When using the typesugar transformer, the `erased()` macro can automatically
// resolve typeclass instances for the concrete type and build the vtable.
//
// Given a type with @derive annotations:
//
//   /** @derive Show, Eq, Clone */
//   interface Color { r: number; g: number; b: number }
//
// The transformer rewrites:
//
//   const erasedColor = erased<[ShowCapability, EqCapability, CloneCapability]>(myColor);
//
// Into the equivalent of:
//
//   const erasedColor = eraseWith(myColor, {
//     show:   (v) => Show_Color.show(v),
//     equals: (a, b) => Eq_Color.equals(a, b),
//     clone:  (v) => Clone_Color.clone(v),
//   });
//
// This means you get full vtable dispatch with zero manual wiring.

// Manual demonstration of what the transformer would produce for a Color type:
interface Color { r: number; g: number; b: number }

function showColor(c: Color): string {
  return `rgb(${c.r}, ${c.g}, ${c.b})`;
}
function eqColor(a: Color, b: Color): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b;
}
function cloneColor(c: Color): Color {
  return { r: c.r, g: c.g, b: c.b };
}

// This is what `erased<[Show, Eq, Clone]>(myColor)` expands to after transformation:
const erasedColor = eraseWith({ r: 255, g: 128, b: 0 } as Color, {
  show: (v: unknown) => showColor(v as Color),
  equals: (a: unknown, b: unknown) => eqColor(a as Color, b as Color),
  clone: (v: unknown) => cloneColor(v as Color),
});

assert(show(erasedColor) === "rgb(255, 128, 0)");
assert(equals(erasedColor, eraseWith({ r: 255, g: 128, b: 0 } as Color, {
  show: (v: unknown) => showColor(v as Color),
  equals: (a: unknown, b: unknown) => eqColor(a as Color, b as Color),
  clone: (v: unknown) => cloneColor(v as Color),
})));

const clonedColor = clone(erasedColor);
assert(show(clonedColor) === "rgb(255, 128, 0)");

// The cloned value is independent — modifying it doesn't affect the original
const inner: Color = unwrapErased(clonedColor);
inner.r = 0;
assert(show(erasedColor) === "rgb(255, 128, 0)", "Original unchanged after clone mutation");

// Multiple @derive types in a heterogeneous collection — the key value proposition
interface Size { w: number; h: number }

const erasedSize = eraseWith({ w: 1920, h: 1080 } as Size, {
  show: (v: unknown) => {
    const s = v as Size;
    return `${s.w}x${s.h}`;
  },
  equals: (a: unknown, b: unknown) => {
    const sa = a as Size, sb = b as Size;
    return sa.w === sb.w && sa.h === sb.h;
  },
});

// Different @derive types coexist in one collection
const mixed: WithShow[] = [erasedColor, erasedSize];
assert(show(mixed[0]) === "rgb(255, 128, 0)");
assert(show(mixed[1]) === "1920x1080");

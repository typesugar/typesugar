/**
 * @typesugar/react Showcase
 *
 * Self-documenting examples of compile-time React macros that bring
 * Vue/Svelte-style reactivity to React: state, derived, effect, watch,
 * component, each, match, and configuration.
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
  state,
  derived,
  effect,
  watch,
  // component is not called directly - only its types are used for type assertions
  // component,
  each,
  match,
  DEFAULT_CONFIG,
  type State,
  type Derived,
  type EmbeddedComponent,
  type ComponentProps,
  type ReactMacroMode,
  type ReactMacroConfig,
  type DependencyInfo,
  type SideEffect,
  type ClosureCapture,
} from "../src/index.js";

// ============================================================================
// 1. STATE — Reactive State Cells
// ============================================================================

// state() creates a reactive cell, like Vue's ref() or Svelte's $state.
// At compile time: state(0) → const [__val, __set] = useState(0)
// Runtime fallback works for testing without the macro transformer.

const count = state(0);
assert(count.get() === 0, "Initial state value should be 0");

count.set(42);
assert(count.get() === 42, "State should update via set()");

count.set((prev) => prev + 1);
assert(count.get() === 43, "State should update via updater function");

count.update((prev) => prev * 2);
assert(count.get() === 86, "update() is an alias for set with updater");

// Type-level: state() returns State<T>
typeAssert<Equal<ReturnType<typeof state<number>>, State<number>>>();
typeAssert<Equal<ReturnType<typeof state<string>>, State<string>>>();

// State<T> has get, set, update, and __brand
typeAssert<Extends<State<number>, { get(): number; set(v: number | ((p: number) => number)): void }>>();

// ============================================================================
// 2. DERIVED — Computed Values with Auto-Extracted Dependencies
// ============================================================================

// derived() creates a computed value that auto-tracks dependencies.
// At compile time: derived(() => x * 2) → useMemo(() => x * 2, [x])
// The macro enforces purity — calling .set() inside derived() is a compile error.

const base = state(10);
const doubled = derived(() => base.get() * 2);
assert(doubled.get() === 20, "Derived should compute from state");

// Type-level: derived() returns Derived<T>
typeAssert<Equal<ReturnType<typeof derived<number>>, Derived<number>>>();
typeAssert<Extends<Derived<string>, { get(): string }>>();

// Derived is NOT writable — no set() method
typeAssert<Not<Extends<Derived<number>, { set(v: number): void }>>>();

// ============================================================================
// 3. EFFECT — Side Effects with Auto-Extracted Dependencies
// ============================================================================

// effect() runs a side effect when dependencies change.
// At compile time: effect(() => ...) → useEffect(() => ..., [autoDeps])
// Can return a cleanup function.

let effectRan = false;
effect(() => {
  effectRan = true;
});
assert(effectRan, "Effect runtime fallback should run immediately");

// Effect with cleanup
let cleanupCalled = false;
effect(() => {
  return () => {
    cleanupCalled = true;
  };
});

// ============================================================================
// 4. WATCH — Explicit Dependency Effects
// ============================================================================

// watch() is like Vue's watch() — explicit dependencies instead of auto-extraction.
// Useful when you want precise control over what triggers re-execution.

const userId = state("user-1");
let watchedId: string | null = null;
watch([userId], (id) => {
  watchedId = id as string;
});
assert(watchedId === "user-1", "Watch should run immediately with current values");

// ============================================================================
// 5. COMPONENT — Embedded Components with Auto-Hoisting
// ============================================================================

// component() defines an embedded component that the macro hoists to module level
// and wraps in React.memo. This prevents the common React anti-pattern of
// defining components inside render functions (which causes state loss).

// Note: Runtime fallback just returns the render function as-is.
// The real magic happens at compile time.
typeAssert<Extends<EmbeddedComponent<{ text: string }>, React.MemoExoticComponent<any>>>();
typeAssert<Extends<ComponentProps<{ text: string }>, { text: string; key?: React.Key }>>();

// ============================================================================
// 6. EACH — Keyed Iteration
// ============================================================================

// each() provides Svelte-style keyed iteration.
// At compile time: each(items, render, keyFn) → items.map(item => <Render key={keyFn(item)} />)

const items = [
  { id: 1, text: "Buy milk" },
  { id: 2, text: "Write code" },
  { id: 3, text: "Ship it" },
];

const rendered = each(
  items,
  (item) => `<li>${item.text}</li>`,
  (item) => item.id
);
assert(Array.isArray(rendered), "each() runtime fallback returns an array");
assert((rendered as string[]).length === 3, "Should render all items");

// ============================================================================
// 7. MATCH — Exhaustive Pattern Matching in JSX
// ============================================================================

// match() provides compile-time exhaustive pattern matching for discriminated unions.
// Missing a variant is a compile-time error.

type Status =
  | { _tag: "loading" }
  | { _tag: "error"; message: string }
  | { _tag: "success"; data: number[] };

const loading: Status = { _tag: "loading" };
const error: Status = { _tag: "error", message: "oops" };
const success: Status = { _tag: "success", data: [1, 2, 3] };

const loadingResult = match(loading, {
  loading: () => "spinner",
  error: (e) => `error: ${e.message}`,
  success: (s) => `data: ${s.data.length}`,
});
assert(loadingResult === "spinner");

const errorResult = match(error, {
  loading: () => "spinner",
  error: (e) => `error: ${e.message}`,
  success: (s) => `data: ${s.data.length}`,
});
assert(errorResult === "error: oops");

const successResult = match(success, {
  loading: () => "spinner",
  error: (e) => `error: ${e.message}`,
  success: (s) => `data: ${s.data.length}`,
});
assert(successResult === "data: 3");

// ============================================================================
// 8. CONFIGURATION — Build Modes and Settings
// ============================================================================

// ReactMacroConfig controls how macros compile:
// - "react" mode → standard React hooks (useState, useMemo, useEffect)
// - "fine-grained" mode → Solid.js-style signals (no VDOM)

assert(DEFAULT_CONFIG.mode === "react", "Default mode should be 'react'");
assert(DEFAULT_CONFIG.strictPurity === true, "Strict purity should be on by default");
assert(DEFAULT_CONFIG.optimizeRendering === true, "Render optimization should be on by default");

typeAssert<Equal<ReactMacroMode, "react" | "fine-grained">>();
typeAssert<Extends<ReactMacroConfig, { mode: ReactMacroMode; strictPurity: boolean }>>();

// ============================================================================
// 9. ANALYSIS TYPES — Dependency Extraction and Purity Checking
// ============================================================================

// The macro uses these types internally for compile-time analysis.
// Exported for testing and debugging.

typeAssert<Extends<DependencyInfo, { reads: Set<string>; writes: Set<string>; isPure: boolean }>>();
typeAssert<Extends<SideEffect, { kind: string; description: string }>>();
typeAssert<Extends<ClosureCapture, { name: string; isState: boolean; needsProp: boolean }>>();

// SideEffect kinds cover common side-effect categories
type SideEffectKind = SideEffect["kind"];
typeAssert<Extends<"state-mutation", SideEffectKind>>();
typeAssert<Extends<"dom-mutation", SideEffectKind>>();
typeAssert<Extends<"fetch", SideEffectKind>>();

// ============================================================================
// 10. REAL-WORLD PATTERN — Full Component with All Macros
// ============================================================================

// In a real application with the macro transformer enabled:
//
// function TodoApp() {
//   const todos = state<Todo[]>([]);
//   const filter = state<"all" | "active" | "done">("all");
//   const newText = state("");
//
//   const filtered = derived(() =>
//     filter === "all" ? todos : todos.filter(t =>
//       filter === "active" ? !t.done : t.done
//     )
//   );
//
//   const count = derived(() => filtered.length);
//
//   effect(() => {
//     document.title = `Todos (${count})`;
//   });
//
//   const TodoItem = component<{ todo: Todo; onToggle: () => void }>(
//     ({ todo, onToggle }) => (
//       <li onClick={onToggle} style={{ textDecoration: todo.done ? "line-through" : "none" }}>
//         {todo.text}
//       </li>
//     )
//   );
//
//   return (
//     <div>
//       <h1>Todos ({count})</h1>
//       <input value={newText} onChange={e => newText.set(e.target.value)} />
//       <ul>
//         {each(filtered, todo => (
//           <TodoItem
//             todo={todo}
//             onToggle={() => todos.update(ts =>
//               ts.map(t => t.id === todo.id ? { ...t, done: !t.done } : t)
//             )}
//           />
//         ), todo => todo.id)}
//       </ul>
//       {match(filter, {
//         all: () => <span>Showing all</span>,
//         active: () => <span>Showing active</span>,
//         done: () => <span>Showing done</span>,
//       })}
//     </div>
//   );
// }
//
// Compiles to standard React hooks:
// - state() → useState
// - derived() → useMemo with auto-extracted deps
// - effect() → useEffect with auto-extracted deps
// - component() → hoisted to module level + React.memo
// - each() → .map() with injected keys
// - match() → exhaustive switch with compile-time checking

console.log("@typesugar/react showcase: all assertions passed!");

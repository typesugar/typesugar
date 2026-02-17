/**
 * typemacro/react - Macro-Powered React
 *
 * Compile-time macros that bring Vue/Svelte-style reactivity to React.
 *
 * ## Features
 *
 * - `state(initialValue)` - Reactive state (like Vue's ref() or Svelte's $state)
 * - `derived(() => computation)` - Computed values with auto-extracted deps
 * - `effect(() => sideEffect)` - Side effects with auto-extracted deps
 * - `watch([deps], (values) => {...})` - Explicit dependency effects
 * - `component<Props>(renderFn)` - Embedded components with auto-hoisting
 * - `each(items, renderFn, keyFn)` - Keyed iteration
 * - `match(value, cases)` - Exhaustive pattern matching
 *
 * ## Usage
 *
 * ```typescript
 * import { state, derived, effect, component, each, match } from "typemacro/react";
 *
 * function Counter() {
 *   const count = state(0);
 *   const doubled = derived(() => count * 2);
 *
 *   effect(() => {
 *     document.title = `Count: ${count}`;
 *   });
 *
 *   return (
 *     <div>
 *       <p>Count: {count}, Doubled: {doubled}</p>
 *       <button onClick={() => count.set(c => c + 1)}>+</button>
 *     </div>
 *   );
 * }
 * ```
 *
 * ## How It Works
 *
 * Each macro is transformed at compile time:
 *
 * - `state(0)` → `const [__val, __set] = useState(0)`
 * - `derived(() => x * 2)` → `useMemo(() => x * 2, [x])`
 * - `effect(() => ...)` → `useEffect(() => ..., [autoDeps])`
 *
 * The macros:
 * 1. Auto-extract reactive dependencies (no manual dep arrays!)
 * 2. Verify purity at compile time (derived must be pure)
 * 3. Detect rules-of-hooks violations at compile time
 * 4. Hoist embedded components to module level
 *
 * ## Modes
 *
 * - `react` (default): Compiles to standard React hooks
 * - `fine-grained`: Compiles to Solid.js-style signals (no VDOM)
 *
 * @module
 */

// Re-export public types
export type {
  State,
  Derived,
  EmbeddedComponent,
  ComponentProps,
  ReactMacroMode,
  ReactMacroConfig,
} from "./types.js";

export { DEFAULT_CONFIG } from "./types.js";

// Re-export analysis utilities (for advanced use)
export type {
  DependencyInfo,
  SideEffect,
  ClosureCapture,
} from "./types.js";

// Re-export macros (they register themselves)
export * from "./macros/index.js";

// Re-export runtime (for fine-grained mode)
export * from "./runtime/index.js";

// Re-export analysis (for testing/debugging)
export * from "./analysis/index.js";

// ============================================================================
// Placeholder Functions (for user code)
//
// These are the actual functions users import. They are replaced by macros
// at compile time, so the runtime implementations here are just fallbacks
// for testing or when macros aren't enabled.
// ============================================================================

import type { State, Derived, EmbeddedComponent } from "./types.js";

/**
 * Create reactive state.
 *
 * @example
 * ```typescript
 * const count = state(0);
 * count.set(1);
 * count.set(c => c + 1);
 * ```
 *
 * @see The macro transforms this to useState (React mode) or createSignal (fine-grained mode)
 */
export function state<T>(initialValue: T): State<T> {
  // Runtime fallback (should be replaced by macro)
  let value = initialValue;
  return {
    get: () => value,
    set: (v: T | ((prev: T) => T)) => {
      value = typeof v === "function" ? (v as (prev: T) => T)(value) : v;
    },
    update: (fn: (prev: T) => T) => {
      value = fn(value);
    },
    __brand: "State" as const,
  };
}

/**
 * Create a derived (computed) value.
 *
 * @example
 * ```typescript
 * const doubled = derived(() => count * 2);
 * ```
 *
 * @see The macro transforms this to useMemo (React mode) or createComputed (fine-grained mode)
 */
export function derived<T>(computation: () => T): Derived<T> {
  // Runtime fallback (should be replaced by macro)
  return {
    get: computation,
    __brand: "Derived" as const,
  };
}

/**
 * Run a side effect when dependencies change.
 *
 * @example
 * ```typescript
 * effect(() => {
 *   document.title = `Count: ${count}`;
 * });
 * ```
 *
 * @see The macro transforms this to useEffect (React mode) or createEffect (fine-grained mode)
 */
export function effect(effectFn: () => void | (() => void)): void {
  // Runtime fallback - just run immediately
  const cleanup = effectFn();
  // In a real implementation, we'd track and call cleanup
  void cleanup;
}

/**
 * Run a side effect with explicit dependencies.
 *
 * @example
 * ```typescript
 * watch([userId], async (newId) => {
 *   profile.set(await fetchProfile(newId));
 * });
 * ```
 */
export function watch<T extends readonly State<unknown>[]>(
  deps: T,
  effectFn: (...values: { [K in keyof T]: T[K] extends State<infer V> ? V : never }) => void | (() => void),
): void {
  // Runtime fallback - just run immediately
  const values = deps.map(d => d.get()) as { [K in keyof T]: T[K] extends State<infer V> ? V : never };
  const cleanup = effectFn(...values);
  void cleanup;
}

/**
 * Define an embedded component.
 *
 * @example
 * ```typescript
 * const Item = component<{ todo: Todo }>(({ todo }) => (
 *   <li>{todo.text}</li>
 * ));
 * ```
 *
 * @see The macro hoists this to module level and wraps in React.memo
 */
export function component<P extends object>(
  render: React.FC<P>,
): EmbeddedComponent<P> {
  // Runtime fallback - just return the component (no memoization)
  // In real use, this is replaced by the macro
  return render as unknown as EmbeddedComponent<P>;
}

/**
 * Keyed iteration.
 *
 * @example
 * ```tsx
 * {each(items, item => <Item todo={item} />, item => item.id)}
 * ```
 *
 * @see The macro transforms this to map() with injected keys
 */
export function each<T, K>(
  items: readonly T[],
  render: (item: T, index: number) => React.ReactNode,
  keyFn: (item: T) => K,
): React.ReactNode {
  // Runtime fallback - just map (keys handled by React)
  return items.map((item, index) => render(item, index));
}

/**
 * Exhaustive pattern matching for discriminated unions.
 *
 * @example
 * ```tsx
 * {match(status, {
 *   loading: () => <Spinner />,
 *   error: (e) => <Error message={e.message} />,
 *   success: (data) => <Data rows={data} />,
 * })}
 * ```
 *
 * @see The macro provides compile-time exhaustiveness checking
 */
export function match<T extends { _tag: string }, R>(
  value: T,
  cases: { [K in T["_tag"]]: (value: Extract<T, { _tag: K }>) => R },
): R {
  // Runtime fallback
  const tag = value._tag;
  const handler = cases[tag as T["_tag"]];
  if (!handler) {
    throw new Error(`Unhandled case: ${tag}`);
  }
  return handler(value as Extract<T, { _tag: typeof tag }>);
}

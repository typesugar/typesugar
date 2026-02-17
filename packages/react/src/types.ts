/**
 * Type definitions for the React macro use-case
 *
 * These types define the public API surface for state, derived, effect, etc.
 * The macros transform these into React hooks (standard mode) or signals
 * (fine-grained mode).
 */

// ============================================================================
// Reactive Primitives
// ============================================================================

/**
 * A reactive state cell. Like Vue's `ref()` or Svelte's `$state`.
 *
 * @example
 * ```typescript
 * const count = state(0);
 * count.set(1);
 * count.set(c => c + 1);
 * console.log(count.get()); // In macros, you can just use `count` directly
 * ```
 */
export interface State<T> {
  /** Get the current value */
  get(): T;

  /** Set a new value, or provide an updater function */
  set(valueOrUpdater: T | ((prev: T) => T)): void;

  /** Update with a function (alias for set with updater) */
  update(updater: (prev: T) => T): void;

  /** For type inference in macros */
  readonly __brand: "State";
}

/**
 * A derived (computed) value. Like Vue's `computed()` or Svelte's `$derived`.
 * Automatically recalculates when dependencies change.
 *
 * @example
 * ```typescript
 * const count = state(0);
 * const doubled = derived(() => count.get() * 2);
 * console.log(doubled.get()); // In macros, you can just use `doubled`
 * ```
 */
export interface Derived<T> {
  /** Get the computed value */
  get(): T;

  /** For type inference in macros */
  readonly __brand: "Derived";
}

// ============================================================================
// Component Definition
// ============================================================================

/**
 * Props type helper for embedded components
 */
export type ComponentProps<P> = P & { key?: React.Key };

/**
 * An embedded component created via the `component()` macro.
 * This is hoisted to module level and wrapped in React.memo at compile time.
 */
export type EmbeddedComponent<P> = React.MemoExoticComponent<
  React.FC<ComponentProps<P>>
>;

// ============================================================================
// Placeholder Functions (replaced by macros at compile time)
// ============================================================================

/**
 * Create reactive state.
 *
 * In standard React mode, expands to `useState`.
 * In fine-grained mode, expands to a signal.
 *
 * @example
 * ```typescript
 * const count = state(0);
 * const name = state("world");
 * ```
 */
export declare function state<T>(initialValue: T): State<T>;

/**
 * Create a derived (computed) value from reactive dependencies.
 *
 * In standard React mode, expands to `useMemo` with auto-extracted deps.
 * In fine-grained mode, expands to a computed signal.
 *
 * **Important**: The computation must be pure (no side effects).
 * Using `.set()` inside a `derived()` is a compile-time error.
 *
 * @example
 * ```typescript
 * const items = state<string[]>([]);
 * const query = state("");
 * const filtered = derived(() => items.filter(i => i.includes(query)));
 * ```
 */
export declare function derived<T>(computation: () => T): Derived<T>;

/**
 * Run a side effect when reactive dependencies change.
 *
 * In standard React mode, expands to `useEffect` with auto-extracted deps.
 * In fine-grained mode, expands to an effect subscription.
 *
 * Can return a cleanup function that runs before re-execution.
 *
 * @example
 * ```typescript
 * effect(() => {
 *   document.title = `Count: ${count}`;
 * });
 *
 * effect(() => {
 *   const controller = new AbortController();
 *   fetchData(query, controller.signal);
 *   return () => controller.abort(); // cleanup
 * });
 * ```
 */
export declare function effect(effectFn: () => void | (() => void)): void;

/**
 * Run a side effect with explicitly specified dependencies.
 * Like Vue's `watch()`.
 *
 * @example
 * ```typescript
 * watch([userId], async (newId) => {
 *   profile.set(await fetchProfile(newId));
 * });
 * ```
 */
export declare function watch<T extends readonly State<unknown>[]>(
  deps: T,
  effectFn: (...values: { [K in keyof T]: T[K] extends State<infer V> ? V : never }) => void | (() => void),
): void;

/**
 * Define an embedded component that is hoisted to module level and memoized.
 *
 * This solves the React anti-pattern of defining components inside other
 * components (which causes state loss on every render).
 *
 * @example
 * ```typescript
 * function TodoApp() {
 *   const todos = state<Todo[]>([]);
 *
 *   // This is hoisted to module level, wrapped in React.memo
 *   const TodoItem = component<{ todo: Todo; onToggle: () => void }>(
 *     ({ todo, onToggle }) => {
 *       const editing = state(false);
 *       return <li>{todo.text}</li>;
 *     }
 *   );
 *
 *   return <ul>{todos.map(t => <TodoItem key={t.id} todo={t} />)}</ul>;
 * }
 * ```
 */
export declare function component<P extends object>(
  render: React.FC<P>,
): EmbeddedComponent<P>;

// ============================================================================
// JSX Helpers (expression macros for JSX)
// ============================================================================

/**
 * Keyed iteration with automatic memoization. Svelte-inspired.
 *
 * @example
 * ```tsx
 * {each(items, item => <TodoItem todo={item} />, item => item.id)}
 * ```
 *
 * Expands to:
 * ```tsx
 * {items.map(item => <TodoItem key={item.id} todo={item} />)}
 * ```
 */
export declare function each<T, K>(
  items: readonly T[],
  render: (item: T, index: number) => React.ReactNode,
  keyFn: (item: T) => K,
): React.ReactNode;

/**
 * Exhaustive pattern matching for discriminated unions in JSX.
 *
 * @example
 * ```tsx
 * {match(status, {
 *   loading: () => <Spinner />,
 *   error: (e) => <ErrorBanner message={e.message} />,
 *   success: (data) => <DataTable rows={data} />,
 * })}
 * ```
 *
 * Missing a variant is a compile-time error.
 */
export declare function match<T extends { _tag: string }, R>(
  value: T,
  cases: {
    [K in T["_tag"]]: (value: Extract<T, { _tag: K }>) => R;
  },
): R;

// ============================================================================
// Analysis Types (internal, used by macros)
// ============================================================================

/**
 * Dependency information extracted from a closure
 * @internal
 */
export interface DependencyInfo {
  /** State variables read inside the closure */
  reads: Set<string>;

  /** State variables written inside the closure (via .set()) */
  writes: Set<string>;

  /** Free variables captured from outer scope */
  captures: Set<string>;

  /** Whether the closure is pure (no writes, no side effects) */
  isPure: boolean;

  /** Detected side effects */
  sideEffects: SideEffect[];
}

/**
 * A detected side effect in a closure
 * @internal
 */
export interface SideEffect {
  kind:
    | "state-mutation" // .set() call
    | "dom-mutation" // document.*, window.*
    | "console" // console.*
    | "fetch" // fetch, XMLHttpRequest
    | "timer" // setTimeout, setInterval
    | "unknown"; // unknown function call

  /** Description for error messages */
  description: string;

  /** Source location */
  line?: number;
  column?: number;
}

/**
 * Closure capture information for component hoisting
 * @internal
 */
export interface ClosureCapture {
  /** Variable name */
  name: string;

  /** Is this a state variable? */
  isState: boolean;

  /** Is this a setter function for a state variable? */
  isSetter: boolean;

  /** The state variable name if this is a setter */
  stateFor?: string;

  /** Should this be threaded as a prop? */
  needsProp: boolean;
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Build mode for the React macros
 */
export type ReactMacroMode =
  | "react" // Standard React (useState, useMemo, useEffect)
  | "fine-grained"; // Fine-grained signals (no VDOM diffing)

/**
 * Configuration for the React macro transformer
 */
export interface ReactMacroConfig {
  /** Build mode */
  mode: ReactMacroMode;

  /** Generate dev-mode validators for props */
  devModeValidators: boolean;

  /** Enable strict purity checking */
  strictPurity: boolean;

  /** Enable render optimizations (auto-memoization, batching) */
  optimizeRendering: boolean;
}

export const DEFAULT_CONFIG: ReactMacroConfig = {
  mode: "react",
  devModeValidators: process.env.NODE_ENV !== "production",
  strictPurity: true,
  optimizeRendering: true,
};

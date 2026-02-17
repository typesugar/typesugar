# @ttfx/react

> Compile-time React macros — Vue/Svelte-style reactivity for React.

## Overview

`@ttfx/react` brings modern reactivity patterns to React through compile-time macros. Write cleaner component code with automatic dependency tracking — no more manual dependency arrays.

## Installation

```bash
npm install @ttfx/react
# or
pnpm add @ttfx/react
```

Requires React 18+ as a peer dependency.

## Usage

### state() — Reactive State

```typescript
import { state } from "@ttfx/react";

function Counter() {
  const count = state(0);

  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => count.set(c => c + 1)}>+</button>
    </div>
  );
}

// Compiles to:
// const [__count, __setCount] = useState(0);
```

### derived() — Computed Values

```typescript
import { state, derived } from "@ttfx/react";

function Example() {
  const count = state(0);
  const doubled = derived(() => count * 2);  // Auto-tracks dependencies!

  return <p>Doubled: {doubled}</p>;
}

// Compiles to:
// const doubled = useMemo(() => __count * 2, [__count]);
```

### effect() — Side Effects

```typescript
import { state, effect } from "@ttfx/react";

function DocumentTitle() {
  const title = state("Hello");

  effect(() => {
    document.title = title;  // Auto-extracts dependencies!
  });

  return <input value={title} onChange={e => title.set(e.target.value)} />;
}

// Compiles to:
// useEffect(() => { document.title = __title; }, [__title]);
```

### watch() — Explicit Dependencies

```typescript
import { state, watch } from "@ttfx/react";

function UserProfile() {
  const userId = state(1);
  const profile = state(null);

  watch([userId], async (id) => {
    profile.set(await fetchProfile(id));
  });

  return profile ? <Profile data={profile} /> : <Loading />;
}
```

### component() — Embedded Components

```typescript
import { component, each } from "@ttfx/react";

function TodoList() {
  const todos = state([]);

  // Embedded component — auto-hoisted and memoized
  const TodoItem = component<{ todo: Todo }>(({ todo }) => (
    <li>{todo.text}</li>
  ));

  return (
    <ul>
      {each(todos, todo => <TodoItem todo={todo} />, t => t.id)}
    </ul>
  );
}
```

### match() — Pattern Matching

```typescript
import { match } from "@ttfx/react";

type Status =
  | { _tag: "loading" }
  | { _tag: "error"; message: string }
  | { _tag: "success"; data: Data };

function StatusView({ status }: { status: Status }) {
  return match(status, {
    loading: () => <Spinner />,
    error: (e) => <Error message={e.message} />,
    success: (s) => <DataView data={s.data} />,
  });
}
```

## How It Works

The macros transform your code at compile time:

| You Write              | It Becomes                           |
| ---------------------- | ------------------------------------ |
| `state(0)`             | `const [__val, __set] = useState(0)` |
| `derived(() => x * 2)` | `useMemo(() => x * 2, [x])`          |
| `effect(() => ...)`    | `useEffect(() => ..., [autoDeps])`   |

### Automatic Dependency Extraction

The transformer analyzes your code to extract dependencies:

```typescript
const a = state(1);
const b = state(2);
const sum = derived(() => a + b);
// Extracted deps: [a, b]
```

### Compile-Time Checks

- **Purity verification** — `derived()` must be a pure function
- **Rules of hooks** — Violations detected at compile time
- **Exhaustive matching** — `match()` ensures all cases handled

## Modes

### React Mode (default)

Compiles to standard React hooks.

### Fine-Grained Mode

Compiles to Solid.js-style signals for true fine-grained reactivity without VDOM diffing.

```typescript
// Configure in transformer options
{
  plugins: [ttfxPlugin({ reactMode: "fine-grained" })];
}
```

## API Reference

### State Management

- `state<T>(initialValue)` — Create reactive state
- `derived<T>(computation)` — Create computed value
- `effect(effectFn)` — Run side effect with auto-deps
- `watch(deps, effectFn)` — Run effect with explicit deps

### Components

- `component<Props>(renderFn)` — Define embedded component
- `each(items, renderFn, keyFn)` — Keyed iteration
- `match(value, cases)` — Pattern matching

### Types

- `State<T>` — Reactive state type
- `Derived<T>` — Computed value type
- `EmbeddedComponent<P>` — Component type

## License

MIT

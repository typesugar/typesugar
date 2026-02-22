# React Macros

Vue/Svelte-style reactivity for React through compile-time macros. Automatic dependency tracking — no more manual dependency arrays.

## Quick Start

```bash
npm install @typesugar/react
```

```typescript
import { state, derived, effect } from "@typesugar/react";

function Counter() {
  const count = state(0);
  const doubled = derived(() => count * 2); // Auto-tracks dependencies!

  effect(() => {
    document.title = `Count: ${count}`; // Auto-extracts deps!
  });

  return (
    <div>
      <p>Count: {count}, Doubled: {doubled}</p>
      <button onClick={() => count.set(c => c + 1)}>+</button>
    </div>
  );
}
```

## Features

### state() — Reactive State

```typescript
const count = state(0);

// Compiles to:
// const [__count, __setCount] = useState(0);
```

### derived() — Computed Values

```typescript
const doubled = derived(() => count * 2);

// Compiles to:
// const doubled = useMemo(() => __count * 2, [__count]);
```

### effect() — Side Effects

```typescript
effect(() => {
  document.title = title;
});

// Compiles to:
// useEffect(() => { document.title = __title; }, [__title]);
```

### component() — Embedded Components

```typescript
const TodoItem = component<{ todo: Todo }>(({ todo }) => (
  <li>{todo.text}</li>
));

// Auto-hoisted and memoized
```

### match() — Pattern Matching

```typescript
return match(status, {
  loading: () => <Spinner />,
  error: (e) => <Error message={e.message} />,
  success: (s) => <DataView data={s.data} />,
});
```

## Compile-Time Checks

- **Purity verification** — `derived()` must be a pure function
- **Rules of hooks** — Violations detected at compile time
- **Exhaustive matching** — `match()` ensures all cases handled

## Learn More

- [API Reference](/reference/packages#react)
- [Package README](https://github.com/typesugar/typesugar/tree/main/packages/react)

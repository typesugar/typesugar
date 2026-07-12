# Reactivity: State Model Design

<!-- historical-doc -->

::: warning HISTORICAL DOCUMENT
This is internal design material, kept for history. It predates
[PEP-047](https://github.com/typesugar/typesugar/blob/main/peps/PEP-047-remove-sts.md)
(removal of the `.sts` extension),
[PEP-052](https://github.com/typesugar/typesugar/blob/main/peps/PEP-052-import-scoped-macro-activation.md)
(scope-based resolution — there is no global instance registry) and/or
[PEP-053](https://github.com/typesugar/typesugar/blob/main/peps/PEP-053-always-on-specialization.md)
(specialization is automatic; there is no `specialize()` API), so parts of it
describe a model the shipped compiler **no longer implements**.

For how typesugar actually works today, see the [guides](/guides/).
:::

> Getting reactivity wrong poisons everything else, so it deserves to come first.

## What's Wrong with React Hooks

React hooks have four structural flaws:

1. **Positional identity.** Hooks rely on call order to associate state with storage slots. This is why you can't call hooks conditionally or in loops.

2. **Re-execute everything.** On every state change, React re-executes the entire component function. Every `useMemo` re-checks its dependency array.

3. **Stale closures.** Because the function re-executes, any callback captured during a previous render sees old values.

4. **Manual dependency arrays.** `useEffect(() => { ... }, [a, b, c])` — if you forget `c`, you get a stale closure bug that's silent until production.

## What Vue's Composition API Gets Right

Vue 3's Composition API solves all four problems:

```typescript
function useCounter(initial = 0) {
  const count = ref(initial);
  const doubled = computed(() => count.value * 2); // auto-tracks count

  watch(count, (newVal) => {
    console.log(`count is now ${newVal}`);
  });

  return { count, doubled };
}
```

- **Named, not positional.** Refs have identity via the object, not call order.
- **Fine-grained.** Only affected computeds re-execute.
- **No stale closures.** Reading `count.value` always returns current value.
- **Auto-tracked dependencies.** No manual arrays.

The flaw: `.value`. Every read and write requires `.value`.

## What Svelte Runes Get Right

Svelte 5 eliminates ceremony:

```svelte
let count = $state(0);
let doubled = $derived(count * 2);

count++;  // just works — the compiler rewrites this
```

No `.value`. No `()`. The gold standard for ergonomics.

The flaw: requires a custom compiler and `.svelte` file format.

## What Solid Signals Get Right

Solid has the best runtime model. Signals work anywhere:

```typescript
const [count, setCount] = createSignal(0);
const doubled = createMemo(() => count() * 2);
```

The flaw: `count()` — you must call the getter as a function everywhere.

## The typesugar Answer: Type-Aware Auto-Unwrapping

We combine the best of all approaches because the macro has access to `ctx.typeChecker`. It **knows** at compile time whether a value is a `Signal<T>` or a plain `T`.

**The core primitives are explicit (like Vue/Solid):**

```typescript
import { ref, computed, watch } from "@typesugar/web";

const count = ref(0); // Signal<number>
const doubled = computed(() => count.value * 2); // Computed<number>
```

**Inside `component()`, the macro auto-unwraps (like Svelte):**

```typescript
const Counter = component(() => {
  const count = ref(0);
  const doubled = computed(() => count * 2);

  // The macro sees `count` has type Signal<number>.
  // It rewrites reads to count.value and writes to count.value = ...
  count++;

  return html`<p>${count} × 2 = ${doubled}</p>`;
});
```

**The rewrite rules are simple:**

| You write (inside `component`) | Macro emits       | Why                             |
| ------------------------------ | ----------------- | ------------------------------- |
| `count` (read)                 | `count.value`     | `count` is `Signal<number>`     |
| `count++`                      | `count.value++`   | Assignment to signal            |
| `count = 5`                    | `count.value = 5` | Assignment to signal            |
| `name` (read)                  | `name`            | `name` is `string` — no rewrite |

**Outside `component()`, you use `.value` explicitly:**

```typescript
// composables/useCounter.ts
export function useCounter(initial = 0) {
  const count = ref(initial);
  const doubled = computed(() => count.value * 2);

  function increment() {
    count.value++;
  }

  return { count, doubled, increment };
}
```

Composables are shared infrastructure — they should be explicit. The `component()` boundary is where ergonomics win.

## Comparison Summary

| Problem                  | React | Vue         | Svelte  | Solid | typesugar   |
| ------------------------ | ----- | ----------- | ------- | ----- | ----------- |
| Positional identity      | Yes   | No          | No      | No    | No          |
| Re-execute everything    | Yes   | No          | No      | No    | No          |
| Stale closures           | Yes   | No          | No      | No    | No          |
| Manual dependency arrays | Yes   | No          | No      | No    | No          |
| `.value` / `()` ceremony | No    | Yes         | No      | Yes   | No (unwrap) |
| Works outside components | Hooks | Composables | Partial | Yes   | Yes         |
| Share without Provider   | No    | Yes         | Yes     | Yes   | Yes         |
| Custom file format       | No    | No          | Yes     | No    | No          |
| Type-checker aware       | No    | No          | No      | No    | **Yes**     |

## Sharing State Across Components

State sharing in typesugar is trivial — just export from a module:

```typescript
// stores/user.ts
import { ref, computed } from "@typesugar/web";

export const currentUser = ref<User | null>(null);
export const isLoggedIn = computed(() => currentUser.value !== null);

export async function login(credentials: Credentials) {
  currentUser.value = await api.login(credentials);
}
```

```typescript
// components/Header.ts
import { currentUser, isLoggedIn, login } from "../stores/user";

const Header = component(() => {
  return html`
    ${match(isLoggedIn, {
      true: () => html`<span>Welcome, ${currentUser?.name}</span>`,
      false: () => html`<LoginForm onSubmit=${login} />`,
    })}
  `;
});
```

No Context. No Provider tree. No prop drilling. State is just reactive values in modules.

## The `let` Shorthand

For the common case of a single local signal, we provide a `let` shorthand:

```typescript
// Using ref:
const Counter = component(() => {
  const count = ref(0);
  return html`<button onClick=${() => count++}>${count}</button>`;
});

// Using let shorthand:
const Counter = component(() => {
  let count = 0;
  return html`<button onClick=${() => count++}>${count}</button>`;
});
```

The macro detects `let` declarations and transforms them to signals. This provides Svelte-like ergonomics while remaining valid TypeScript.

---

See also:

- [Components](./components.md) — how components use reactive state
- [Fx](./fx.md) — effects and async operations

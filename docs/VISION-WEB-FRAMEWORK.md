# Vision: typesugar Web Framework

> A web framework where the framework disappears. You write declarative,
> type-safe, functional code. The compiler reduces it to exactly what you'd
> write by hand in vanilla JavaScript.

## Philosophy

Every web framework makes you pay a tax — a runtime, a virtual DOM, a
reactivity system, an effect runtime. The tax exists because frameworks are
libraries, and libraries can't change the language.

typesugar **can** change the language. Our macros run inside the TypeScript
compiler. We have access to the full type checker, the AST, and compile-time
evaluation. This means:

- **Reactivity** isn't a runtime subscription system — it's a compile-time
  rewrite of variable access into surgical DOM mutations.
- **Effects** aren't a runtime fiber system — they're typed descriptions that
  the compiler inlines into plain async/await.
- **Components** aren't runtime function wrappers — they're compile-time
  templates that emit direct DOM instructions.
- **Styles** aren't runtime CSS-in-JS — they're compile-time extracted static
  CSS files.

The framework is the compiler. At runtime, there is no framework.

---

## Two Syntax Layers

typesugar offers two syntax layers for every feature. The **TS-compatible**
layer is the default — it works with every IDE, linter, formatter, and AI
tool out of the box. The **extended syntax** layer is an opt-in
preprocessor upgrade for teams that want the cleanest possible DX.

### Why Two Layers?

Custom syntax is a tradeoff:

|                            | TS-compatible (default)  | Extended syntax (opt-in)         |
| -------------------------- | ------------------------ | -------------------------------- |
| IDE autocomplete           | Full — native TypeScript | Requires language service plugin |
| Type checking              | Full — built in          | After preprocessing              |
| ESLint / Prettier          | Works                    | Needs custom parser/printer      |
| AI tools (Copilot, Cursor) | Works                    | May not understand syntax        |
| GitHub diff rendering      | Works                    | Needs syntax grammar             |
| Source maps                | N/A                      | Must be generated correctly      |
| Readability                | Good                     | Excellent                        |
| Signal-to-noise ratio      | Good                     | Excellent                        |
| Learning curve             | TypeScript only          | New syntax to learn              |

The TS-compatible layer has a higher floor (everything works). The extended
syntax has a higher ceiling (everything is cleaner). Teams choose based on
their tooling investment tolerance.

### Side-by-Side Comparison

**Do-notation for effects:**

```typescript
// TS-compatible (generators — like Effect-TS):
const fetchUser = (id: string) => fx(function*() {
  const token = yield* auth.getToken();
  const user = yield* http.fetch<User>(`/api/users/${id}`, authHeader(token));
  return user;
});

// Extended syntax (preprocessor):
const fetchUser = (id: string) => fx {
  token <- auth.getToken()
  user  <- http.fetch<User>(`/api/users/${id}`, authHeader(token))
  return user
}

// Both compile to:
const fetchUser = async (id: string) => {
  const token = await getToken();
  const user = await fetch(`/api/users/${id}`, {
    headers: { Authorization: `Bearer ${token}` }
  }).then(r => r.json());
  return user;
};
```

Difference: `yield*` vs `<-`. The generator version has full type inference
out of the box. The extended syntax is slightly cleaner but requires
preprocessing.

**Pattern matching:**

```typescript
// TS-compatible (function call):
return match(user, {
  Loading: () => html`<Spinner />`,
  Err:     (e) => html`<ErrorBanner error=${e} />`,
  Ok:      (u) => html`<UserCard user=${u} />`,
});

// Extended syntax (preprocessor):
return match user {
  Loading -> html`<Spinner />`
  Err(e)  -> html`<ErrorBanner error=${e} />`
  Ok(u)   -> html`<UserCard user=${u} />`
}
```

Difference: Minimal. The function call version is barely more verbose and
has full IDE support. Match is the weakest case for extended syntax.

**Component definitions:**

```typescript
// TS-compatible (builder pattern):
const TodoItem = component($ => {
  $.props<{ todo: Todo; onToggle: (id: string) => void }>();
  $.style = css`.item { padding: 8px; } .done { text-decoration: line-through; }`;
  $.view = ({ todo, onToggle }) => html`
    <li class=${todo.done ? 'done' : 'item'}
        onClick=${() => onToggle(todo.id)}>
      ${todo.text}
    </li>
  `;
});

// Extended syntax (preprocessor):
component TodoItem {
  props {
    todo: Todo
    onToggle: (id: string) => void
  }

  style {
    .item { padding: 8px; }
    .done { text-decoration: line-through; }
  }

  view {
    <li class={todo.done ? 'done' : 'item'}
        onClick={() => onToggle(todo.id)}>
      {todo.text}
    </li>
  }
}
```

Difference: **Significant.** Component definitions benefit the most from
extended syntax. The declarative sections (`props`, `style`, `view`) are
cleaner without builder ceremony. This is where the preprocessor earns its
keep.

### Recommendation

Start with TS-compatible syntax. It works everywhere, from day one, with
zero tooling investment. Adopt extended syntax when:

- Your team is committed to typesugar long-term
- You've installed the language service plugin
- You want the cleanest possible DX for large component files

Both layers compile to identical output. You can mix them in the same
project — some files use extended syntax, others use TS-compatible.

### Extended Syntax: The Preprocessor

For teams that opt in, the preprocessor is a core capability. It runs before
TypeScript parsing, transforming custom syntax blocks into valid TypeScript.

A **syntax block** has the form:

```
keyword name? {
  content
}
```

Built-in blocks: `fx { }`, `component Name { }`, `match expr { }`.

Users can register custom syntax blocks:

```typescript
defineSyntaxBlock({
  keyword: 'query',
  transform: (name, content) => {
    return `const ${name} = sql\`${content}\``;
  }
});

// Usage:
query GetUsers {
  SELECT * FROM users WHERE active = true
}
```

The VSCode extension provides syntax highlighting, autocomplete, and error
reporting inside syntax blocks — but this requires the language service
plugin, which is why extended syntax is opt-in rather than default.

---

## Part 0: Why Not Hooks? (State Model Design)

This section justifies the core state model. Getting this wrong poisons
everything else, so it deserves to come first.

### What's Wrong with React Hooks

React hooks have four structural flaws, not just rough edges:

**1. Positional identity.** Hooks rely on call order to associate state with
storage slots. This is why you can't call hooks conditionally or in loops.
It's not a "rule" — it's a fundamental consequence of the design. Named
state (refs, signals) doesn't have this problem.

**2. Re-execute everything.** On every state change, React re-executes the
entire component function. Every `useMemo` re-checks its dependency array.
Every `useCallback` re-checks its array. This is O(hooks) work even when
only one piece of state changed.

**3. Stale closures.** Because the function re-executes, any callback that
was captured during a previous render sees old values. This is the #1 source
of subtle bugs in React apps. Developers paper over it with `useRef` or
`useCallback`, but those are workarounds for a design flaw.

**4. Manual dependency arrays.** `useEffect(() => { ... }, [a, b, c])` — if
you forget `c`, you get a stale closure bug that's silent until production.
The React Compiler tries to auto-generate these, but it's a band-aid on a
wound that signals don't have.

### What Vue's Composition API Gets Right

Vue 3's Composition API solves all four problems:

```typescript
// Vue Composition API
function useCounter(initial = 0) {
  const count = ref(initial);
  const doubled = computed(() => count.value * 2); // auto-tracks count

  watch(count, (newVal) => {
    console.log(`count is now ${newVal}`); // auto-tracks count
  });

  return { count, doubled };
}
```

- **Named, not positional.** `count` is a ref object. It can be passed
  around, returned, stored — its identity is the object, not its call order.
- **Fine-grained.** When `count` changes, only the computed and watch that
  read it re-execute. The rest of the component is untouched.
- **No stale closures.** Reading `count.value` always returns the current
  value because it goes through the reactive proxy.
- **Auto-tracked dependencies.** `computed` and `watch` detect what you read
  during execution. No manual arrays.
- **Composable anywhere.** `useCounter` is just a function. It works inside
  or outside components. You can share state by exporting it from a module.
  No Context/Provider ceremony.

The one flaw: `.value`. Every ref read and write requires `.value`, which is
a constant paper cut that trips up beginners and annoys experts.

### What Svelte Runes Get Right

Svelte 5 eliminates even that ceremony:

```svelte
let count = $state(0);
let doubled = $derived(count * 2);

count++;  // just works — the compiler rewrites this
```

No `.value`. No `()`. No ceremony at all. You write plain JavaScript and the
compiler makes it reactive. This is the gold standard for ergonomics.

The flaw: it requires a custom compiler and a custom `.svelte` file format.
You can't extract a composable to a plain `.ts` file without losing the
magic. Runes in `.svelte.ts` files partially address this, but the tooling
boundary is real.

### What Solid Signals Get Right

Solid has the best runtime model. Signals are standalone reactive primitives
that work anywhere — inside components, outside components, in modules:

```typescript
const [count, setCount] = createSignal(0);
const doubled = createMemo(() => count() * 2);

createEffect(() => {
  console.log(count()); // auto-tracked, re-runs when count changes
});
```

The flaw: `count()` — you must call the getter as a function everywhere.
And if you accidentally pass `count()` (the current value) instead of `count`
(the signal) to a child component, you lose reactivity silently.

### The typesugar Answer: Type-Aware Auto-Unwrapping

We can combine the best of all four approaches because the macro has access
to `ctx.typeChecker`. It **knows** at compile time whether a value is a
`Signal<T>` or a plain `T`.

**The core primitives are explicit (like Vue/Solid):**

```typescript
import { ref, computed, watch } from "@typesugar/web";

// Explicit signal creation — works anywhere: components, modules, utilities
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

**The rewrite rules are simple and predictable:**

| You write (inside `component`) | Macro emits       | Why                                           |
| ------------------------------ | ----------------- | --------------------------------------------- |
| `count` (read)                 | `count.value`     | `count` is `Signal<number>`                   |
| `count++`                      | `count.value++`   | Assignment to signal                          |
| `count = 5`                    | `count.value = 5` | Assignment to signal                          |
| `doubled` (read)               | `doubled.value`   | `doubled` is `Computed<number>`               |
| `name` (read)                  | `name`            | `name` is `string` — not reactive, no rewrite |

**Outside `component()` — for composables — you use `.value` explicitly:**

```typescript
// composables/useCounter.ts
import { ref, computed, type Signal, type Computed } from "@typesugar/web";

export function useCounter(initial = 0) {
  const count = ref(initial);
  const doubled = computed(() => count.value * 2);

  function increment() {
    count.value++;
  }

  return { count, doubled, increment };
}
```

This is deliberate. Composable functions are shared infrastructure — they
should be explicit about what's reactive. You can read them and immediately
see the data flow. The `component()` boundary is where ergonomics win over
explicitness, because that's where developers spend most of their time.

**In the component that uses it — unwrapping kicks in again:**

```typescript
const Counter = component(() => {
  const { count, doubled, increment } = useCounter(0);

  // count and doubled are Signal/Computed — the macro unwraps them
  return html`
    <button onClick=${increment}>${count} × 2 = ${doubled}</button>
  `;
});
```

### Why This Beats Every Alternative

| Problem                      | React Hooks           | Vue Composition     | Svelte Runes           | Solid Signals       | typesugar           |
| ---------------------------- | --------------------- | ------------------- | ---------------------- | ------------------- | ------------------- |
| Positional identity          | Yes (call order)      | No (named refs)     | No (compiler)          | No (named signals)  | No (named refs)     |
| Re-execute everything        | Yes                   | No                  | No                     | No                  | No                  |
| Stale closures               | Yes                   | No                  | No                     | No                  | No                  |
| Manual dependency arrays     | Yes                   | No (auto-track)     | No (compiler)          | No (auto-track)     | No (auto-track)     |
| `.value` / `()` ceremony     | No (but `[val, set]`) | Yes (`.value`)      | No                     | Yes (`()`)          | No (macro unwraps)  |
| Works outside components     | Custom hooks only     | Yes (composables)   | Partial (`.svelte.ts`) | Yes (signals)       | Yes (composables)   |
| Share state without Provider | No (need Context)     | Yes (module export) | Yes (stores)           | Yes (module export) | Yes (module export) |
| Custom file format required  | No                    | No                  | Yes (`.svelte`)        | No                  | No                  |
| Type-checker aware           | No                    | No                  | No                     | No                  | Yes                 |

### Sharing State Across Components

Vue proved that the simplest way to share state is to export reactive values
from a module. No Context, no Provider, no store library ceremony:

```typescript
// stores/auth.ts
import { ref, computed, type Signal } from "@typesugar/web";

const token = ref<string | null>(null);
const user = computed(() => (token.value ? decodeJwt(token.value) : null));
const isLoggedIn = computed(() => token.value !== null);

export function useAuth() {
  return {
    token, // Signal<string | null>
    user, // Computed<User | null>
    isLoggedIn, // Computed<boolean>

    login: (creds: Credentials) =>
      fx(function* () {
        const result = yield* http.fetch<AuthResponse>("/api/login", {
          method: "POST",
          body: JSON.stringify(creds),
        });
        token.value = result.token;
        return result.user;
      }),

    logout: () => {
      token.value = null;
    },
  };
}
```

Any component that calls `useAuth()` gets the **same** reactive values —
because they're module-scoped singletons. When one component calls `login()`,
every component reading `isLoggedIn` updates automatically.

```typescript
const Navbar = component(() => {
  const { isLoggedIn, user, logout } = useAuth();

  return html`
    <nav>
      ${when(
        isLoggedIn,
        html`<span>Hi, ${user.name}</span>
          <button onClick=${logout}>Log out</button>`,
        html`<a href="/login">Sign in</a>`,
      )}
    </nav>
  `;
});
```

No Provider wrapping. No prop drilling. No Context ceremony.

### The `let` Shorthand

For simple local state that doesn't need to be shared, `let` inside
`component()` is syntactic sugar for `ref()`:

```typescript
const Counter = component(() => {
  let count = 0; // sugar for: const count = ref(0)
  let name = "world"; // sugar for: const name = ref("world")
  const PI = 3.14; // const + primitive = NOT reactive (no rewrite)
  const config = getConfig(); // const = NOT reactive

  return html` <button onClick=${() => count++}>${count}</button> `;
});
```

The rule: `let` inside `component()` becomes a signal. `const` never does.
This gives you Svelte-level ergonomics for the common case, while `ref()` /
`computed()` are available for anything more complex.

---

## Part 0.5: Component Definitions

typesugar supports multiple components per file with co-located styles — like
Vue/Svelte SFCs but in standard TypeScript files.

### TS-Compatible: Builder Pattern (Default)

The builder pattern uses `component($ => { ... })`. Every character is valid
TypeScript with full IDE support.

**Simple component:**

```typescript
const Avatar = component(($) => {
  $.props<{ src: string; size?: number }>();

  $.style = css`
    .avatar {
      border-radius: 50%;
      object-fit: cover;
    }
  `;

  $.view = ({ src, size = 40 }) => html`
    <img class="avatar" src=${src} width=${size} height=${size} />
  `;
});
```

**MVU component:**

```typescript
const Counter = component(($) => {
  $.model<{ count: number }>({ count: 0 });

  $.msg<{
    Increment: {};
    Decrement: {};
    Set: { value: number };
  }>();

  $.update = (model, msg) =>
    match(msg, {
      Increment: () => [{ count: model.count + 1 }],
      Decrement: () => [{ count: model.count - 1 }],
      Set: ({ value }) => [{ count: value }],
    });

  $.style = css`
    .counter {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .btn {
      width: 32px;
      height: 32px;
      font-size: 18px;
    }
  `;

  $.view = (model, { Increment, Decrement }) => html`
    <div class="counter">
      <button class="btn" onClick=${Decrement}>-</button>
      <span>${model.count}</span>
      <button class="btn" onClick=${Increment}>+</button>
    </div>
  `;
});
```

### Extended Syntax: `component Name { }` (Opt-In Preprocessor)

For teams that opt into the extended syntax layer, the preprocessor enables
a cleaner declarative form:

**Simple component:**

```typescript
component Avatar {
  props {
    src: string
    size: number = 40
  }

  style {
    .avatar { border-radius: 50%; object-fit: cover; }
  }

  view {
    <img class="avatar" src={src} width={size} height={size} />
  }
}
```

**MVU component:**

```typescript
component Counter {
  model {
    count: number = 0
  }

  msg {
    Increment
    Decrement
    Set { value: number }
  }

  update {
    Increment -> [{ count: model.count + 1 }]
    Decrement -> [{ count: model.count - 1 }]
    Set { value } -> [{ count: value }]
  }

  style {
    .counter { display: flex; gap: 8px; align-items: center; }
    .btn { width: 32px; height: 32px; font-size: 18px; }
  }

  view {
    <div class="counter">
      <button class="btn" onClick={Decrement}>-</button>
      <span>{model.count}</span>
      <button class="btn" onClick={Increment}>+</button>
    </div>
  }
}
```

The extended syntax is cleaner — `props` as a declaration block instead of a
generic type parameter, `update` with `->` pattern matching, raw CSS/JSX
without tagged template wrappers. But it requires the preprocessor and
language service plugin.

### Multiple Components Per File

Both syntax layers support multiple components per file. Private helpers
stay unexported. This is the key advantage over Vue/Svelte (one component
per file):

**TS-compatible:**

```typescript
// components/todo.ts
import { component, css, html, each } from "@typesugar/web";
import type { Todo, Filter } from "../domain/types";

// Private — not exported
const TodoItem = component(($) => {
  $.props<{ todo: Todo; onToggle: (id: string) => void }>();

  $.style = css`
    .item {
      padding: 12px;
      border-bottom: 1px solid #eee;
    }
    .done {
      text-decoration: line-through;
      opacity: 0.5;
    }
  `;

  $.view = ({ todo, onToggle }) => html`
    <li
      class=${todo.done ? "done item" : "item"}
      onClick=${() => onToggle(todo.id)}
    >
      ${todo.text}
    </li>
  `;
});

// Private
const FilterButtons = component(($) => {
  $.props<{ current: Filter; onSelect: (f: Filter) => void }>();

  $.style = css`
    .filters {
      display: flex;
      gap: 8px;
    }
    .active {
      background: var(--primary);
      color: white;
    }
  `;

  $.view = ({ current, onSelect }) => html`
    <div class="filters">
      ${each(
        ["all", "active", "done"] as Filter[],
        (f) => html`
          <button
            class=${f === current ? "active" : ""}
            onClick=${() => onSelect(f)}
          >
            ${f}
          </button>
        `,
      )}
    </div>
  `;
});

// Public — uses siblings directly
export const TodoList = component(($) => {
  $.model<{
    todos: Todo[];
    filter: Filter;
    saving: boolean;
  }>({ todos: [], filter: "all", saving: false });

  $.msg<{
    Toggle: { id: string };
    Add: { text: string };
    Added: { todo: Todo };
    SetFilter: { filter: Filter };
  }>();

  $.update = (model, msg) =>
    match(msg, {
      Toggle: ({ id }) => [{ ...model, todos: toggleTodo(model.todos, id) }],
      Add: ({ text }) => [
        { ...model, saving: true },
        api.createTodo(text).map((todo) => $.msg.Added({ todo })),
      ],
      Added: ({ todo }) => [
        { ...model, saving: false, todos: [...model.todos, todo] },
      ],
      SetFilter: ({ filter }) => [{ ...model, filter }],
    });

  $.style = css`
    .app {
      max-width: 500px;
      margin: 0 auto;
      padding: 20px;
    }
    .list {
      list-style: none;
      padding: 0;
    }
  `;

  $.view = (model, { Toggle, Add, SetFilter }) => {
    const visible = filterTodos(model.todos, model.filter);

    return html`
      <section class="app">
        <input
          placeholder="What needs to be done?"
          disabled=${model.saving}
          onKeyDown=${(e) => e.key === "Enter" && Add({ text: e.target.value })}
        />
        <ul class="list">
          ${each(
            visible,
            (todo) => html`
              <TodoItem todo=${todo} onToggle=${(id) => Toggle({ id })} />
            `,
          )}
        </ul>
        <FilterButtons
          current=${model.filter}
          onSelect=${(f) => SetFilter({ filter: f })}
        />
      </section>
    `;
  };
});
```

**Extended syntax (same example, opt-in preprocessor):**

```typescript
// components/todo.ts
import { each } from '@typesugar/web'
import type { Todo, Filter } from '../domain/types'

component TodoItem {
  props {
    todo: Todo
    onToggle: (id: string) => void
  }

  style {
    .item { padding: 12px; border-bottom: 1px solid #eee; }
    .done { text-decoration: line-through; opacity: 0.5; }
  }

  view {
    <li class={todo.done ? 'done item' : 'item'}
        onClick={() => onToggle(todo.id)}>
      {todo.text}
    </li>
  }
}

component FilterButtons {
  props {
    current: Filter
    onSelect: (f: Filter) => void
  }

  style {
    .filters { display: flex; gap: 8px; }
    .active { background: var(--primary); color: white; }
  }

  view {
    <div class="filters">
      {each(['all', 'active', 'done'], f =>
        <button class={f === current ? 'active' : ''}
                onClick={() => onSelect(f)}>{f}</button>
      )}
    </div>
  }
}

export component TodoList {
  model {
    todos: Todo[] = []
    filter: Filter = 'all'
    saving: boolean = false
  }

  msg {
    Toggle { id: string }
    Add { text: string }
    Added { todo: Todo }
    SetFilter { filter: Filter }
  }

  update {
    Toggle { id } -> [{ ...model, todos: toggleTodo(model.todos, id) }]
    Add { text } -> [
      { ...model, saving: true },
      api.createTodo(text).map(todo => Added { todo })
    ]
    Added { todo } -> [
      { ...model, saving: false, todos: [...model.todos, todo] }
    ]
    SetFilter { filter } -> [{ ...model, filter }]
  }

  style {
    .app { max-width: 500px; margin: 0 auto; padding: 20px; }
    .list { list-style: none; padding: 0; }
  }

  view {
    let visible = filterTodos(model.todos, model.filter)

    <section class="app">
      <input placeholder="What needs to be done?"
             disabled={model.saving}
             onKeyDown={(e) => e.key === 'Enter' && Add { text: e.target.value }} />
      <ul class="list">
        {each(visible, todo =>
          <TodoItem todo={todo} onToggle={(id) => Toggle { id }} />
        )}
      </ul>
      <FilterButtons current={model.filter}
                     onSelect={(f) => SetFilter { filter: f }} />
    </section>
  }
}
```

Both compile to identical output.

### Section Reference

Both syntax layers support the same sections:

| Section  | Builder (`$.`)      | Extended keyword | Required?             |
| -------- | ------------------- | ---------------- | --------------------- |
| Props    | `$.props<T>()`      | `props { }`      | For simple components |
| Model    | `$.model<T>(init)`  | `model { }`      | For MVU components    |
| Messages | `$.msg<T>()`        | `msg { }`        | For MVU components    |
| Update   | `$.update = ...`    | `update { }`     | For MVU components    |
| Styles   | `$.style = css\`\`` | `style { }`      | Optional              |
| View     | `$.view = ...`      | `view { }`       | Required              |

---

## Part 1: The Template System

### Tagged Template HTML with Compile-Time Parsing

The `html` tagged template macro parses HTML structure during compilation and
emits direct DOM creation code. No runtime template parsing. No virtual DOM.

```typescript
import { html, component, reactive } from "@typesugar/web";

const Greeting = component((name: string) => {
  return html`
    <div class="greeting">
      <h1>Hello, ${name}!</h1>
    </div>
  `;
});
```

**Compiles to:**

```typescript
function Greeting(name) {
  const _div = document.createElement("div");
  _div.className = "greeting";
  const _h1 = document.createElement("h1");
  _h1.textContent = "Hello, " + name + "!";
  _div.appendChild(_h1);
  return _div;
}
```

### Reactive Bindings

When the macro detects a reactive value (signal) in a template expression, it
wraps only that DOM update in a fine-grained effect. Static content is never
re-evaluated.

```typescript
const Counter = component(() => {
  let count = 0; // @reactive rewrites to signal

  return html`
    <button onClick=${() => count++}>Clicked ${count} times</button>
  `;
});
```

**Compiles to:**

```typescript
function Counter() {
  const count = signal(0);
  const _btn = document.createElement("button");
  _btn.addEventListener("click", () => count.set(count.get() + 1));

  _btn.appendChild(document.createTextNode("Clicked "));
  const _countText = document.createTextNode("0");
  _btn.appendChild(_countText);
  _btn.appendChild(document.createTextNode(" times"));

  effect(() => {
    _countText.data = String(count.get());
  });

  return _btn;
}
```

### Control Flow

Template control flow compiles to optimized DOM operations — keyed
reconciliation for lists, conditional mounting for branches, and automatic
cleanup on unmount.

```typescript
// when() and each() naturally live inside templates as partial content
html`
  ${when(isLoggedIn, html`<UserMenu user=${currentUser} />`)}

  ${each(items, item => html`
    <li key=${item.id}>${item.name}</li>
  `)}
`;

// match() works both ways:

// 1. As the return value — when it covers the entire component output
return match(asyncData) {
  Loading: ()  => html`<Spinner />`,
  Err:     (e) => html`<Alert level="error">${e.message}</Alert>`,
  Ok:      (d) => html`<DataTable rows=${d.rows} />`
};

// 2. Inline — when it's one part of a larger template
html`
  <header>${title}</header>
  ${match(asyncData) {
    Loading: ()  => html`<Spinner />`,
    Err:     (e) => html`<Alert level="error">${e.message}</Alert>`,
    Ok:      (d) => html`<DataTable rows=${d.rows} />`
  }}
  <footer>...</footer>
`;
```

The `match` macro enforces **exhaustive handling** at compile time. If
`asyncData` is `Loading | Ok<T> | Err<E>` and you forget a variant, the build
fails. No blank screens in production.

### Two-Way Binding

`bind:` attributes generate both the value setter and the appropriate event
listener, chosen by the type of the bound variable:

```typescript
html`
  <input bind:value=${searchQuery} />
  <input type="checkbox" bind:checked=${darkMode} />
  <select bind:value=${selectedCountry}>
    ${each(countries, (c) => html`<option value=${c.code}>${c.name}</option>`)}
  </select>
`;
```

### Scoped Styles via `css` Typeclass

The `css` tagged template macro processes styles at compile time — hashing
class names, scoping selectors, and extracting the output to static `.css`
files. Zero runtime CSS parsing.

The key insight: the **syntax** (the tagged template) is universal, but the
**processing backend** is a typeclass. Which CSS dialect gets compiled depends
on which `CssProcessor` instance is in scope — determined by your imports,
just like Scala 3 implicits.

```typescript
@typeclass
interface CssProcessor {
  /** Parse and transform CSS source into scoped output */
  process(source: string, scope: string): CssOutput;
}

interface CssOutput {
  /** The extracted CSS text (written to a static file at build time) */
  css: string;
  /** Map of original class names → scoped class names */
  classes: Record<string, string>;
}
```

**Plain CSS (default):**

```typescript
import { css } from "@typesugar/web";

const styles = css`
  .card {
    border-radius: 8px;
    padding: var(--spacing-md);
    &:hover {
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }
  }
`;

html`<div class=${styles.card}>...</div>`;
// styles.card compiles to the string literal "card_x7f2a"
```

**SCSS — just import the instance:**

```typescript
import { css } from "@typesugar/web";
import "@typesugar/web/scss"; // brings CssProcessor<Scss> into scope

const styles = css`
  $primary: #3b82f6;

  .card {
    background: $primary;
    .title {
      font-size: 1.5rem;
    }
    &--featured {
      border: 2px solid darken($primary, 10%);
    }
  }
`;

html`<div class=${styles.card}>...</div>`;
```

The SCSS instance runs the Sass compiler at build time via `comptime()`.
The output is the same: static CSS file + hashed class name strings. No
Sass runtime shipped to the client.

**Tailwind — same pattern:**

```typescript
import { css } from "@typesugar/web";
import "@typesugar/web/tailwind";

const styles = css`
  .card {
    @apply rounded-lg p-4 shadow-md hover:shadow-lg;
  }
  .title {
    @apply text-xl font-bold text-gray-900;
  }
`;
```

**Other backends follow the same pattern:**

| Import                           | Backend                | Compiles via                |
| -------------------------------- | ---------------------- | --------------------------- |
| `@typesugar/web` (default)       | Plain CSS with nesting | PostCSS at build time       |
| `@typesugar/web/scss`            | SCSS                   | Sass compiler at build time |
| `@typesugar/web/less`            | Less                   | Less compiler at build time |
| `@typesugar/web/tailwind`        | Tailwind directives    | Tailwind at build time      |
| `@typesugar/web/vanilla-extract` | Vanilla Extract        | VE compiler at build time   |

Because `CssProcessor` is a typeclass, users can define their own:

```typescript
@instance
const customProcessor: CssProcessor = {
  process(source, scope) {
    // Your custom CSS processing pipeline
    return { css: transformed, classes: mapping };
  }
};
```

All processing happens at compile time. At runtime, `styles.card` is
just the string `"card_x7f2a"` — a literal inlined by the macro.

### Transitions

`transition:` and `animate:` directives compile to Web Animations API calls,
inlined directly into mount/unmount logic. No animation library shipped.

```typescript
html`
  ${when(
    visible,
    html` <div transition:fade=${{ duration: 300 }}>Content</div> `,
  )}
  ${each(
    sortedItems,
    (item) => html` <li animate:flip key=${item.id}>${item.name}</li> `,
  )}
`;
```

---

## Part 2: The Effect System (The Core Innovation)

This is where typesugar fundamentally diverges from every existing web
framework.

### The Problem

Every web app is a mess of interleaved concerns:

- **State** — local component state, shared stores, URL state
- **Network** — API calls, WebSockets, SSE
- **Storage** — localStorage, IndexedDB, cookies
- **Navigation** — routing, history, deep links
- **Auth** — tokens, sessions, permissions
- **Analytics** — tracking, logging
- **Concurrency** — cancellation, debouncing, race conditions

In React, these are all tangled together in `useEffect` with manual dependency
arrays and no type-level tracking of what effects a component performs. In
Effect-TS, they're beautifully typed but carry ~100KB of runtime overhead.

### The Solution: Typed Effects That Compile Away

We introduce `Fx<Value, Error, Requirements>` — a type that describes an
effectful computation, what it can fail with, and what services it needs.

```typescript
type Fx<A, E = never, R = never>
```

At the type level, this tracks everything. At runtime after macro expansion,
it's just `Promise<A>` — or even synchronous code if the macro can prove it.

### Defining Services

Services are typeclasses. They describe capabilities without prescribing
implementation.

```typescript
@typeclass
interface HttpClient {
  fetch<T>(url: string, opts?: RequestInit): Fx<T, HttpError>;
}

@typeclass
interface AuthService {
  getToken(): Fx<string, AuthError>;
  refresh(): Fx<string, AuthError>;
}

@typeclass
interface Analytics {
  track(event: string, data?: Record<string, unknown>): Fx<void>;
}

@typeclass
interface Storage<T> {
  get(key: string): Fx<Option<T>>;
  set(key: string, value: T): Fx<void>;
}
```

### Composing Effects with Do-Notation

Every `yield*` binding chains effects, and the type system accumulates the
error and requirement types automatically.

```typescript
// TS-compatible (generators):
// Type: Fx<User, HttpError | AuthError, HttpClient & AuthService>
const fetchUser = (id: string) => fx(function*() {
  const token = yield* auth.getToken();
  const user = yield* http.fetch<User>(`/api/users/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  yield* analytics.track("user.viewed", { id });
  return user;
});

// Extended syntax (opt-in preprocessor):
const fetchUser = (id: string) => fx {
  token <- auth.getToken()
  user  <- http.fetch<User>(`/api/users/${id}`, {
               headers: { Authorization: `Bearer ${token}` }
           })
  _     <- analytics.track("user.viewed", { id })
  return user
}
```

**What the macro compiles this to:**

```typescript
const fetchUser = async (id: string) => {
  const token = await getToken();
  const user = await fetch(`/api/users/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => {
    if (!r.ok) throw new HttpError(r);
    return r.json();
  });
  track("user.viewed", { id });
  return user;
};
```

The `fx` block:

1. Resolves `auth`, `http`, `analytics` via `summon<>()` at compile time
2. Inlines the typeclass instance methods via `specialize()`
3. Flattens the monadic chain into sequential async/await
4. Eliminates the `Fx` wrapper entirely — it was only a type-level construct

### Providing Services

At the application boundary, you provide concrete implementations.
This is compile-time dependency injection — like Effect's Layers, but resolved
during the build, not at startup.

```typescript
// Production implementations
@instance const prodHttp: HttpClient = {
  fetch: (url, opts) => Fx.fromPromise(
    globalThis.fetch(url, opts).then(r => r.json())
  )
};

@instance const prodAuth: AuthService = {
  getToken: () => Fx.pure(localStorage.getItem("token") ?? ""),
  refresh:  () => Fx.fromPromise(refreshTokenFromServer())
};

// Test implementations — swap at compile time via cfg()
@instance @cfgAttr("test")
const testHttp: HttpClient = {
  fetch: (url) => Fx.pure(mockResponses[url])
};
```

### Error Handling

Errors are tracked in the type system. You must handle them — or explicitly
propagate them — before the `Fx` can be run.

```typescript
// Type-safe error recovery
const safeUser = fetchUser(id)
  .recover(HttpError, () => cachedUser)
  .recover(AuthError, () => redirectToLogin());

// Exhaustive error matching (compile error if you miss a case)
const handled = fetchUser(id).match({
  Ok: (user) => html`<UserCard user=${user} />`,
  HttpError: (e) => html`<Alert>Network error: ${e.status}</Alert>`,
  AuthError: () => html`<LoginPrompt />`,
});
```

### Resource Management

The `use` block compiles to try/finally, ensuring cleanup even on errors or
cancellation. Inspired by Cats Effect's `Resource` and Python's `with`.

```typescript
const processFile = fx(function* () {
  const handle = yield* use(openFile(path), (file) => file.close());
  const data = yield* handle.readAll();
  return parse(data);
});
```

**Compiles to:**

```typescript
const processFile = async (path) => {
  const handle = await openFile(path);
  try {
    const data = await handle.readAll();
    return parse(data);
  } finally {
    handle.close();
  }
};
```

### Structured Concurrency

Race conditions are the #1 source of bugs in async UI code. The effect system
provides structured concurrency primitives that compile to well-behaved
Promise patterns.

```typescript
const searchResults = fx(function* () {
  const query = yield* watch(searchInput);

  const results = yield* Fx.all(
    http.fetch<Results>(`/search?q=${query}`),
    http.fetch<Suggestions>(`/suggest?q=${query}`),
  );

  const fresh = yield* Fx.race(
    results,
    Fx.delay(3000).map(() => cachedResults),
  );

  return fresh;
});
```

**Compiles to:**

```typescript
const searchResults = async (query) => {
  const controller = new AbortController();
  try {
    const results = await Promise.all([
      fetch(`/search?q=${query}`, { signal: controller.signal }).then((r) =>
        r.json(),
      ),
      fetch(`/suggest?q=${query}`, { signal: controller.signal }).then((r) =>
        r.json(),
      ),
    ]);
    return await Promise.race([
      Promise.resolve(results),
      new Promise((r) => setTimeout(() => r(cachedResults), 3000)),
    ]);
  } catch (e) {
    controller.abort();
    throw e;
  }
};
```

---

## Part 3: Connecting Effects to the UI

Effects and signals are separate systems with a clean boundary between them:

- **Effects (`Fx`)** are pure descriptions of what to do — fetch data, write
  to storage, call an API. They don't know about signals or the DOM.
- **Signals (`ref`, `computed`)** are reactive state. They don't know about
  network calls or side effects.
- **Bridges (`resource`, `action`)** connect the two, managing lifecycle
  (loading states, cancellation, refetch, optimistic updates).

```
Effects (Fx)          Bridge           Signals              Template
─────────────         ──────           ───────              ────────
pure descriptions  →  resource()  →  Signal<Loading|Ok|Err>  →  html``
of what to do         action()       auto-tracks changes       auto-updates DOM
```

### Pattern 1: Read (Fetch + Display)

**Step 1 — Define the effect separately.** It's a pure description that
doesn't run, doesn't touch any signal, and is testable in isolation.

```typescript
// effects/users.ts
export const fetchUser = (id: string) =>
  fx(function* () {
    const token = yield* auth.getToken();
    const user = yield* http.fetch<User>(`/api/users/${id}`, authHeader(token));
    return user;
  });
// Type: (id: string) => Fx<User, HttpError | AuthError, HttpClient & AuthService>
```

**Step 2 — Wire it to a signal via `resource()`.** This is where the effect
meets the reactive world. `resource()`:

1. Runs the effect
2. Wraps the result in a `Signal<Loading | Ok<T> | Err<E>>`
3. Re-runs when reactive dependencies change (here, `props.id`)
4. Cancels the previous run if re-triggered
5. Cleans up on component unmount

```typescript
const UserProfile = component((props: { id: string }) => {
  const user = resource(() => fetchUser(props.id));

  return match(user) {
    Loading: () => html`<Skeleton lines=${3} />`,
    Err:     (e) => html`<ErrorBanner error=${e} retry=${user.refetch} />`,
    Ok:      (u) => html`
      <div class="profile">
        <Avatar src=${u.avatar} />
        <h1>${u.name}</h1>
        <p>${u.bio}</p>
      </div>
    `
  };
});
```

**What the macro compiles this to:**

```typescript
function UserProfile(props) {
  const user = signal({ _tag: "Loading" });
  let controller = null;

  effect(() => {
    if (controller) controller.abort();
    controller = new AbortController();
    user.value = { _tag: "Loading" };

    const token = localStorage.getItem("token") ?? "";
    fetch(`/api/users/${props.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then((r) => {
        if (!r.ok) throw new HttpError(r);
        return r.json();
      })
      .then((value) => {
        user.value = { _tag: "Ok", value };
      })
      .catch((error) => {
        if (error.name !== "AbortError") user.value = { _tag: "Err", error };
      });
  });

  // ... direct DOM code with conditional mounting ...
}
```

The `Fx` is gone. The `fx` block was inlined. The `summon<AuthService>()`
was resolved to `localStorage.getItem`. All that remains at runtime is a
signal, an effect, and a `fetch`.

### Pattern 2: Write (Mutate + Show Status)

The write direction: user does something → send it to the server → show
the result. `action()` is the bridge for writes, like `resource()` is for
reads.

**Step 1 — Define the mutation effect:**

```typescript
// effects/users.ts
export const updateUser = (id: string, data: Partial<User>) =>
  fx(function* () {
    const token = yield* auth.getToken();
    const updated = yield* http.fetch<User>(`/api/users/${id}`, {
      method: "PATCH",
      headers: authHeader(token),
      body: JSON.stringify(data),
    });
    return updated;
  });
```

**Step 2 — Wire it via `action()`:**

`action()` wraps an effect in a `Signal<Idle | Submitting | Ok<T> | Err<E>>`
and provides a `.submit()` method. Unlike `resource()`, it does NOT auto-run —
it only runs when explicitly triggered.

```typescript
const EditProfile = component((props: { id: string }) => {
  const user = resource(() => fetchUser(props.id));

  let name = '';
  let bio = '';

  watch(user, (u) => {
    if (u._tag === 'Ok') { name = u.value.name; bio = u.value.bio; }
  });

  const save = action((data: Partial<User>) => updateUser(props.id, data));

  return match(user) {
    Loading: () => html`<Skeleton />`,
    Err:     (e) => html`<ErrorBanner error=${e} />`,
    Ok:      (u) => html`
      <form onSubmit=${() => save.submit({ name, bio })}>
        <input bind:value=${name} />
        <textarea bind:value=${bio} />

        ${match(save.state) {
          Idle:       () => html`<button type="submit">Save</button>`,
          Submitting: () => html`<button disabled>Saving...</button>`,
          Ok:         () => html`<span class="success">Saved!</span>`,
          Err:        (e) => html`<span class="error">${e.message}</span>`
        }}
      </form>
    `
  };
});
```

### Pattern 3: Write-Then-Refetch

When a mutation succeeds, you often want to refetch the resource to get the
server's canonical state:

```typescript
const save = action((data: Partial<User>) => updateUser(props.id, data));

watch(save.state, (s) => {
  if (s._tag === "Ok") user.refetch();
});
```

### Pattern 4: Optimistic Update

For instant-feeling UIs, update the signal immediately and roll back on
failure:

```typescript
const save = action((data: Partial<User>) => updateUser(props.id, data), {
  optimistic: (data) => {
    user.mutate((current) => ({ ...current, ...data }));
  },
  rollback: () => {
    user.refetch();
  },
});
```

### Why Separate Effects from Signals?

It might feel like ceremony to define `fetchUser` in one file and wire it up
via `resource()` in another. Three reasons it's worth it:

**Testability.** The `fx` block is a pure description. Test it by providing
mock service instances — no DOM rendering needed:

```typescript
test("fetchUser calls API with auth header", async () => {
  const result = await runFx(fetchUser("123"), {
    auth: mockAuth,
    http: mockHttp,
  });
  expect(result).toEqual(mockUser);
});
```

**Reusability.** The same `fetchUser` effect works in a component (via
`resource()`), in a server route, in a CLI tool, or in a background job.
It doesn't know or care about signals.

**Type safety.** The `Fx` type accumulates errors and requirements through
composition. If `fetchUser` uses `AuthService` and `HttpClient`, and no
instances are provided, it's a compile error — not a runtime crash.

### Summary: The Four Patterns

| Pattern                | Bridge                   | Trigger                          | Signal type                             |
| ---------------------- | ------------------------ | -------------------------------- | --------------------------------------- |
| **Read**               | `resource()`             | Auto (reactive deps change)      | `Loading \| Ok<T> \| Err<E>`            |
| **Write**              | `action()`               | Manual (`.submit()`)             | `Idle \| Submitting \| Ok<T> \| Err<E>` |
| **Write-then-refetch** | `action()` + `watch()`   | Manual, then auto                | Same as above + resource refetch        |
| **Optimistic**         | `action({ optimistic })` | Manual with instant local update | Same, with rollback on failure          |

### Stores (Shared Reactive State)

Global state is a reactive signal with effect-based persistence. The
persistence layer compiles away based on the chosen backend.

```typescript
// Define a store with typed effects for persistence
const authStore = store({
  initial: { user: None, token: None },

  hydrate: fx(function* () {
    const token = yield* storage.get<string>("auth_token");
    const user = token.isSome()
      ? yield* http.fetch<User>("/api/me", authHeader(token.get()))
      : None;
    return { user, token };
  }),

  derived: (state) => ({
    isLoggedIn: state.token.isSome(),
    displayName: state.user.map((u) => u.name).getOrElse("Guest"),
  }),

  actions: {
    login: (creds: Credentials) =>
      fx(function* () {
        const result = yield* http.fetch<AuthResponse>("/api/login", {
          method: "POST",
          body: JSON.stringify(creds),
        });
        yield* storage.set("auth_token", result.token);
        return { user: Some(result.user), token: Some(result.token) };
      }),

    logout: () =>
      fx(function* () {
        yield* storage.remove("auth_token");
        return { user: None, token: None };
      }),
  },
});

// Using it in a component — the macro auto-subscribes to accessed fields
const Navbar = component(() => {
  const { isLoggedIn, displayName } = authStore.use();

  return html`
    <nav>
      ${when(
        isLoggedIn,
        html`<span>Welcome, ${displayName}</span>
          <button onClick=${authStore.logout}>Log out</button>`,
        html`<a href="/login">Sign in</a>`,
      )}
    </nav>
  `;
});
```

---

## Part 4: Server Integration

### Compile-Time Server/Client Boundary

Using `cfg()` and `@cfgAttr`, the same source file can contain both server
and client code. The compiler strips the irrelevant parts from each bundle.

```typescript
// This function exists ONLY in the server bundle
@cfgAttr("server")
async function getUser(id: string): Promise<User> {
  return db.query(sql`SELECT * FROM users WHERE id = ${id}`);
}

// The macro generates an RPC stub for the client bundle automatically
const user = resource(() => getUser(props.id));
// Server build: calls getUser directly
// Client build: calls fetch("/api/__rpc/getUser", { body: { id: props.id } })
```

### Type-Safe API Routes

Route handlers are `Fx` computations. The error types flow through to the
client, so the `resource` that consumes the API knows every possible failure.

```typescript
// server/routes/users.ts
export const getUser = route("GET", "/users/:id", (params) =>
  fx(function* () {
    const user = yield* db.query(
      sql`SELECT * FROM users WHERE id = ${params.id}`,
    );
    return match(user, {
      Some: (u) => Response.json(u),
      None: () => Response.error(404, "User not found"),
    });
  }),
);

// client/pages/user.ts — errors are typed!
const user = resource(() => api.getUser({ id: props.id }));
// typeof user: Resource<User, HttpError | NotFoundError>
```

### Form Actions (Remix-Style, But Typed)

```typescript
export const createPost = formAction(PostSchema, (data) =>
  fx(function* () {
    const post = yield* db.insert(sql`INSERT INTO posts ${values(data)}`);
    return redirect(`/posts/${post.id}`);
  }),
);

// In the component — progressive enhancement, works without JS
const NewPost = component(() => {
  return html`
    <form action=${createPost}>
      <input name="title" required />
      <textarea name="body" />
      <button type="submit">Publish</button>
    </form>
  `;
});
```

---

## Part 5: What Compiles Away vs. What Remains

### Compiles away entirely (zero-cost)

| Abstraction               | Compiled output                                |
| ------------------------- | ---------------------------------------------- |
| `Fx<A, E, R>` type        | `Promise<A>` or sync code                      |
| `fx(function*() { ... })` | `async/await` chain                            |
| `summon<HttpClient>()`    | Direct function reference                      |
| `specialize(fn)`          | Inlined method body                            |
| `match(x) { ... }`        | `if/else` chain                                |
| `html\`...\``             | `document.createElement` calls                 |
| `css\`...\``              | Static CSS file + string literal               |
| `cfg("server", a, b)`     | `a` or `b` (other branch dead-code eliminated) |
| `comptime(() => expr)`    | Literal value                                  |

### Minimal runtime (~2KB gzipped)

| Runtime               | Purpose                                |
| --------------------- | -------------------------------------- |
| `signal(value)`       | Reactive primitive (get/set/subscribe) |
| `effect(fn)`          | Auto-tracking reactive effect          |
| `batch(fn)`           | Batched updates                        |
| `reconcileList(...)`  | Keyed list diffing for `each()`        |
| `mount(node, target)` | Initial DOM mounting                   |

The entire framework runtime is smaller than React's `useState` hook alone.

---

## Part 6: Inspirations Map

| Feature                | Inspired by                      | Our advantage                                  |
| ---------------------- | -------------------------------- | ---------------------------------------------- |
| Reactivity as language | Svelte 5 runes                   | Type-aware; no custom file format              |
| Surgical DOM updates   | Solid.js                         | Same approach, but with typeclass integration  |
| Typed effects          | Effect-TS, ZIO                   | Zero runtime — compiles to async/await         |
| Do-notation            | Haskell, Scala                   | Already built (`let:/yield:` macros)           |
| Free monad DB ops      | Doobie (Scala)                   | Already built (ConnectionIO) with specialize   |
| Resource safety        | Cats Effect bracket              | Compiles to try/finally                        |
| Exhaustive matching    | Rust, OCaml, Elm                 | Pattern matching macros with compile errors    |
| Scoped styles          | Svelte, Vue SFC, Vanilla Extract | Typeclass-driven: CSS/SCSS/Tailwind via import |
| Form actions           | Remix, SvelteKit                 | Type-safe end-to-end with Fx errors            |
| Server/client split    | Next.js RSC                      | `cfg()` macro — no framework magic             |
| Service injection      | Effect Layers, Scala implicits   | Typeclass resolution at compile time           |
| Two-way binding        | Vue, Svelte                      | Type-aware (picks event by input type)         |
| Structured concurrency | Kotlin coroutines, Effect fibers | AbortController-based, compiled away           |
| Compile-time routing   | TanStack Router                  | `collectTypes()` + `comptime()`                |
| Zero-cost abstractions | Rust traits                      | `specialize()` + `inlineMethod()`              |
| Tagged template HTML   | Lit, htm                         | Parsed at compile time, not runtime            |

---

## Part 7: Developer Experience

### Error Messages

Because macros have access to the type checker, error messages can be
domain-specific and actionable:

```
error TS-SUGAR: Effect requirement not satisfied
  --> src/components/UserProfile.tsx:12:5

  12 |   token << auth.getToken();
                  ~~~~~~~~~~~~~~~~
  Your component uses AuthService, but no instance is provided.

  Help: Add an @instance for AuthService, or wrap this component
  in a provider:

    <AuthProvider>
      <UserProfile />
    </AuthProvider>
```

### DevTools

The expansion tracker (`globalExpansionTracker`) records every macro expansion.
A companion browser extension can show:

- What each component compiled to (before/after)
- Which effects are active and their current state
- The reactive dependency graph
- Which DOM nodes update when a signal changes

### IDE Support

The existing VSCode extension (`packages/vscode/`) provides:

- Syntax highlighting for `html` and `css` tagged templates
- Autocomplete inside templates (element names, attributes, components)
- Go-to-definition through macro expansions
- Inline type display for `Fx` error and requirement types
- Red squiggles for non-exhaustive `match` before you even build

---

## Implementation Roadmap

### Phase 1: Foundation (Template + Reactivity)

- [ ] `component($ => { })` builder pattern (TS-compatible):
  - `$.props<T>()`, `$.style`, `$.view` for simple components
  - `$.model<T>(init)`, `$.msg<T>()`, `$.update` for MVU components
- [ ] Auto-derive action handlers from `$.msg` type for use in `$.view`
- [ ] Effect runner — execute `Fx` values returned from `$.update`, dispatch results
- [ ] `html` tagged template macro — parse HTML, emit DOM creation code
- [ ] Reactive rewriting — detect signals in templates, emit fine-grained effects
- [ ] `each()`, `match` control flow in templates
- [ ] `bind:` two-way binding with type-aware event selection
- [ ] `css` tagged template macro with `CssProcessor` typeclass
- [ ] Default CSS instance — nesting, scoping, hash + extract at compile time
- [ ] SCSS instance (`@typesugar/web/scss`)
- [ ] Tailwind instance (`@typesugar/web/tailwind`)
- [ ] `transition:` / `animate:` directives → Web Animations API
- [ ] Minimal reactive runtime: signal, effect, batch (~2KB)

### Phase 2: Effect System

- [ ] `Fx<A, E, R>` type with error and requirement tracking
- [ ] `fx(function*() { })` generator-based do-notation (TS-compatible)
- [ ] `match(expr, { })` function call pattern matching (TS-compatible)
- [ ] Service resolution via `summon<>()` with `specialize()` inlining
- [ ] `resource()` bridge between Fx and reactive system
- [ ] `action()` for mutations with optimistic updates
- [ ] `use()` resource management (bracket → try/finally)
- [ ] Structured concurrency: `Fx.all`, `Fx.race` with AbortController
- [ ] Error recovery: `.recover()`, `.match()` with exhaustive checking

### Phase 3: Extended Syntax Layer (Opt-In)

- [ ] Preprocessor syntax block registration API (`defineSyntaxBlock`)
- [ ] Block parsing — `keyword name? { content }` pattern
- [ ] `fx { }` — `<-` bindings + `return` (do-notation sugar)
- [ ] `match expr { }` — `->` arms (pattern matching sugar)
- [ ] `component Name { }` — `props`, `model`, `msg`, `update`, `style`, `view` sections
- [ ] Source map preservation through transformations
- [ ] VSCode language service plugin for syntax blocks
- [ ] Custom syntax block API for user-defined blocks

### Phase 4: Server Integration

- [ ] `@cfgAttr("server")` / `@cfgAttr("client")` code splitting
- [ ] Auto-generated RPC stubs for server functions
- [ ] `route()` macro for type-safe API routes
- [ ] `formAction()` with validation and progressive enhancement
- [ ] SSR: compile templates to string concatenation on server
- [ ] Streaming SSR with `Fx` for async data

### Phase 5: Ecosystem

- [ ] `store()` — shared reactive state with effect-based persistence
- [ ] Router macro — compile-time route tree from `collectTypes()`
- [ ] DevTools browser extension
- [ ] ESLint rules for common mistakes
- [ ] Migration guide from React / Svelte / Vue

### Phase 6: Advanced

- [ ] Islands architecture — partial hydration via `@cfgAttr`
- [ ] View transitions API integration
- [ ] Service worker generation via `comptime()`
- [ ] Database integration via ConnectionIO (full-stack typed queries)
- [ ] Real-time via WebSocket effects with typed channels

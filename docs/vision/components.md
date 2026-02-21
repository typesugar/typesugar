# Components and Templates

> Multiple components per file with co-located styles — like Vue/Svelte SFCs but in standard TypeScript files.

## Component Definitions

### TS-Compatible: Builder Pattern (Default)

The builder pattern uses `component($ => { ... })`. Every character is valid TypeScript with full IDE support.

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

### Extended Syntax: `component Name { }` (Opt-In)

For teams that opt into the extended syntax layer, the preprocessor enables a cleaner declarative form:

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

### Multiple Components Per File

Both syntax layers support multiple components per file. Private helpers stay unexported:

```typescript
// components/todo.ts

// Private — not exported
const TodoItem = component(($) => {
  $.props<{ todo: Todo; onToggle: (id: string) => void }>();
  $.style = css`
    .item {
      padding: 12px;
    }
  `;
  $.view = ({ todo, onToggle }) => html`
    <li class="item" onClick=${() => onToggle(todo.id)}>${todo.text}</li>
  `;
});

// Public — uses siblings directly
export const TodoList = component(($) => {
  $.model<{ todos: Todo[] }>({ todos: [] });
  // ...uses TodoItem internally
});
```

---

## The Template System

### Tagged Template HTML with Compile-Time Parsing

The `html` tagged template macro parses HTML structure during compilation and emits direct DOM creation code. No runtime template parsing. No virtual DOM.

```typescript
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

When the macro detects a reactive value (signal) in a template expression, it wraps only that DOM update in a fine-grained effect:

```typescript
const Counter = component(() => {
  let count = 0;

  return html` <button onClick=${() => count++}>Clicked ${count} times</button> `;
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

Template control flow compiles to optimized DOM operations:

```typescript
html`
  ${when(isLoggedIn, html`<UserMenu user=${currentUser} />`)}

  ${each(items, item => html`
    <li key=${item.id}>${item.name}</li>
  `)}
`;

// match() for exhaustive variants
return match(asyncData) {
  Loading: ()  => html`<Spinner />`,
  Err:     (e) => html`<Alert level="error">${e.message}</Alert>`,
  Ok:      (d) => html`<DataTable rows=${d.rows} />`
};
```

The `match` macro enforces **exhaustive handling** at compile time. If you forget a variant, the build fails.

### Two-Way Binding

`bind:` attributes generate both the value setter and the appropriate event listener:

```typescript
html`
  <input bind:value=${searchQuery} />
  <input type="checkbox" bind:checked=${darkMode} />
  <select bind:value=${selectedCountry}>
    ${each(countries, (c) => html`<option value=${c.code}>${c.name}</option>`)}
  </select>
`;
```

---

## Scoped Styles via `css` Typeclass

The `css` tagged template macro processes styles at compile time — hashing class names, scoping selectors, and extracting output to static `.css` files.

The **processing backend** is a typeclass. Which CSS dialect gets compiled depends on which `CssProcessor` instance is in scope:

```typescript
@typeclass
interface CssProcessor {
  process(source: string, scope: string): CssOutput;
}

interface CssOutput {
  css: string; // Extracted CSS (written to static file)
  classes: Record<string, string>; // Original → scoped class names
}
```

### Plain CSS (default)

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
// styles.card compiles to "card_x7f2a"
```

### SCSS

```typescript
import { css } from "@typesugar/web/scss";

const styles = css`
  $primary: #3b82f6;

  .card {
    .title {
      color: $primary;
    }
  }
`;
```

### Tailwind

```typescript
import { css } from "@typesugar/web/tailwind";

const styles = css`
  .card {
    @apply rounded-lg p-4 shadow-md hover:shadow-lg;
  }
`;
```

---

## Transitions

The `transition:` directive generates Web Animations API code with automatic cleanup:

```typescript
html` ${when(isVisible, html`<div transition:fade={{ duration: 200 }}>Content</div>`)} `;
```

**Compiles to:**

```typescript
if (isVisible.get()) {
  const _el = document.createElement("div");
  _el.animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: 200,
    fill: "forwards",
  });
  // ...
  onCleanup(() => {
    _el.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 200,
      fill: "forwards",
    }).onfinish = () => _el.remove();
  });
}
```

---

## Section Reference

| Section | Builder Pattern (TS-compatible) | Extended Syntax (Preprocessor) |
| ------- | ------------------------------- | ------------------------------ |
| Props   | `$.props<T>()`                  | `props { name: Type }`         |
| Model   | `$.model<T>(init)`              | `model { name: Type = init }`  |
| Msgs    | `$.msg<T>()`                    | `msg { MsgName { payload } }`  |
| Update  | `$.update = (model, msg) => []` | `update { Msg -> [...] }`      |
| Style   | `$.style = css\`...\``          | `style { ... }`                |
| View    | `$.view = (props) => html\`\``  | `view { ... }`                 |

---

See also:

- [Reactivity](./reactivity.md) — signals, computeds, auto-unwrapping
- [Fx](./fx.md) — effects and async operations in components

# typesugar Vision

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

> A web framework where the framework disappears. You write declarative,
> type-safe, functional code. The compiler reduces it to exactly what you'd
> write by hand in vanilla JavaScript.

## Vision Documents

| Document                                      | Description                                           |
| --------------------------------------------- | ----------------------------------------------------- |
| [Reactivity](./reactivity.md)                 | State model design, signals, auto-unwrapping          |
| [Components](./components.md)                 | Component definitions, templates, styles, transitions |
| [Fx](./fx.md)                                 | Typed effect system that compiles away to async/await |
| [Server](./server.md)                         | Server integration, RPC, form actions, SSR            |
| [Effect Integration](./effect-integration.md) | Deep Effect-TS integration with typesugar             |

---

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

### Recommendation

Start with TS-compatible syntax. It works everywhere, from day one, with
zero tooling investment. Adopt extended syntax when:

- Your team is committed to typesugar long-term
- You've installed the language service plugin
- You want the cleanest possible DX for large component files

Both layers compile to identical output. You can mix them in the same
project — some files use extended syntax, others use TS-compatible.

---

## What Compiles Away vs. What Remains

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

## Inspirations Map

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

## Developer Experience

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

- [ ] `component($ => { })` builder pattern (TS-compatible)
- [ ] `html` tagged template macro — parse HTML, emit DOM creation code
- [ ] Reactive rewriting — detect signals in templates, emit fine-grained effects
- [ ] `css` tagged template macro with `CssProcessor` typeclass
- [ ] Minimal reactive runtime: signal, effect, batch (~2KB)

### Phase 2: Effect System

- [ ] `Fx<A, E, R>` type with error and requirement tracking
- [ ] `fx(function*() { })` generator-based do-notation (TS-compatible)
- [ ] Service resolution via `summon<>()` with `specialize()` inlining
- [ ] `resource()` bridge between Fx and reactive system
- [ ] Error recovery with exhaustive checking

### Phase 3: Extended Syntax Layer (Opt-In)

- [ ] Preprocessor syntax block registration API
- [ ] `fx { }` — do-notation sugar
- [ ] `match expr { }` — pattern matching sugar
- [ ] `component Name { }` — declarative component syntax
- [ ] VSCode language service plugin

### Phase 4: Server Integration

- [ ] `@cfgAttr("server")` / `@cfgAttr("client")` code splitting
- [ ] Auto-generated RPC stubs for server functions
- [ ] `formAction()` with validation and progressive enhancement
- [ ] SSR with streaming

### Phase 5: Ecosystem

- [ ] `store()` — shared reactive state
- [ ] Router macro — compile-time route tree
- [ ] DevTools browser extension
- [ ] Migration guides from React / Svelte / Vue

### Phase 6: Advanced

- [ ] Islands architecture — partial hydration
- [ ] View transitions API integration
- [ ] Database integration via ConnectionIO
- [ ] Real-time via WebSocket effects

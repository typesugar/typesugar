# PEP-013: Interactive Playground

**Status:** In Progress (Wave 2 complete)
**Date:** 2026-03-16
**Author:** Dean Povey

## Context

typesugar has comprehensive documentation and examples, but no way to try it interactively. Users must clone the repo, install dependencies, and build before seeing their first transformed output. This friction slows adoption and makes it harder to explore features.

An interactive playground would let users:

1. Write typesugar code (`.ts` with JSDoc macros or `.sts` with custom syntax)
2. See the transformed JavaScript output in real-time
3. Run the code and see results
4. Share examples via URL
5. Explore without installing anything

### Prior Art

| Project                                                       | Approach                      | Notes                            |
| ------------------------------------------------------------- | ----------------------------- | -------------------------------- |
| [TypeScript Playground](https://www.typescriptlang.org/play/) | Monaco + @typescript/sandbox  | Official, extensible via plugins |
| [Babel REPL](https://babeljs.io/repl)                         | CodeMirror + Babel in browser | Supports custom plugins from npm |
| [SWC Playground](https://play.swc.rs/)                        | Monaco + @swc/wasm            | Native Rust compiled to WASM     |
| [StackBlitz](https://stackblitz.com/)                         | WebContainers                 | Full Node.js in browser          |
| [CodeSandbox](https://codesandbox.io/)                        | WebContainers / microVMs      | Full dev environment             |

### typesugar-Specific Challenges

1. **Two file types**: `.ts` (JSDoc macros only) and `.sts` (custom syntax via preprocessor)
2. **Preprocessor**: Text-level transforms before TypeScript parsing
3. **Macro transformer**: AST transforms requiring type information
4. **Bundle size**: TypeScript (~10MB) + all macros (~200KB) + editor
5. **Type checking**: Full type information needed for `@typeclass`, `@impl`, `@deriving`

### Current Docs Setup

The docs use **VitePress 1.6.4** at `docs/`. Scripts:

- `pnpm docs:dev` — local dev server
- `pnpm docs:build` — production build
- `pnpm docs:preview` — preview build

No deployment configured yet (no GitHub Pages, Vercel, or Netlify).

## Approach Evaluation

### Option A: Pure Browser (Monaco + TypeScript)

Run the preprocessor and macro transformer entirely in the browser using the standard TypeScript compiler.

**Architecture:**

```
┌─────────────────────────────────────────────────────────┐
│                    Browser                               │
│                                                          │
│  ┌──────────┐   ┌──────────────┐   ┌────────────────┐  │
│  │  Monaco  │ → │ Preprocessor │ → │ Macro          │  │
│  │  Editor  │   │ (if .sts)    │   │ Transformer    │  │
│  └──────────┘   └──────────────┘   └────────────────┘  │
│        ↓                                   ↓            │
│  ┌──────────┐                      ┌────────────────┐  │
│  │  Output  │ ←─────────────────── │ TypeScript     │  │
│  │  Panel   │                      │ (browser)      │  │
│  └──────────┘                      └────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

**Pros:**

- No server infrastructure
- Works offline after initial load
- Full control over the experience
- Integrates naturally with VitePress

**Cons:**

- Large initial bundle (~12-15MB)
- Need to adapt transformer for browser (no fs access)
- Type checking may be slow for complex code
- Maintenance burden: keep browser bundle in sync

**Feasibility:** HIGH — The preprocessor uses MagicString (browser-compatible) and the TypeScript scanner. The transformer uses `ts.transform()` which is available in browser TypeScript. Some macros (`includeStr`, `includeJson`) use `fs` but can be disabled/mocked.

### Option B: WebContainers

Use StackBlitz WebContainers to run the full Node.js toolchain in the browser.

**Architecture:**

```
┌─────────────────────────────────────────────────────────┐
│                    Browser                               │
│                                                          │
│  ┌──────────┐   ┌────────────────────────────────────┐  │
│  │  Monaco  │ → │           WebContainer              │  │
│  │  Editor  │   │  ┌─────────────────────────────┐   │  │
│  └──────────┘   │  │  Node.js (WASM)             │   │  │
│        ↓        │  │  - pnpm/npm                 │   │  │
│  ┌──────────┐   │  │  - typesugar CLI            │   │  │
│  │  Output  │ ← │  │  - Full transformer         │   │  │
│  │  Panel   │   │  └─────────────────────────────┘   │  │
│  └──────────┘   └────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

**Pros:**

- Zero code adaptation — runs exactly as in local dev
- Can run full test suites
- Supports any file structure
- Future-proof (as typesugar evolves, playground stays in sync)

**Cons:**

- Larger runtime overhead
- Slower initial boot (~2-5s)
- Dependent on StackBlitz infrastructure
- May be overkill for simple examples

**Feasibility:** HIGH — WebContainers is stable and supports all major frameworks. The typesugar CLI already works in Node.js.

### Option C: TypeScript Playground Plugin

Build a plugin for the official TypeScript Playground at typescriptlang.org/play.

**Architecture:**

```
┌─────────────────────────────────────────────────────────┐
│           TypeScript Playground (typescriptlang.org)     │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Existing Monaco + TypeScript Infrastructure      │   │
│  │                                                   │   │
│  │  + typesugar Plugin                              │   │
│  │    - Preprocessor transform (pre-compile hook)   │   │
│  │    - Macro transformer (post-compile hook)       │   │
│  │    - Custom output panel                         │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

**Pros:**

- Leverage existing playground infrastructure
- Familiar UX for TypeScript users
- No hosting needed
- Automatic TypeScript version updates

**Cons:**

- Limited customization (must fit plugin model)
- Can't embed in our docs site
- No control over branding/UX
- `.sts` files may not integrate cleanly (playground expects `.ts`)
- Dependent on playground plugin API stability

**Feasibility:** MEDIUM — The playground-live-transformer plugin shows this is possible for custom transformers. However, the preprocessor step (text-level rewriting before parse) doesn't fit the plugin model cleanly.

### Option D: Hybrid (Browser UI + Server Transform)

Monaco editor in browser, transformation via server API.

**Architecture:**

```
┌────────────────────┐        ┌─────────────────────────┐
│      Browser       │        │        Server           │
│                    │        │                         │
│  ┌──────────┐      │  HTTP  │  ┌─────────────────┐   │
│  │  Monaco  │ ────────────→ │  │  typesugar CLI  │   │
│  │  Editor  │      │        │  │  (full Node.js) │   │
│  └──────────┘      │        │  └─────────────────┘   │
│        ↓           │        │          ↓             │
│  ┌──────────┐      │        │  ┌─────────────────┐   │
│  │  Output  │ ←────────────── │  │  Transform      │   │
│  │  Panel   │      │        │  │  Result         │   │
│  └──────────┘      │        │  └─────────────────┘   │
└────────────────────┘        └─────────────────────────┘
```

**Pros:**

- Small client bundle
- Transform always uses latest code
- Easy to add execution sandbox
- Works identically to local development

**Cons:**

- Requires server infrastructure
- Latency on every keystroke (debounce needed)
- Doesn't work offline
- Server costs / scaling concerns

**Feasibility:** HIGH — Straightforward to implement, but adds operational complexity.

### Recommendation: Option A (Pure Browser) with Option B Fallback

**Primary: Pure Browser** for the core playground experience:

- Fastest user experience (no network latency)
- Works offline
- Integrates directly into VitePress docs
- Acceptable for most examples

**Fallback: WebContainers** for advanced scenarios:

- Full project playground (multiple files, imports, tests)
- "Open in StackBlitz" button for complex examples
- Exact reproduction of local behavior

This gives the best UX for typical use (quick single-file exploration) while supporting power users who need the full environment.

## Design

### Playground Components

```
┌─────────────────────────────────────────────────────────────────┐
│                        Playground Page                           │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Toolbar                                                   │  │
│  │  [.ts ▼] [TypeScript 5.x ▼] [Run ▶] [Share] [Settings ⚙]  │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌─────────────────────────────┬─────────────────────────────┐  │
│  │                             │                              │  │
│  │  Input Editor               │  Output Tabs                 │  │
│  │  (Monaco)                   │  [JS] [AST] [Types] [Errors] │  │
│  │                             │                              │  │
│  │  /** @typeclass */          │  // Transformed output       │  │
│  │  interface Eq<T> {          │                              │  │
│  │    equals(a: T, b: T): ...  │  class Eq { ... }            │  │
│  │  }                          │                              │  │
│  │                             │                              │  │
│  │                             │                              │  │
│  └─────────────────────────────┴─────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Console Output (runtime execution results)                │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### File Type Toggle

| Mode       | Extension | Pipeline                         | Features                        |
| ---------- | --------- | -------------------------------- | ------------------------------- |
| TypeScript | `.ts`     | HKT rewriter → Macro transformer | JSDoc macros, HKT in generics   |
| Sugar      | `.sts`    | Preprocessor → Macro transformer | Custom operators, `F<_>` syntax |

The toggle affects syntax highlighting, which pipeline runs, and available examples.

### Browser Bundle Strategy

Create a dedicated browser bundle that:

1. **Includes:**
   - `@typesugar/preprocessor` (already browser-compatible)
   - `@typesugar/core` (registries, context)
   - `@typesugar/macros` (all macro implementations)
   - Transformer core (adapted for browser)
   - TypeScript compiler (browser build)

2. **Excludes / Mocks:**
   - `fs` operations → error with helpful message
   - `includeStr()`, `includeJson()` → disabled in playground
   - Disk cache → in-memory LRU cache
   - oxc backend → TypeScript only

3. **Lazy Loading:**
   - Monaco editor loaded on-demand
   - TypeScript worker loaded on-demand
   - lib.d.ts files fetched on-demand from CDN

**Estimated sizes:**

- Monaco editor: ~2MB (gzipped)
- TypeScript: ~3MB (gzipped)
- typesugar bundle: ~100KB (gzipped)
- lib.d.ts files: ~2MB (fetched on demand)

### VitePress Integration

Create a Vue component for the playground that can be embedded:

1. **Standalone page:** `docs/playground.md` — full-page playground
2. **Embedded examples:** `<Playground code="..." />` in any guide
3. **"Try it" buttons:** On code blocks that open in playground with the code

### URL Sharing

Encode playground state in URL hash:

```
https://typesugar.org/playground#code=...&mode=sts&ts=5.8
```

Use compression (e.g., lz-string) to keep URLs reasonable. Support both hash-based (no server) and short URLs (with server-side storage, future).

### Execution Sandbox

For running transformed code:

1. **iframe sandbox** — Run in isolated iframe with `sandbox` attribute
2. **Capture console** — Intercept console.log/error/warn
3. **Timeout** — Kill execution after 5 seconds
4. **Memory limit** — Terminate if memory exceeds threshold

## Waves

### Wave 1: Browser Bundle

**Tasks:**

- [x] Create `packages/playground/` package structure
- [x] Create browser-specific entry point that excludes Node.js APIs
- [x] Mock/disable `fs`-dependent macros (`includeStr`, `includeJson`)
- [x] Replace disk cache with in-memory LRU cache
- [x] Create TypeScript-only backend (no oxc in browser)
- [x] Bundle with esbuild targeting browser (ESM)
- [x] Test: preprocessor runs in browser environment
- [x] Test: macro transformer runs in browser environment
- [x] Verify bundle size is reasonable (<500KB gzipped for typesugar parts)

**Gate:**

- [x] `pnpm build` passes
- [x] Browser bundle loads in a test HTML page
- [x] `preprocess()` works on sample `.sts` code
- [x] `transform()` works on sample `.ts` code with macros

**Notes (Wave 1 implementation):**

- Bundle size: ~73KB gzipped (browser.js), well under 500KB target
- Created browser shims for `fs`, `path`, and `crypto` modules
- The `statSync` function is used by `@typesugar/core` for node_modules detection; the shim returns `undefined` which correctly disables that path in browser
- Test HTML page at `packages/playground/test/browser-test.html` loads TypeScript from esm.sh CDN

### Wave 2: Monaco Integration

**Tasks:**

- [x] Add `vite-plugin-monaco-editor` to docs dev dependencies
- [x] Create `docs/.vitepress/components/MonacoEditor.vue` component
- [x] Configure Monaco for TypeScript with typesugar lib.d.ts
- [x] Add custom `.sts` language definition (syntax highlighting)
- [x] Wire editor content changes to transformation pipeline
- [x] Display transformed output in read-only Monaco panel
- [x] Add file type toggle (`.ts` / `.sts`)

**Gate:**

- [x] Monaco editor renders in VitePress dev server
- [x] Typing in editor triggers transformation
- [x] Both `.ts` and `.sts` modes work
- [x] Syntax highlighting works for typesugar-specific syntax

**Notes (Wave 2 implementation):**

- Used `monaco-editor` + `@monaco-editor/loader` instead of `vite-plugin-monaco-editor` for better SSR compatibility with VitePress
- Custom `.sts` language definition includes typesugar-specific tokens: decorators (`@typeclass`, `@derive`), operators (`|>`, `<|`, `::`), and HKT syntax (`F<_>`)
- Custom themes (`typesugar-dark`, `typesugar-light`) with distinct highlighting for typesugar constructs
- Playground bundle required process shim for browser compatibility (added `browser-shims/process.ts`)
- Test page at `docs/playground-test.md` for verification

### Wave 3: Playground Page

**Tasks:**

- [ ] Create `docs/playground.md` with full-page layout
- [ ] Add toolbar: file type selector, TypeScript version, Run button
- [ ] Add output tabs: JS, AST (optional), Errors
- [ ] Add console output panel for runtime results
- [ ] Implement iframe execution sandbox
- [ ] Add error display with source mapping to original code
- [ ] Add keyboard shortcuts (Cmd+Enter to run, Cmd+S to share)

**Gate:**

- [ ] `/playground` route works in docs dev server
- [ ] Can type code, see transform, run result
- [ ] Errors show with correct line numbers
- [ ] Console output displays

### Wave 4: Sharing & Persistence

**Tasks:**

- [ ] Implement URL hash encoding with lz-string compression
- [ ] Add "Share" button that copies URL to clipboard
- [ ] Add "Copy Link" and "Copy Code" buttons
- [ ] Load state from URL hash on page load
- [ ] Add example presets dropdown (common typesugar patterns)
- [ ] LocalStorage: remember last code, settings, file type

**Gate:**

- [ ] Share URL works: paste URL → same code appears
- [ ] Example presets load correctly
- [ ] Settings persist across page reloads

### Wave 5: Embedded Playgrounds

**Tasks:**

- [ ] Create `<Playground>` component for embedding in docs
- [ ] Support `code` prop for initial content
- [ ] Support `mode` prop for `.ts` / `.sts`
- [ ] Support `readonly` prop for display-only examples
- [ ] Support `height` prop for sizing
- [ ] Add "Open in Playground" button to expand inline example
- [ ] Add "Try it" feature to existing code blocks in docs

**Gate:**

- [ ] `<Playground code="..." />` works in any markdown file
- [ ] Embedded playgrounds are appropriately sized
- [ ] "Open in Playground" navigates to full page with code

### Wave 6: Polish & Performance

**Tasks:**

- [ ] Add debouncing to transformation (avoid transforming on every keystroke)
- [ ] Add loading states for initial bundle fetch
- [ ] Add progress indicator for long transformations
- [ ] Implement Monaco web workers for non-blocking editor
- [ ] Add CDN fallback for TypeScript lib files
- [ ] Test on mobile (responsive layout)
- [ ] Accessibility audit (keyboard navigation, screen reader)
- [ ] Add error boundary for crash recovery

**Gate:**

- [ ] Smooth typing experience (no jank)
- [ ] Works on mobile viewport
- [ ] Handles edge cases gracefully (syntax errors, infinite loops)

### Wave 7: Documentation & Launch

**Tasks:**

- [ ] Update `README.md` with playground link
- [ ] Add playground link to docs navigation
- [ ] Create "Getting Started" examples for playground
- [ ] Add playground screenshot to README
- [ ] Write `docs/guides/playground.md` usage guide
- [ ] Add "Try in Playground" links to existing guide examples
- [ ] Deploy docs to typesugar.org (separate task, but dependency)

**Gate:**

- [ ] Playground is discoverable from homepage and docs
- [ ] Documentation explains playground features
- [ ] Key examples link to playground

### Wave 8 (Future): StackBlitz Integration

**Tasks:**

- [ ] Create StackBlitz template project with typesugar configured
- [ ] Add "Open in StackBlitz" button for complex examples
- [ ] Configure template with common typesugar packages
- [ ] Support multi-file examples

**Gate:**

- [ ] StackBlitz button works and opens configured project
- [ ] Multi-file examples load correctly

## Files Changed

| File                                             | Wave | Change                           |
| ------------------------------------------------ | ---- | -------------------------------- |
| `packages/playground/`                           | 1    | **New package** — Browser bundle |
| `packages/playground/package.json`               | 1    | Package config                   |
| `packages/playground/src/index.ts`               | 1    | Browser entry point              |
| `packages/playground/src/browser-transform.ts`   | 1    | Browser-adapted transformer      |
| `packages/playground/tsup.config.ts`             | 1    | Browser bundle config            |
| `docs/.vitepress/components/MonacoEditor.vue`    | 2    | **New** — Monaco wrapper         |
| `docs/.vitepress/components/Playground.vue`      | 3    | **New** — Full playground        |
| `docs/.vitepress/components/PlaygroundEmbed.vue` | 5    | **New** — Embeddable version     |
| `docs/.vitepress/config.ts`                      | 3    | Add playground to nav            |
| `docs/.vitepress/theme/index.ts`                 | 2    | Register components              |
| `docs/playground.md`                             | 3    | **New** — Playground page        |
| `docs/guides/playground.md`                      | 7    | **New** — Usage guide            |
| `README.md`                                      | 7    | Add playground link              |

## Security Considerations

### Code Execution

User code runs in the browser via an iframe sandbox:

- `sandbox="allow-scripts"` — No same-origin access
- No access to parent window, cookies, or localStorage of main page
- Timeout enforcement prevents infinite loops
- Memory limits prevent DoS

### URL Sharing

- Code is compressed and encoded, not encrypted
- Anyone with the URL can see the code
- No sensitive data should be shared via playground URLs
- Future: Add option to create private/ephemeral shares

### CDN Dependencies

- TypeScript lib files fetched from cdn.jsdelivr.net
- Monaco fetched from cdn.jsdelivr.net
- These are trusted CDNs with SRI (Subresource Integrity) support
- Consider hosting our own copies for reliability

## Consequences

### Benefits

1. **Lower barrier to entry** — Try typesugar without installing anything
2. **Better documentation** — Interactive examples teach better than static code
3. **Easier debugging** — Users can share playground links in bug reports
4. **Marketing tool** — Playgrounds are shareable, demonstrable
5. **Dogfooding** — We'll find browser compatibility issues faster

### Trade-offs

1. **Maintenance burden** — Browser bundle must stay in sync with main codebase
2. **Bundle size** — Initial load is ~5-7MB (acceptable with lazy loading)
3. **Feature parity** — Some macros (`includeStr`) won't work in playground
4. **Complexity** — New package, new components, new testing surface

### Alternatives Rejected

| Alternative                       | Why Rejected                                                       |
| --------------------------------- | ------------------------------------------------------------------ |
| Server-side only                  | Latency, infrastructure cost, doesn't work offline                 |
| TypeScript Playground plugin only | Can't embed in our docs, limited customization, `.sts` doesn't fit |
| CodeSandbox templates only        | Too heavy for simple examples, external dependency                 |
| No playground                     | Friction for new users, harder to demonstrate features             |

### Future Work

- **Multi-file support** — Edit multiple files, see imports resolve
- **Project templates** — Start from working examples (React, Effect, etc.)
- **Diff view** — Show before/after of transformations
- **Type hover** — Show types on hover in transformed output
- **AI assistant** — Help users write typesugar code
- **Collaborative editing** — Share live sessions

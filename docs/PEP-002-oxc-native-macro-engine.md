# PEP-002: Oxc-Native Macro Engine

**Status:** In Progress
**Updated:** 2026-03-13 (Wave 3 complete)
**Date:** 2026-03-12
**Author:** Dan Povey
**Depends on:** PEP-001 (.sts File Extension)

## Context

The typesugar macro transformer is built entirely on the TypeScript compiler API (`ts.createSourceFile`, `ts.visitEachChild`, `ts.factory`, `ts.Printer`). This works, but the TS compiler API is slow for the parsing and codegen steps that dominate macro expansion time. Meanwhile, [oxc](https://oxc.rs/) has emerged as a production-grade Rust toolchain for JavaScript/TypeScript with a parser 5-10x faster than tsc and native codegen with source maps.

The proposal is to build a **parallel Rust-native macro engine** using oxc for AST traversal, node creation, and codegen — while keeping macro expansion logic in TypeScript and retaining full `ts.TypeChecker` access for type-aware macros.

### How PEP-001 (.sts) simplifies this

PEP-001 introduced `.sts` files — a dedicated extension for files that use the lexical preprocessor (HKT, `|>`, `::`). The existing pipeline already handles the split:

1. `.sts` files go through the preprocessor, producing valid TypeScript + a source map
2. `.ts` files skip preprocessing entirely
3. **Both paths feed valid TypeScript into the macro transformer**

The macro transformer (and therefore the oxc engine) never sees custom syntax. It always receives valid TypeScript. This means the oxc engine is **file-extension-agnostic** — it doesn't need to know or care whether the input came from a `.ts` or a preprocessed `.sts` file.

The `.sts` routing and source map composition are the pipeline's responsibility, not the engine's. This eliminates an entire wave of work (previously Wave 5) and means all waves inherently support both `.ts` and `.sts` files from day one.

```
.ts source ─────────────────────────────────────┐
                                                │
.sts source → Preprocessor (JS, unchanged)      │
              ↓ valid TS + source map₁          │
              ──────────────────────────────────┤
                                                ↓
                                     ┌──────────────────────┐
                                     │ oxc engine (Rust)     │
                                     │ receives: valid TS    │
                                     │ parse → traverse →    │
                                     │ expand → codegen      │
                                     │ produces: JS + map₂   │
                                     └──────────────────────┘
                                                ↓
                              Pipeline composes map₁ ∘ map₂ (if .sts)
                                                ↓
                                          JS + source map
```

## Architecture

### The oxc engine (file-extension-agnostic)

The engine receives valid TypeScript and returns transformed JavaScript:

```
valid TypeScript string
    ↓
┌─────────────────────────────────────────────────────┐
│  Rust (napi-rs)                                     │
│  oxc_parser → oxc_semantic → oxc_traverse           │
│       ↓                                             │
│  detect macro sites:                                │
│  - JSDoc: /** @typeclass */, /** @impl */, etc.     │
│  - Calls: summon(), staticAssert(), compileError()  │
│  - Labels: let:, par:, seq:                         │
│  - Binary exprs: a + b (operator overloads)         │
│       ↓                                             │
│  ┌─ pure Rust ──────────────────────────────────┐   │
│  │ syntax-only macros: cfg, static-assert,      │   │
│  │ comptime, tailrec, syntax-macro              │   │
│  └──────────────────────────────────────────────┘   │
│       ↓ OR sync JS callback (type-aware macros)     │
│  ┌─────────────────────────────────────┐            │
│  │ JS: macro expand fn                 │            │
│  │  - receives MacroCallInfo (JSON)    │            │
│  │  - queries ts.TypeChecker           │            │
│  │  - returns { code, kind }           │            │
│  └─────────────────────────────────────┘            │
│       ↓                                             │
│  oxc_parser (parse expansion) → AstBuilder (splice) │
│       ↓                                             │
│  oxc_codegen → JS + source map                      │
└─────────────────────────────────────────────────────┘
```

### Key decisions

**Engine is extension-agnostic.** The oxc engine accepts `(source: string, filename: string)` — always valid TypeScript. The pipeline handles `.sts` preprocessing and source map composition. This means every wave supports both `.ts` and `.sts` files automatically.

**Boundary protocol.** JS macro functions receive structured context (call args as source text, JSDoc tag, type info) and return code strings. Rust parses the returned string with `oxc_parser` and splices it into the AST. This matches the dominant existing pattern — ~60% of macro expansion sites already use `ctx.parseExpression(codeString)`.

**Type checker stays in JS.** Macros that need types call `ts.TypeChecker` directly during their expansion callback. The Rust side never touches type checking.

**Sync callbacks.** napi-rs `Function<Args, Ret>` calls are synchronous on the main Node.js thread. The Rust traverser can call into JS mid-traversal, get the expansion result, and continue.

**Pure-Rust fast path.** Syntax-only macros (`cfg`, `static-assert`, `comptime`, `tailrec`, `syntax-macro`, `include`) run entirely in Rust with no JS boundary crossing.

**JSDoc is the macro syntax the engine sees.** PEP-001 established that `.ts` files use JSDoc only, and `.sts` decorator syntax is rewritten to JSDoc by the preprocessor. So the engine always detects `/** @typeclass */`, `/** @impl */`, `/** @deriving */`, etc. — never `@typeclass` decorators directly.

### Macro type-checker audit

| Needs TypeChecker (must call JS) | Syntax-only (can be pure Rust) |
|---|---|
| `typeclass` — instance resolution, method dispatch | `comptime` — AST evaluation |
| `specialize` — property extraction, method resolution | `quote` — template → code string |
| `extension` — extension method type inference | `static-assert` — compile-time assertion |
| `operators` — operand type for method dispatch | `cfg` / `config-when` — conditional compilation |
| `reflect` — type info extraction | `tailrec` — tail-call rewrite |
| `implicits` — resolved signatures | `syntax-macro` — pattern rewriting |
| `generic` / `auto-derive` — structural type analysis | `include` — file inclusion |
| `do-notation` — monad type inference | `verify-laws`, `coverage`, `primitives`, `module-graph` |
| `derive` (caller needs types to build DeriveTypeInfo) | |

### Monorepo placement

**Decision: Keep it in the monorepo** as `packages/oxc-engine/`.

napi-rs has [official pnpm monorepo support](https://github.com/napi-rs/package-template-pnpm). The engine imports types from `@typesugar/core`, integration tests use existing macro packages, and the pipeline/unplugin/CLI need to import from `@typesugar/oxc-engine`.

### Package structure

```
packages/oxc-engine/
├── Cargo.toml              # oxc, napi, napi-derive, serde, serde_json
├── package.json            # @typesugar/oxc-engine, napi build scripts
├── build.rs
├── src/
│   ├── lib.rs              # napi entry: transform(source, filename, callbacks)
│   ├── engine.rs           # Orchestration: parse → semantic → traverse → codegen
│   ├── traverse.rs         # Traverse impl: detect macro sites, dispatch
│   ├── jsdoc.rs            # JSDoc comment parsing and association with nodes
│   ├── protocol.rs         # MacroCallInfo / MacroExpansion serde types
│   ├── splice.rs           # Parse expansion strings, splice into AST
│   ├── source_map.rs       # Source map generation
│   └── syntax_macros/      # Pure-Rust macro implementations
│       ├── mod.rs
│       ├── cfg.rs
│       ├── static_assert.rs
│       └── comptime.rs
├── npm/                    # napi-rs platform-specific packages
├── __tests__/
│   └── engine.test.ts      # Snapshot tests: oxc output == TS pipeline output
└── index.ts                # JS entry: re-exports, type definitions
```

Root additions:
```
Cargo.toml                  # [workspace] members = ["packages/oxc-engine"]
rust-toolchain.toml         # Pin Rust version
```

## Waves

### Wave 1: Skeleton + Passthrough ✅

Set up the Rust crate, prove the parse-traverse-codegen pipeline works, and benchmark raw speed against tsc.

**Tasks:**
- [x] Scaffold `packages/oxc-engine/` using `napi new` with pnpm template
- [x] Add `Cargo.toml` workspace to monorepo root, `rust-toolchain.toml`
- [x] Implement `transform(source: string, filename: string)` → passthrough (parse + codegen, no macro expansion)
- [x] Wire into CI: install Rust toolchain, `cargo build`, `cargo test`
- [x] Add to `pnpm-workspace.yaml`
- [x] Benchmark: parse 10 real source files (both `.ts` and preprocessed `.sts`), compare wall time vs `ts.createSourceFile`
- [x] Benchmark: full parse + codegen passthrough vs `ts.createSourceFile` + `ts.Printer`
- [x] Verify: oxc parses preprocessed `.sts` output correctly (it's valid TS, but worth confirming operator placeholders like `__binop__()` parse fine)

**Gate:**
- [x] `pnpm build` succeeds including the oxc-engine package
- [x] `cargo test` passes
- [x] Passthrough produces valid roundtrip for example files (both `.ts` originals and preprocessed `.sts`)
- [x] Benchmark numbers documented

**Benchmark Results (2026-03-12):**
| Test case | oxc (ms) | tsc (ms) | Speedup |
|-----------|----------|----------|---------|
| Simple const | 0.012 | 0.034 | 2.79x |
| Function | 0.018 | 0.025 | 1.41x |
| Class | 0.048 | 0.078 | 1.65x |
| __binop__ | 0.034 | 0.035 | 1.04x |

### Wave 2: JSDoc Detection + Pure-Rust Syntax Macros ✅

The critical foundation: correctly detecting JSDoc macro annotations in oxc's AST, then implementing 2-3 syntax-only macros in pure Rust.

**Tasks:**
- [x] **Spike: JSDoc comment handling in oxc.** Verified that oxc's parser returns comments in `program.comments` with positions — confirmed we can match `/** @typeclass */` to the interface it precedes via span adjacency.
- [x] Implement `jsdoc.rs`: parse JSDoc comments, extract `@typeclass`, `@impl`, `@deriving`, `@cfg`, `@op` tags, associate with AST nodes by position
- [x] Implement macro-call detection in `traverse.rs`: recognize `staticAssert()`, `compileError()`, `compileWarning()` call expressions
- [x] Implement `cfg` macro in Rust (conditional compilation: remove annotated declarations when config flag is off)
- [x] Implement `static-assert` macro in Rust (evaluate condition at compile time, remove call or emit error)
- [x] Implement splice logic: text-based splicing for removing declarations and statements
- [x] Snapshot tests: verify cfg and static-assert behavior for `.ts` files

**Gate:**
- [x] JSDoc `@tag` annotations correctly associated with declarations in oxc's AST
- [x] `cfg` and `static-assert` macros functional (text-based splicing approach)
- [x] Snapshot tests pass (25 tests passing)

**Implementation Notes (2026-03-13):**
- JSDoc parsing extracts tags with values, associates with declarations via span adjacency
- `cfg` evaluates boolean expressions (`&&`, `||`, `!`, parentheses) against config flags
- `staticAssert` evaluates simple constant expressions (booleans, number comparisons, string equality)
- Complex expressions (arithmetic) marked as unevaluable with warning
- Text-based splicing used instead of AST mutation for Wave 2 (simpler, sufficient for syntax macros)
- NAPI-RS converts snake_case to camelCase: `source_map` → `sourceMap`, `cfg_config` → `cfgConfig`

### Wave 3: JS Callback Protocol ✅

Add sync JS callbacks so the Rust traverser can delegate to TypeScript macro functions. This unlocks type-aware macros.

**Tasks:**
- [x] Define `MacroCallInfo` serde type: `{ macroName, callSiteArgs: string[], jsDocTag?, filename, line, column }`
- [x] Define `MacroExpansion` serde type: `{ code: string, kind: 'expression' | 'statements' | 'declaration', diagnostics: [] }`
- [x] Implement sync JS callback dispatch in `lib.rs` using napi-rs `Function<String, String>` (JSON ser/de for the structured types)
- [x] Implement splice: text-based splicing with `MacroExpansion.code` replacement based on `kind`
- [x] Wire up `__binop__` macro as first type-aware test case (expression macro with args)
- [x] Implement the full `transformWithMacros()` JS API with macro callback

**Gate:**
- [x] `__binop__` expression macro works with JS callback protocol
- [x] JSDoc macros (@typeclass, @impl, etc.) work with JS callback protocol
- [x] Diagnostics from macros are forwarded correctly to the caller
- [x] Benchmark: 0.002-0.003ms per callback (target was <0.5ms) ✅

**Implementation Notes (2026-03-13):**
- `transformWithMacros(source, filename, options, callback)` accepts a JS function for macro expansion
- Protocol: callback receives JSON `MacroCallInfo`, returns JSON `MacroExpansion`
- Two kinds of macro sites: JSDoc-annotated declarations and expression macro calls (`__binop__`, `ops`)
- Expression macros pass args as source text strings
- 34 TypeScript tests, 51 Rust tests passing

### Wave 4: Core Macros + Pipeline Integration (In Progress)

Port the major macros and wire the oxc engine into the pipeline as an opt-in alternative.

**Tasks:**
- [ ] Port `typeclass` macro (JSDoc: `/** @typeclass */`, `/** @impl */`) — **blocked: see architectural note below**
- [ ] Port `extension` macro — extension method rewriting — **blocked: needs TransformationContext**
- [ ] Port `specialize` macro — method inlining — **blocked: needs TransformationContext**
- [ ] Port `derive` macro — receives pre-extracted DeriveTypeInfo from typeclass — **blocked: needs TransformationContext**
- [ ] Port `reflect` macro — type info extraction — **blocked: needs TransformationContext**

**Architectural Blocker:** Type-aware macros require `ts.TransformationContext`, which provides:
- `ts.visitEachChild()` for recursive transformation
- `ts.factory` bound to the transform context
- Context-aware hygiene and scope management

The callback-based oxc architecture doesn't have a TransformationContext because it doesn't use `ts.transform()`.

**Potential solutions (for future waves):**
1. **Hybrid fallback**: When type-aware macro detected, signal pipeline to fall back to TS transformer for that file
2. **Per-site ts.transform()**: Parse affected region, run mini-transform, extract result
3. **TransformationContext shim**: Create minimal mock context implementing only what macros use

For now, files with type-aware macros should use `backend: 'typescript'`.
- [x] Wire oxc engine into `TransformationPipeline` as alternative backend (`backend: 'oxc'` option)
- [x] Pipeline handles: preprocessor (for `.sts`) → oxc engine → source map composition — same flow as today but replacing the TS transformer step
- [x] Integration with unplugin: `backend: 'oxc'` option in plugin config
- [x] Snapshot test parity for ported macros (parity.test.ts)

**Gate (partial - infrastructure complete, major macros pending):**
- [x] Ported macros (cfg, staticAssert, __binop__) produce identical output through both pipelines
- [x] Tests pass for ported macros (parity.test.ts: 23 passed, 1 skipped)
- [x] Source maps correct — tested in parity tests
- [x] Mixed preprocessor syntax works via oxc pipeline (|>, ::)
- [ ] typeclass, extension, specialize, derive, reflect macros not yet ported

**Implementation Notes (2026-03-13 - Pipeline Integration):**
- Added `TransformBackend` type: `'typescript' | 'oxc'`
- Added `backend` option to `PipelineOptions` (default: `'typescript'`)
- Created `oxc-backend.ts` module with:
  - `createOxcMacroCallback()` — bridges oxc engine to existing macro system
  - `transformWithOxcBackend()` — convenience wrapper for `transformWithMacros`
  - `processBinopMacro()` — handles `__binop__` pipeline operator expansion
  - Placeholder handlers for JSDoc macros (to be ported)
- Expression macros (`__binop__`, `ops`) fully functional via oxc backend
- Syntax-only macros (`@cfg`, `staticAssert`) work with oxc backend
- 6 new pipeline tests for oxc backend behavior
- Unplugin integration: added `backend?: TransformBackend` option to `TypesugarPluginOptions`
- Re-exported `TransformBackend` type from both `@typesugar/transformer` and `unplugin-typesugar`
- Created `parity.test.ts` with 24 tests comparing TypeScript vs oxc backend output
  - Passthrough (no macros): simple const, functions, classes, interfaces, imports
  - Preprocessor syntax: `|>`, chained pipes, `::` (cons)
  - Syntax-only macros: `@cfg`, `staticAssert`
  - `__binop__` expansion: `|>`, `<|`, `::`, nested calls
  - Mixed scenarios, source maps, diagnostics
  - Known limitation: `<|` (reverse pipe) not supported by preprocessor

### Wave 5: Full Parity + Default

Port remaining macros, achieve full test parity, switch default.

**Tasks:**
- [ ] Port `implicits`, `generic`, `auto-derive`, `do-notation`
- [ ] Port remaining syntax macros to Rust: `comptime`, `tailrec`, `include`
- [ ] Diagnostic parity: all error messages match between pipelines
- [ ] Integration with CLI (`typesugar build/check/watch`)
- [ ] Performance benchmark suite: compare full transform times on example projects (`.ts` and `.sts`)
- [ ] Switch default pipeline to oxc (with `pipeline: 'ts'` escape hatch)
- [ ] Update AGENTS.md, docs/architecture.md to document dual pipeline

**Gate:**
- [ ] Full test suite passes with oxc engine as default
- [ ] No regressions in example projects
- [ ] Performance improvement documented (target: 2-5x overall transform speed)

## Files Changed

| File | Change |
|------|--------|
| `packages/oxc-engine/` | New package (Rust crate + napi bindings) |
| `Cargo.toml` (root) | New — Rust workspace |
| `rust-toolchain.toml` (root) | New — pin Rust version |
| `pnpm-workspace.yaml` | Add `packages/oxc-engine` |
| `.github/workflows/ci.yml` | Add Rust toolchain + `cargo build` + `cargo test` |
| `packages/transformer/src/pipeline.ts` | Add oxc engine as alternative backend, route via config |
| `packages/unplugin-typesugar/src/unplugin.ts` | Add `pipeline: 'oxc'` option |
| `packages/transformer/src/cli.ts` | Add `--pipeline oxc` flag |

## Consequences

### Benefits

1. **Faster macro expansion** — 5-10x for syntax-only macros (pure Rust), 2-5x overall
2. **Better source maps** — oxc_codegen has native source map support with proper span tracking
3. **Inherently supports both `.ts` and `.sts`** — engine is extension-agnostic; pipeline handles routing
4. **Path to WASM** — Rust engine compiles to WASM for a browser-based playground
5. **Ecosystem alignment** — oxc is becoming the standard (Vite/Rolldown, oxlint adoption)
6. **Decoupled from tsc internals** — less fragile than ts-patch

### Trade-offs

1. **Rust build toolchain required** — CI needs rustup, contributors need Rust installed (prebuilt binaries mitigate for users)
2. **Two codepaths** — until full parity, both pipelines must be maintained
3. **oxc API instability** — 0.x releases with breaking changes; must pin and update deliberately
4. **Serialization overhead** — JS callbacks for type-aware macros add JSON ser/de cost per call site
5. **More complex contributor experience** — Rust + TypeScript dual-language codebase

### Future work enabled

- **Browser playground** — WASM build of the oxc engine
- **Grammar-aware .sts parsing (PEP-003)** — fork oxc to parse `|>`, `::`, and `F<_>` directly, eliminating the JS preprocessor entirely and enabling single-pass `.sts` processing with better source maps
- **Incremental transform** — oxc's arena allocator enables efficient re-parsing of changed files
- **LSP in Rust** — long-term, the language service could use oxc for faster diagnostics

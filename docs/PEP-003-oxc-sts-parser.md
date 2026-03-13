# PEP-003: Oxc-Based .sts Parser

**Status:** Draft
**Date:** 2026-03-12
**Author:** Dan Povey
**Depends on:** PEP-001 (.sts File Extension)
**Enhances:** PEP-002 (Oxc-Native Macro Engine)

## Context

PEP-002 introduces an oxc-native macro engine that receives **valid TypeScript** — it's file-extension-agnostic. For `.sts` files, the existing JavaScript preprocessor (`@typesugar/preprocessor`) handles custom syntax (`|>`, `::`, `F<_>`) before the code reaches the engine. Source maps are composed (preprocessor map + engine map).

This works, but has limitations:

1. **Two-pass processing** — text preprocessing then AST transformation
2. **Source map composition** — adds complexity and potential accuracy loss
3. **Lexical-only preprocessing** — the preprocessor uses token heuristics for scope tracking, which is fragile for complex patterns (especially HKT `F<A>` → `Kind<F, A>` rewrites)
4. **Multi-arity HKT** — `F<_, _>` requires tracking arity through preprocessing, which is error-prone without a real parser

This PEP proposes **forking oxc** to add grammar-level support for typesugar's custom syntax. The forked parser handles `.sts` files natively, producing a desugared AST in a single pass with accurate source maps.

### Relationship to sugarcube

[sugarcube](https://github.com/dpovey/sugarcube) is an existing Rust-based preprocessor for typesugar that uses SWC. It handles the same custom syntax (`|>`, `::`, `F<_>`) via text preprocessing before SWC parsing.

This PEP creates a **shared `typesugar-syntax` crate** that both sugarcube and the forked oxc parser depend on. This ensures the syntax rules (operator precedence, HKT arity semantics, desugaring targets) are defined once and used consistently across both implementations.

## Key Decisions

### Fork management: Git fork

Fork oxc on GitHub (`dpovey/oxc`, branch `typesugar-syntax`). Reference from Cargo.toml:

```toml
oxc_parser = { git = "https://github.com/dpovey/oxc", branch = "typesugar-syntax" }
```

**Rationale:** Our changes are additive (new tokens, new expression branches) — they don't modify existing parse paths. Rebases will generally merge cleanly. A well-named branch can be upstreamed if TC39 standardizes the pipeline operator.

Alternatives considered:
- **Vendor + pin:** Too heavy — oxc is a large codebase
- **Cargo [patch]:** Fragile for parser internals, breaks when oxc restructures

### Desugar strategy: Inline during parse

The parser sees custom syntax and **immediately produces desugared AST nodes**:

| Input | Desugared AST |
|-------|---------------|
| `a \|> f` | `CallExpr(__binop__(a, "\|>", f))` |
| `1 :: 2 :: []` | `CallExpr(__binop__(1, "::", __binop__(2, "::", [])))` |
| `F<_>` in type params | `F` (identifier), arity stored in `HktMetadata` |
| `F<A>` where `F` is HKT | `Kind<F, A>` (type reference) |

**Rationale:** Minimal fork surface. Only the lexer and parser are modified — no changes to `oxc_ast`, `oxc_traverse`, `oxc_codegen`, or visitor traits. The standard AST means everything downstream works unchanged.

Alternative considered:
- **Custom AST nodes:** Would require modifying code-generated AST types, arena allocators, and visitor implementations. Much larger fork surface and harder to maintain.

### HKT arity tracking

HKT parameters like `F<_>` and `F<_, _>` have different arities (1 vs 2). The parser:

1. Recognizes `F<_, _>` in type parameter lists
2. Strips the `<_, _>` and records `{ name: "F", arity: 2 }` in `HktMetadata`
3. When encountering `F<A, B>` in type position where `F` is an HKT param, rewrites to `Kind<F, A, B>`

The arity metadata is returned alongside the `Program`:

```rust
pub struct ParseResult {
    pub program: Program,
    pub hkt_metadata: HashMap<String, HktInfo>,
    pub errors: Vec<OxcDiagnostic>,
}

pub struct HktInfo {
    pub arity: u8,
    pub span: Span,
}
```

### Shared typesugar-syntax crate

A new crate holds the syntax specification:

```
typesugar-syntax/
├── Cargo.toml
├── src/
│   ├── lib.rs
│   ├── operators.rs    # Pipeline (prec 1, left), Cons (prec 5, right)
│   ├── hkt.rs          # Arity rules, Kind<> encoding
│   └── syntax.rs       # ScSyntax feature flags
```

Both the forked oxc parser and sugarcube's `sc_parser` depend on this crate. Changes to syntax rules are made in one place.

## Architecture

### Single-pass .sts processing

```
.sts source
    ↓
┌──────────────────────────────────────────────────────┐
│  Forked oxc parser                                   │
│  - Lexer emits Pipeline, Cons tokens                 │
│  - Expression parser handles |> (prec 1) :: (prec 5) │
│  - Type param parser handles F<_>, F<_, _>           │
│  - Inline desugaring: |> → __binop__(), F<A> → Kind  │
│  - Standard AST output                               │
└──────────────────────────────────────────────────────┘
    ↓ Program + HktMetadata + source map
┌──────────────────────────────────────────────────────┐
│  oxc-engine (PEP-002)                                │
│  - Macro detection (JSDoc, calls, operators)         │
│  - Macro expansion (pure Rust or JS callback)        │
│  - Codegen                                           │
└──────────────────────────────────────────────────────┘
    ↓
  JS + single accurate source map
```

### .ts files unchanged

`.ts` files don't use custom syntax. They pass through the forked parser identically to published oxc — custom syntax code paths are never hit. This means:

- All existing oxc parser tests still pass
- No performance regression for `.ts` files
- The fork is a strict superset

### Integration with PEP-002

PEP-002's oxc-engine currently expects valid TypeScript input. With PEP-003:

- `.ts` files: published oxc or forked oxc (identical behavior)
- `.sts` files (PEP-003 disabled): JS preprocessor → valid TS → engine
- `.sts` files (PEP-003 enabled): forked oxc → desugared AST → engine

The engine API doesn't change. The difference is in the parser dependency and whether the JS preprocessor is invoked.

## Scope

### Custom syntax supported

| Syntax | Category | Desugaring |
|--------|----------|------------|
| `a \|> f` | Binary operator | `__binop__(a, "\|>", f)` |
| `h :: t` | Binary operator | `__binop__(h, "::", t)` |
| `F<_>` | HKT type param (arity 1) | `F` + metadata |
| `F<_, _>` | HKT type param (arity 2) | `F` + metadata |
| `F<A>` | HKT application | `Kind<F, A>` |
| `F<A, B>` | HKT application (arity 2) | `Kind<F, A, B>` |

### Operator precedence

| Operator | Precedence | Associativity |
|----------|------------|---------------|
| `\|>` | 1 (lowest) | Left |
| `::` | 5 | Right |

These are lower than all standard JS/TS binary operators except comma (0).

### Not in scope (handled elsewhere)

| Syntax | Handler |
|--------|---------|
| `@typeclass` decorator | PEP-001 preprocessor rewrites to JSDoc |
| `/** @typeclass */` JSDoc | PEP-002 macro engine |
| `Kind<TypeF, A>` → `Type<A>` | Macro expansion (runtime or type-level) |

## Waves

### Wave 1: Fork + Custom Tokens

Set up the oxc fork and add custom token recognition.

**Tasks:**
- [ ] Fork oxc on GitHub (`dpovey/oxc`, create `typesugar-syntax` branch from latest tag)
- [ ] Document fork maintenance process in AGENTS.md
- [ ] Add `Pipeline` token kind to `oxc_parser/src/lexer/kind.rs`
- [ ] Add `Cons` token kind to `oxc_parser/src/lexer/kind.rs`
- [ ] Modify lexer to emit `Pipeline` when seeing `|` followed immediately by `>`
- [ ] Modify lexer to emit `Cons` when seeing `:` followed immediately by `:`
- [ ] Add `_` recognition in type parameter context (for HKT parsing)
- [ ] Run oxc's full test suite — all tests must pass
- [ ] Create test fixtures: `.sts` files with custom syntax
- [ ] Test: custom tokens emitted correctly for `.sts` files
- [ ] Test: `.ts` files parse identically to published oxc

**Gate:**
- [ ] Fork builds successfully
- [ ] All oxc parser tests pass
- [ ] Custom tokens emitted for `|>` and `::`
- [ ] `.ts` file parsing unchanged

### Wave 2: Expression Parsing + Inline Desugaring

Parse custom operators as expressions and desugar inline to `__binop__()` calls.

**Tasks:**
- [ ] Add `Pipeline` and `Cons` to `BinaryOperator` handling in `oxc_parser/src/expression.rs`
- [ ] Implement precedence: Pipeline = 1, Cons = 5 (configurable via constants from `typesugar-syntax`)
- [ ] Implement associativity: Pipeline left, Cons right
- [ ] **Inline desugaring:** When parsing `a |> b`, immediately produce `CallExpr` for `__binop__(a, "|>", b)`
- [ ] Preserve source spans: the `CallExpr` span maps to the original `|>` expression
- [ ] Parse `F<_>` and `F<_, _>` in type parameter position
- [ ] Strip `<_>` / `<_, _>` and record arity in `HktMetadata` return value
- [ ] When parsing type references `F<A>` where `F` is in HktMetadata, rewrite to `Kind<F, A>`
- [ ] Handle multi-arity: `F<A, B>` where arity=2 → `Kind<F, A, B>`
- [ ] Snapshot tests: compare forked parser output vs JS preprocessor + published oxc
- [ ] Test all fixtures from `packages/preprocessor/tests/` and `sugarcube/tests/fixtures/`

**Gate:**
- [ ] `a |> f |> g` parses and desugars correctly (left-associative)
- [ ] `1 :: 2 :: []` parses and desugars correctly (right-associative)
- [ ] `F<_>` stripped, arity=1 recorded
- [ ] `F<_, _>` stripped, arity=2 recorded
- [ ] `F<A>` rewrites to `Kind<F, A>` when F is HKT
- [ ] Snapshot tests match JS preprocessor output

### Wave 3: Shared Crate + Sugarcube Integration

Extract syntax definitions into a shared crate and integrate with sugarcube.

**Tasks:**
- [ ] Create `typesugar-syntax` crate in monorepo (or as separate repo?)
- [ ] Define operator specs: `Pipeline { precedence: 1, assoc: Left }`, `Cons { precedence: 5, assoc: Right }`
- [ ] Define HKT rules: arity semantics, Kind encoding
- [ ] Define `ScSyntax` feature flags (pipeline, cons, hkt)
- [ ] Forked oxc parser depends on `typesugar-syntax`
- [ ] Migrate sugarcube to depend on `typesugar-syntax`
- [ ] Ensure sugarcube's `sc_parser` and forked oxc produce identical output for all fixtures
- [ ] Add `.sts` and `.stsx` extension handling to both parsers
- [ ] Document the shared crate API

**Gate:**
- [ ] `typesugar-syntax` crate published (or in monorepo)
- [ ] Both parsers produce identical output for all test fixtures
- [ ] Sugarcube tests pass with shared crate
- [ ] `.sts`/`.stsx` extensions recognized

### Wave 4: Pipeline Integration

Wire the forked parser into PEP-002's oxc-engine and the transformation pipeline.

**Tasks:**
- [ ] Add `parser: 'fork' | 'published'` option to oxc-engine config
- [ ] When `parser: 'fork'`: use forked oxc crates, `.sts` files parse natively
- [ ] When `parser: 'published'`: use published oxc crates, `.sts` files go through JS preprocessor
- [ ] Update `TransformationPipeline` to skip JS preprocessor when forked parser is active
- [ ] Source maps: single-pass (no composition needed with forked parser)
- [ ] Benchmark: forked parser vs JS preprocessor + published oxc
- [ ] Integration tests: mixed `.ts` and `.sts` projects
- [ ] Update unplugin: `parser: 'fork'` option
- [ ] Update CLI: `--parser fork` flag
- [ ] Make forked parser the default (with `--parser published` escape hatch)

**Gate:**
- [ ] Full test suite passes with forked parser
- [ ] Source maps trace to original `.sts` positions accurately
- [ ] Benchmark shows improvement (target: eliminate preprocessor overhead entirely)
- [ ] No regressions for `.ts` files

## Files Changed

| File | Change |
|------|--------|
| `dpovey/oxc` (external) | Fork with `typesugar-syntax` branch |
| `typesugar-syntax/` | New crate (location TBD — monorepo or separate) |
| `packages/oxc-engine/Cargo.toml` | Option to use forked oxc crates |
| `packages/oxc-engine/src/lib.rs` | Parser selection logic |
| `packages/transformer/src/pipeline.ts` | Skip preprocessor when forked parser active |
| `packages/unplugin-typesugar/src/unplugin.ts` | `parser: 'fork'` option |
| `AGENTS.md` | Document fork maintenance |

## Consequences

### Benefits

1. **Single-pass .sts processing** — no text preprocessing step
2. **Accurate source maps** — parser knows exact source positions
3. **Grammar-aware HKT** — proper scope tracking, arity handling, no heuristics
4. **Shared syntax spec** — sugarcube and oxc-engine use the same rules
5. **Foundation for future syntax** — can add new operators without text manipulation

### Trade-offs

1. **Fork maintenance** — must track oxc upstream, rebase periodically
2. **Two parser options** — published and forked, until forked is proven stable
3. **Rust dependency** — contributors working on parser need Rust knowledge
4. **oxc 0.x instability** — upstream breaking changes affect the fork

### Risk mitigation

- **Fork maintenance:** Changes are additive, rebases should be clean. Pin to specific upstream tags.
- **Upstream contribution:** If TC39 advances pipeline operator, contribute our work upstream.
- **Fallback:** PEP-002 works independently with the JS preprocessor. PEP-003 is an optimization, not a requirement.

## Open Questions

1. **typesugar-syntax crate location:** In typesugar monorepo, or separate repo that both typesugar and sugarcube depend on?
2. **Decorator rewriting:** Should `@typeclass` → `/** @typeclass */` move to the parser, or stay in a separate pass?
3. **Kind resolution:** `Kind<OptionF, number>` → `Option<number>` currently happens in macro expansion. Should some of this move to the parser for type-only files?

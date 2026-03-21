# PEP-020: Replace `__binop__` with Named Operator Macros

**Status:** In Progress
**Date:** 2026-03-19
**Author:** Claude (with Dean Povey)

## Context

The preprocessor currently rewrites all custom binary operators (`|>`, `::`, `<|`) to a single generic dispatch function:

```typescript
a |> f        →  __binop__(a, "|>", f)
head :: tail  →  __binop__(head, "::", tail)
f <| x        →  __binop__(f, "<|", x)
```

This has two problems:

1. **Ugly generated code.** `__binop__(__binop__(data, "|>", transform), "|>", validate)` is hard to read when inspecting build output. The operator meaning is buried in a string literal argument.

2. **Unnecessary indirection.** The macro's `expand()` function must parse the string literal at compile time to determine semantics. Each operator could simply be its own macro with direct semantics.

### Replacement

Each operator gets its own named macro:

| Operator | Old                      | New               | Fallback    |
| -------- | ------------------------ | ----------------- | ----------- |
| `\|>`    | `__binop__(a, "\|>", f)` | `__pipe__(a, f)`  | `f(a)`      |
| `::`     | `__binop__(a, "::", b)`  | `__cons__(a, b)`  | `[a, ...b]` |
| `<\|`    | `__binop__(f, "<\|", x)` | `__apply__(f, x)` | `f(x)`      |

Generated code becomes:

```typescript
__pipe__(__pipe__(data, transform), validate);
```

which reads as "pipe data through transform, then pipe that through validate" — immediately comprehensible.

### Not backward compatible

This is a breaking change. All references to `__binop__` are removed. No compatibility shim.

### Hygiene

The `__dunder__` naming convention is preserved to avoid collisions with user-defined identifiers. A user is extremely unlikely to define `__pipe__`, `__cons__`, or `__apply__` in their own code. If they do, the transformer will treat the call as a macro expansion — same behavior as before with `__binop__`.

## Waves

### Wave 1: Core Rename

**Tasks:**

- [x] `packages/macros/src/operators.ts` — Replace single `binopMacro` with three macros: `pipeOpMacro` (`__pipe__`), `consOpMacro` (`__cons__`), `applyOpMacro` (`__apply__`)
- [x] `packages/preprocessor/src/extensions/pipeline.ts` — Emit `__pipe__(left, right)` instead of `__binop__(left, "|>", right)`
- [x] `packages/preprocessor/src/extensions/cons.ts` — Emit `__cons__(left, right)` instead of `__binop__(left, "::", right)`
- [x] `packages/core/src/resolution-trace.ts` — Update comment referencing `__binop__`
- [x] `packages/core/src/diagnostics.ts` — Update any `__binop__` references
- [x] `packages/macros/src/coverage.ts` — Update `__binop__` references

**Gate:**

- [ ] `pnpm vitest run operators` passes
- [ ] `pnpm vitest run pipeline` passes

### Wave 2: Prettier Plugin

**Tasks:**

- [x] `packages/prettier-plugin/src/post-format.ts` — Recognize `__pipe__` and `__cons__` instead of `__binop__` for reversal
- [x] `packages/prettier-plugin/src/pre-format.ts` — Update doc comments
- [x] `packages/prettier-plugin/src/index.ts` — Update any references

**Gate:**

- [ ] `pnpm vitest run prettier` passes

### Wave 3: Tests

**Tasks:**

- [x] `tests/operators.test.ts`
- [x] `tests/sts-extension.test.ts`
- [x] `tests/red-team-preprocessor.test.ts`
- [x] `tests/red-team-prettier-plugin.test.ts`
- [x] `packages/preprocessor/tests/pipeline.test.ts`
- [x] `packages/preprocessor/tests/cons.test.ts`
- [x] `packages/preprocessor/tests/mixed.test.ts`
- [x] `packages/transformer/tests/pipeline.test.ts`
- [x] `packages/transformer/tests/pipeline-e2e.test.ts`
- [x] `packages/transformer/tests/language-service.test.ts`
- [x] `packages/playground/tests/transform.test.ts`
- [x] `packages/prettier-plugin/src/__tests__/format.test.ts`

**Gate:**

- [ ] `pnpm test` passes

### Wave 4: Documentation & Examples

**Tasks:**

- [x] `docs/guides/operators.md`
- [x] `docs/architecture.md`
- [x] `packages/preprocessor/README.md`
- [x] `packages/prettier-plugin/README.md`
- [x] `packages/preprocessor/examples/showcase.ts`
- [x] `packages/transformer/examples/showcase.ts`
- [x] `packages/unplugin-typesugar/examples/showcase.ts`
- [x] `packages/prettier-plugin/examples/showcase.ts`
- [x] `packages/eslint-plugin/examples/showcase.ts`
- [x] `.cursor/skills/preprocessor-guidelines/SKILL.md`
- [x] `peps/PEP-002-oxc-native-macro-engine.md`
- [x] `peps/PEP-003-oxc-sts-parser.md`

**Gate:**

- [ ] `rg '__binop__' --type ts --type md` returns zero hits (excluding test output files)

## Consequences

1. **Benefits** — Generated code is immediately readable; each macro is simpler (no string dispatch); fewer arguments per call
2. **Trade-offs** — Breaking change for anyone who wrote `__binop__` manually (unlikely — it's a compiler internal)
3. **Future work** — Adding new custom operators just means adding a new macro + preprocessor extension, no modification to a central dispatch function

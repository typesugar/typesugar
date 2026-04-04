# PEP-034: Language Service Parity — Unified SFINAE and Shared IDE Infrastructure

**Status:** Implemented
**Date:** 2026-04-04
**Author:** Claude (with Dean Povey)

## Context

typesugar provides IDE integration through two separate paths:

1. **LSP server** (`packages/lsp-server/src/server.ts`) — a standalone LSP protocol implementation. Used by the Zed extension for `.sts`/`.stsx` files and available as a fallback for any editor.
2. **TS plugin language service** (`packages/transformer/src/language-service.ts`) — a tsserver proxy that intercepts TypeScript language service calls. Used by VS Code, Zed (for `.ts` files), and any editor that delegates to tsserver.

Both paths perform the same conceptual work: transform code, map positions between original and transformed source, filter false-positive diagnostics (SFINAE), provide completions/hover/go-to-definition on transformed code. But they were built independently and have diverged:

- **SFINAE rule drift:** The LSP server registered 6 SFINAE rules; the TS plugin only had 4. The missing `createOperatorOverloadRule()` caused `@op`-annotated operator overloading to show TS2365 errors in `.ts` files (where the TS plugin handles diagnostics) but not in `.sts` files (where the LSP server handles them). The missing `createMacroDecoratorRule()` similarly leaked TS1206 errors. This was a silent regression — no test caught the discrepancy.
- **Feature gaps:** The LSP server provides macro-specific code actions, inlay hints, code lens, and semantic tokens that the TS plugin path cannot access.
- **Duplicated logic:** Both paths independently implement position mapping, diagnostic filtering, completion resolution, and code action generation.

The SFINAE drift was fixed ad-hoc (adding the two missing rules), but the root cause — no shared registration point — remains. The next new rule will drift again.

## Goals

1. **Eliminate SFINAE drift permanently** — a single function registers all rules; all consumers call it.
2. **Extract shared IDE logic** into a common module that both paths consume.
3. **Surface LSP-only features** in the TS plugin path where the API permits.
4. **Test parity** — a test that verifies both paths produce identical diagnostics for the same input.

## Non-Goals

- Rewriting the LSP server to use the TS plugin internally (or vice versa). The two paths exist for good reasons (protocol differences, `.sts` preprocessing).
- Exposing semantic tokens or code lens through the TS plugin (tsserver's plugin API doesn't support these).

---

## Wave 1: Unified SFINAE Registration

Extract all SFINAE rule registration into a single shared function. This is the targeted fix for the class of bug that caused the `@op` regression.

### 1A. Create `packages/core/src/sfinae-registration.ts`

**What:** A single `registerAllSfinaeRules(options?)` function that registers every built-in SFINAE rule.

```typescript
export interface SfinaeRegistrationOptions {
  /** Required for MacroGeneratedRule — maps transformed positions back to original */
  positionMapFn?: PositionMapFn;
}

export function registerAllSfinaeRules(options?: SfinaeRegistrationOptions): void {
  if (options?.positionMapFn) {
    registerSfinaeRuleOnce(createMacroGeneratedRule(options.positionMapFn));
  }
  registerSfinaeRuleOnce(createExtensionMethodCallRule());
  registerSfinaeRuleOnce(createMacroDecoratorRule());
  registerSfinaeRuleOnce(createNewtypeAssignmentRule());
  registerSfinaeRuleOnce(createOperatorOverloadRule());
  registerSfinaeRuleOnce(createTypeRewriteAssignmentRule());
}
```

**Why in `core`?** The `registerSfinaeRuleOnce` function and `SfinaeRule` type already live in `core`. The rule _constructors_ live in `macros`, so `core` would re-export a registration function that imports from `macros`. Alternatively, place this in `macros` (which already depends on `core`) and have all consumers import from `macros`. The latter avoids a circular dependency risk.

**Decision needed:** `core` or `macros`? Recommend `macros` since it already owns the rule implementations.

**Tasks:**

- [ ] Create `registerAllSfinaeRules()` in `packages/macros/src/sfinae-registration.ts`
- [ ] Export from `packages/macros/src/index.ts`
- [ ] Replace the ad-hoc registration in `packages/lsp-server/src/server.ts` (`registerSfinaeRules()` function, lines 512-527)
- [ ] Replace the ad-hoc registration in `packages/transformer/src/language-service.ts` (lines 382-418)
- [ ] Replace the ad-hoc registration in `packages/transformer/src/cli.ts` (`registerCliSfinaeRules()`, lines 310-316)
- [ ] Delete the now-unused per-site registration functions

### 1B. Parity test

**What:** A test that asserts all three consumers register the same set of SFINAE rules.

**Tasks:**

- [ ] Add a test in `packages/macros/tests/sfinae-registration.test.ts` that calls `registerAllSfinaeRules()` and verifies the returned/registered rules match the expected set by name: `MacroGenerated`, `ExtensionMethodCall`, `MacroDecorator`, `NewtypeAssignment`, `OperatorOverload`, `TypeRewriteAssignment`.
- [ ] Add a test that verifies TS2365 (`Operator '+' cannot be applied`) is suppressed for a file with `@op`-annotated typeclass + object operands, exercising the full diagnostic pipeline.

**Gate:**

- [ ] Code review
- [ ] Full test suite passes (`pnpm test`)
- [ ] `pnpm run typecheck` passes
- [ ] `pnpm run format:check` passes

---

## Wave 2: Shared IDE Infrastructure Module

Extract duplicated logic from the LSP server and language service into a shared module.

### 2A. Create `packages/lsp-common/` (or `packages/ide-support/`)

**What:** A new package containing IDE logic that both paths consume.

**Shared concerns to extract:**

| Concern                                    | LSP server location              | Language service location                    | Extractable?                                                                            |
| ------------------------------------------ | -------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------- |
| Position mapping (original ↔ transformed)  | `getMapper()`, `mapToOriginal()` | `getMapper()`, `positionMapFn`               | Yes — identical pattern                                                                 |
| Diagnostic filtering (`filterDiagnostics`) | `server.ts:588`                  | `language-service.ts` (via `evaluateSfinae`) | Yes — same `evaluateSfinae` call                                                        |
| Macro-specific code actions                | `computeExtraCodeActions()`      | Not present                                  | Yes — extract so TS plugin can use it                                                   |
| Completion item enrichment                 | `onCompletionResolve`            | Not overridden                               | Partially — TS plugin could call `getCompletionEntryDetails` with transformed positions |
| Document highlight kind mapping            | `server.ts:1290-1312`            | `language-service.ts:1404-1430`              | Yes — same TS→LSP kind conversion                                                       |

**Tasks:**

- [ ] Create `packages/lsp-common/` with `package.json`, `tsconfig.json`, `tsup.config.ts`
- [ ] Extract position mapping utilities (mapper creation, original↔transformed coordinate conversion)
- [ ] Extract `computeExtraCodeActions()` and supporting types
- [ ] Extract document highlight kind mapping
- [ ] Wire both `lsp-server` and `transformer/language-service.ts` to import from `lsp-common`
- [ ] Verify no circular dependencies (`lsp-common` depends on `core` and `macros` only)

### 2B. Surface macro-specific code actions in TS plugin

**What:** The LSP server provides code actions like "Expand macro", "Wrap in comptime", "Add @derive" via `computeExtraCodeActions()`. These are absent from the TS plugin path. After extracting to `lsp-common`, wire them into `getCodeFixesAtPosition()` in the language service.

**Tasks:**

- [ ] Import `computeExtraCodeActions` from `lsp-common` in `language-service.ts`
- [ ] Append macro-specific actions to the code fix results in `getCodeFixesAtPosition()`
- [ ] Map action format from internal representation to `ts.CodeFixAction`

### 2C. Surface completion entry details in TS plugin

**What:** The LSP server resolves completion items with full documentation via `getCompletionEntryDetails()`. The TS plugin doesn't override this, so macro-provided completions lack detail.

**Tasks:**

- [ ] Override `getCompletionEntryDetails()` in `language-service.ts`
- [ ] Map the position to transformed coordinates before calling the underlying TS method
- [ ] Return enriched details

**Gate:**

- [ ] Code review
- [ ] Full test suite passes (`pnpm test`)
- [ ] `pnpm run typecheck` passes
- [ ] `pnpm run format:check` passes
- [ ] Manual verification: VS Code shows macro code actions and completion details for `.ts` files

---

## Wave 3: Diagnostic Parity Test Suite

Establish a test harness that ensures both IDE paths produce identical diagnostic behavior.

### 3A. Diagnostic parity integration tests

**What:** A set of `.ts` files exercising every SFINAE rule category, run through both the LSP server's diagnostic pipeline and the TS plugin's diagnostic pipeline, asserting identical suppression behavior.

**Test cases:**

| File                  | Expected suppressed error       | SFINAE rule exercised |
| --------------------- | ------------------------------- | --------------------- |
| `op-overload.ts`      | TS2365 (`+` on Vector2D)        | OperatorOverload      |
| `extension-method.ts` | TS2339 (`.clamp()` on number)   | ExtensionMethodCall   |
| `newtype-assign.ts`   | TS2322 (number → UserId)        | NewtypeAssignment     |
| `opaque-type.ts`      | TS2322/TS2345 (@opaque type)    | TypeRewriteAssignment |
| `macro-decorator.ts`  | TS1206 (JSDoc decorator)        | MacroDecorator        |
| `macro-generated.ts`  | Any error at synthetic position | MacroGenerated        |

**Tasks:**

- [ ] Create `tests/diagnostic-parity/` directory with test fixture files
- [ ] Write `tests/diagnostic-parity.test.ts` that:
  1. For each fixture, runs the TS plugin language service path and collects diagnostics
  2. For each fixture, runs the LSP server diagnostic path and collects diagnostics
  3. Asserts both produce the same set of non-suppressed diagnostics
- [ ] Add to CI (runs as part of `pnpm test`)

### 3B. SFINAE rule completeness test

**What:** A meta-test that imports all `create*Rule` functions from `macros` and `core`, and asserts they are all present in `registerAllSfinaeRules()`. This catches any new rule that's added but not wired into the registration function.

**Tasks:**

- [ ] Grep or reflect over exports matching `create*Rule` pattern
- [ ] Assert each is called inside `registerAllSfinaeRules`
- [ ] Alternatively: `registerAllSfinaeRules` returns the list of registered rule names, and the test asserts it matches the full set of exported rule constructors

**Gate:**

- [ ] Code review
- [ ] Full test suite passes (`pnpm test`)
- [ ] `pnpm run typecheck` passes
- [ ] `pnpm run format:check` passes

---

## Wave 4: Zed Extension Enhancements

With shared infrastructure in place, improve the Zed experience.

### 4A. Register Zed extension for `.ts`/`.tsx` files

**What:** Currently the Zed extension only handles `.sts`/`.stsx`. For `.ts`/`.tsx` files, Zed falls back to its built-in TypeScript support (tsserver), which loads the TS plugin. This works for diagnostics (after Wave 1), but misses LSP-only features like code lens and inlay hints.

Consider registering the typesugar LSP as an _additional_ language server for `.ts`/`.tsx` in workspaces that have a `typesugar` dependency. This requires Zed extension API support for workspace detection.

**Tasks:**

- [ ] Investigate Zed extension API for conditional language server registration
- [ ] If supported: add `.ts`/`.tsx` language configs that activate when `typesugar` is in `package.json`
- [ ] If not supported: document the limitation and track upstream Zed issue

### 4B. Zed extension test coverage

**What:** The current Zed extension tests only validate static file structure (TOML fields, Rust source contents). Add tests that verify the LSP server starts and responds to basic requests.

**Tasks:**

- [ ] Add an integration test that spawns the LSP server, sends `initialize`, and verifies capabilities
- [ ] Add a test that sends a `textDocument/didOpen` with a file containing `@op` operator usage and verifies TS2365 is not in the published diagnostics

**Gate:**

- [ ] Code review
- [ ] Full test suite passes (`pnpm test`)
- [ ] `pnpm run typecheck` passes
- [ ] `pnpm run format:check` passes
- [ ] Zed extension loads and provides diagnostics for `.sts` files (manual verification)

---

## Summary

| Wave | Scope                          | Risk                         | Effort       |
| ---- | ------------------------------ | ---------------------------- | ------------ |
| 1    | SFINAE registration extraction | Low — mechanical refactor    | Small        |
| 2    | Shared IDE module extraction   | Medium — new package, wiring | Medium       |
| 3    | Diagnostic parity tests        | Low — test-only              | Small-Medium |
| 4    | Zed extension improvements     | Medium — depends on Zed API  | Variable     |

Waves 1 and 3 can proceed independently. Wave 2 should follow Wave 1 (uses the shared registration). Wave 4 depends on Wave 2 for the shared infrastructure but Wave 4A (Zed API investigation) can start in parallel.

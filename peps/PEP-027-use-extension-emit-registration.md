# PEP-027: Emit Extension Registration from `"use extension"` Files

**Status:** Draft
**Date:** 2026-03-29
**Author:** Claude (with Dean Povey)
**Depends on:** PEP-011 (Extension Methods)

## Context

Extension methods in typesugar work via the `"use extension"` file-level directive. When the transformer compiles a file containing this directive, it knows that all exported functions in that file are extension methods and rewrites dot-syntax calls accordingly:

```typescript
// packages/std/src/extensions/number.ts
"use extension";

export function clamp(self: number, min: number, max: number): number { ... }
export function isEven(self: number): boolean { ... }
```

```typescript
// user code
import { clamp } from "@typesugar/std";
(95).clamp(0, 100); // → clamp(95, 0, 100)
```

### Problem

When a user's project imports `@typesugar/std` from its **built dist** (not from source), the `"use extension"` directive is absent — it only exists in the `.ts` source files, not in the compiled `.js` or `.d.ts` output. The transformer's import-scoped resolution fails because it can't detect that `clamp` came from an extension file.

### Current Workaround

A hardcoded `packages/std/src/register-extensions.ts` file manually lists all 107 extension methods and registers them at module load time via `globalThis.__typesugar_registerExtension`. This works but:

1. **Manual maintenance** — adding a new extension function requires updating this list
2. **Easy to drift** — no validation that the list matches actual exports
3. **Not scalable** — every package with `"use extension"` files would need its own hardcoded list

### Design Goal

When the transformer compiles a `"use extension"` source file, it should **emit registration calls** in the compiled output. The dist then self-registers its extensions on import, with no hardcoded lists or manual maintenance.

## Waves

### Wave 1: Emit Registration in Transformer

**Tasks:**

- [ ] In `packages/transformer/src/index.ts`, modify `visitStatementContainer` to detect when the current file has `"use extension"` directive (via `globalResolutionScope.hasUseExtension(fileName)`)
- [ ] After processing all statements, scan the output for exported function declarations
- [ ] For each exported function with at least one parameter, extract the function name and first parameter's type annotation
- [ ] Emit a `globalThis.__typesugar_registerExtension?.({ methodName, forType })` call as an additional statement
- [ ] Handle both `function` declarations and `const` arrow function exports

**Gate:**

- [ ] After building `@typesugar/std`: `grep "__typesugar_registerExtension" packages/std/dist/extensions/number.js` shows registration calls
- [ ] Registration calls include correct `forType` values (e.g., `"number"` for clamp, `"string"` for capitalize)

### Wave 2: Delete Hardcoded List

**Tasks:**

- [ ] Delete `packages/std/src/register-extensions.ts`
- [ ] Remove `import "./register-extensions.js"` from `packages/std/src/index.ts`
- [ ] Verify `standaloneExtensionRegistry` is still populated after importing `@typesugar/std` from dist

**Gate:**

- [ ] `npx vitest run tests/playground-examples.test.ts` — extension.ts example passes (156+ tests pass)
- [ ] No hardcoded extension lists anywhere in the codebase

### Wave 3: Handle Edge Cases

**Tasks:**

- [ ] Handle `export { fn }` re-exports (common in index.ts barrel files)
- [ ] Handle `export * from "./number"` wildcard re-exports
- [ ] Handle overloaded functions (multiple signatures)
- [ ] Add test for a minimal `"use extension"` file to verify the emit
- [ ] Verify that `.d.ts` files (declaration-only) don't emit registration (only `.ts`/`.js` source)

**Gate:**

- [ ] All playground examples pass
- [ ] CI green on all Node versions
- [ ] New extension functions added to `@typesugar/std` automatically register without manual updates

## Files Changed

| File                                      | Change                                              |
| ----------------------------------------- | --------------------------------------------------- |
| `packages/transformer/src/index.ts`       | Emit registration calls for `"use extension"` files |
| `packages/std/src/register-extensions.ts` | DELETE                                              |
| `packages/std/src/index.ts`               | Remove register-extensions import                   |

## Consequences

### Benefits

- Zero maintenance for extension registration
- New extensions automatically register when the package is built
- Any package can use `"use extension"` and get automatic registration in dist
- Eliminates the hardcoded 107-method list that could drift

### Trade-offs

- Compiled output is slightly larger (one registration call per exported function)
- Registration calls execute at module load time (minimal perf impact — they're idempotent)
- Requires the `globalThis.__typesugar_registerExtension` hook (already exists)

### Future Work

- Consider extending this pattern to `@extension` decorator emit (currently only handles `"use extension"` directive)
- Could generate `.d.ts` annotations so the transformer can detect extensions from declaration files without runtime registration

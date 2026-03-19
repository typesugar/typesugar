# PEP-019: Output Quality — Valid TypeScript, Cleaner Codegen

**Status:** Done (Waves 1–5 complete)
**Date:** 2026-03-18
**Author:** Claude (with Dean Povey)

## Context

The transformer produces correct code, but it's not always _good_ code. When users inspect the JS/TS output in the playground or in their build artifacts, they see:

1. **Invalid TypeScript after `@opaque` erasure** — `Some(x)` erases the constructor but leaves the type annotation, producing `const discount: Option<Money> = new Money(500, "USD")` which doesn't typecheck.

2. **Ugly generated variable names** — `match()` emits `__typesugar_m_s2_0__` when `_s` would suffice. The long mangled names exist to avoid shadowing, but the common case doesn't need them.

3. **Redundant guard expressions in `match()`** — Every arm repeats `typeof x === "object" && x !== null && "kind" in x`. For a discriminated union on `kind`, the `typeof`/null/`in` checks should happen once, and each arm should only check the discriminant value.

4. **Wrong null check** — `!== null` misses `undefined`. Should be `!= null` (loose equality catches both).

5. **Typeclass instances not inlined at call sites** — Auto-derived `eqPoint` generates a dictionary object that persists at runtime. `eqPoint.equals(p1, p2)` should inline to `p1.x === p2.x && p1.y === p2.y` at the call site, per our zero-cost philosophy.

These aren't correctness bugs — the output runs correctly. But they violate two principles: (a) output should be valid TypeScript in strict mode, and (b) output should look like what a human would write.

### The "strict output" goal

We want an optional strict mode where the transformer guarantees its output is valid TypeScript (passes `tsc --strict` with no errors). This matters for:

- Playground users who expect to copy-paste the output
- Debugging — invalid output is confusing even when it runs
- Trust — if the output looks wrong, users don't trust the tool

## Waves

### Wave 1: `@opaque` Type Annotation Erasure

**Problem:** When `Some(x)` erases to `x`, the `Option<T>` type annotation becomes a lie.

```typescript
// Input:
const discount: Option<Money> = Some(new Money(500, "USD"));

// Current output (INVALID TypeScript):
const discount: Option<Money> = new Money(500, "USD");

// Should be one of:
const discount = new Money(500, "USD"); // Option A: strip annotation
const discount: Money | null = new Money(500, "USD"); // Option B: rewrite to underlying
```

Option A (strip annotation) is simpler and always correct. Option B is more informative but requires knowing the underlying type at the rewrite site.

**Tasks:**

- [x] In the `@opaque` constructor erasure path (`tryRewriteOpaqueConstructor` in `rewriting.ts`), when the erasure changes the RHS of a variable declaration, also erase or rewrite the type annotation on the LHS
- [x] Option A: if the variable declaration has a type annotation matching the opaque type, remove it (let TypeScript infer)
- [ ] Option B (stretch): rewrite `Option<Money>` to the underlying `Money | null` using `TypeRewriteEntry.underlyingTypeText`
- [x] Add tests: variable declarations, function parameters, return types
- [ ] Verify playground output with Full Stack example

**Gate:**

- [x] `const discount: Option<Money> = Some(x)` transforms to `const discount = x` (no type error)
- [x] Existing opaque tests still pass
- [x] `pnpm vitest run opaque transparent` passes

### Wave 2: Match Variable Naming — Shorter, Smarter

**Problem:** `ctx.generateUniqueName("m")` produces `__typesugar_m_0__` which is verbose. For a scrutinee like `s`, the natural name is `_s`.

**Tasks:**

- [x] In `match-v2.ts`, when the scrutinee is a simple identifier (e.g., `s`), try `_s` first. Only fall back to `generateUniqueName` if `_s` would shadow an existing binding in the enclosing scope.
- [x] For non-identifier scrutinees (expressions, property accesses), use `_m` or `_v` as a short prefix, falling back to `generateUniqueName` on collision.
- [x] Add a helper: `ctx.tryShortName(preferred: string): ts.Identifier` — returns the preferred name if it doesn't conflict, otherwise falls back to `generateUniqueName`.
- [x] Update regex and extractor temp names similarly (`_r` instead of `__typesugar_r_0__`, `_ext` instead of `__typesugar_ext_0__`).

**Gate:**

- [x] `match(s)` with simple identifier scrutinee emits `const _s = s;` not `const __typesugar_m_0__ = s;`
- [x] Name collision case still works: if `_s` is already in scope, falls back to mangled name
- [x] All match tests pass: `pnpm vitest run match`

### Wave 3: Match Guard Optimization — Hoist Common Checks

**Problem:** For a discriminated union `{ kind: "paid" } | { kind: "pending" } | { kind: "failed" }`, every arm emits:

```javascript
if (typeof _s === "object" && _s !== null && "kind" in _s && _s.kind === "paid" ...) { ... }
if (typeof _s === "object" && _s !== null && "kind" in _s && _s.kind === "pending") { ... }
if (typeof _s === "object" && _s !== null && "kind" in _s && _s.kind === "failed" ...) { ... }
```

The `typeof`/null/`"kind" in` checks are identical. This should be:

```javascript
if (typeof _s === "object" && _s != null && "kind" in _s) {
  if (_s.kind === "paid") {
    const a = _s.amount;
    return `Paid ${a}`;
  }
  if (_s.kind === "pending") {
    return "Awaiting payment";
  }
  if (_s.kind === "failed") {
    const r = _s.reason;
    return `Failed: ${r}`;
  }
}
return "unknown";
```

Or even better, a `switch`:

```javascript
switch (_s.kind) {
  case "paid": {
    const a = _s.amount;
    return `Paid ${a}`;
  }
  case "pending":
    return "Awaiting payment";
  case "failed": {
    const r = _s.reason;
    return `Failed: ${r}`;
  }
  default:
    return "unknown";
}
```

**Tasks:**

- [x] Fix null check: change `!== null` (`ExclamationEqualsEqualsToken`) to `!= null` (`ExclamationEqualsToken`) in object pattern guard generation — catches both `null` and `undefined`
- [x] When the scrutinee type is known (via `analyzeScrutineeType`), detect the common case: all arms match on the same discriminant property (`kind`, `type`, `tag`, `_tag`)
- [x] For pure discriminant matches: emit a `switch` on the discriminant instead of repeated `if` chains
- [x] For mixed matches (some arms have additional property patterns beyond the discriminant): hoist the shared `typeof`/null/`in` guard as an outer `if`, nest the per-arm discriminant checks inside
- [x] Ensure the existing `emitSwitchMatch` path is triggered more aggressively when applicable (it currently only fires for `isAllPureLiteralArms`)

**Gate:**

- [x] Discriminated union match emits `switch (_s.kind)` not repeated `if` chains
- [x] Null checks use `!= null` (loose equality)
- [x] Mixed discriminant + property extraction still works correctly
- [x] All match tests pass: `pnpm vitest run match`
- [x] Red-team: `match(x)` where `x` could be `null | undefined | { kind: ... }` — the guard must not crash

### Wave 4: Auto-Inline Derived Typeclass Instances

**Problem:** Auto-derived instances like `eqPoint` create a runtime dictionary object. The philosophy says this should be zero-cost — the method body should be inlined at every call site.

```typescript
// Current output:
const eqPoint: Eq<Point> = {
  eq: (a: Point, b: Point): boolean => eqNumber.eq(a.x, b.x) && eqNumber.eq(a.y, b.y),
  neq: (a: Point, b: Point): boolean => !(eqNumber.eq(a.x, b.x) && eqNumber.eq(a.y, b.y)),
};
console.log("p1 === p2?", eqPoint.equals(p1, p2));

// Should be:
console.log("p1 === p2?", p1.x === p2.x && p1.y === p2.y);
```

Two sub-problems: (a) `eqNumber.eq(a.x, b.x)` should itself inline to `a.x === b.x` (recursive inlining), and (b) the `eqPoint.equals(p1, p2)` call site should inline the body with `p1`/`p2` substituted for `a`/`b`.

**Tasks:**

- [x] When `@derive` generates a typeclass instance, automatically mark it with `@inline` metadata (or equivalent internal flag) so the specialization system knows to inline at call sites
- [x] In `tryAutoSpecialize`, detect calls to auto-derived instance methods (e.g., `eqPoint.equals(...)`) and apply `inlineMethod` to substitute the body
- [x] Handle recursive inlining: `eqNumber.eq(a.x, b.x)` → `a.x === b.x` (primitive Eq instances should be pre-inlined or marked as intrinsics)
- [x] If the inlined result is a simple expression (no side effects, no temp variables needed), emit it directly without an IIFE wrapper
- [x] Dead code elimination: if `eqPoint` is only used at inline sites, remove the dictionary declaration entirely

**Gate:**

- [x] `eqPoint.equals(p1, p2)` inlines to `p1.x === p2.x && p1.y === p2.y`
- [x] Recursive instances inline fully (no `eqNumber.eq` in output)
- [x] Dictionary declaration is removed when all uses are inlined
- [x] Non-inlineable uses (passing the dictionary as a value, e.g., `map(xs, eqPoint)`) keep the declaration
- [x] All typeclass and derive tests pass: `pnpm vitest run typeclass derive`

### Wave 5: Strict Output Mode

**Problem:** We want a mode where the transformer guarantees its output is valid TypeScript.

**Tasks:**

- [x] Add a `strictOutput: boolean` option to `transformCode` and `TransformationPipeline`
- [x] When `strictOutput` is enabled, run `tsc --noEmit` on the output and report any errors as transformer diagnostics
- [x] Catalog common output invalidity patterns (type annotation mismatches, missing imports for injected function calls, etc.) and fix them at the source
- [x] Enable `strictOutput` in the playground's `api/compile.ts` (at least as a warning, not a hard error initially)

**Gate:**

- [x] Playground output for all 33 examples produces zero TypeScript errors with `strictOutput: true`
- [x] Performance: strict mode adds <200ms overhead per compilation (output typecheck is fast for single files)
- [x] `pnpm test` passes

## Files Changed

| File                                                           | Change                                                                    |
| -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `packages/transformer-core/src/rewriting.ts`                   | Opaque type annotation erasure (Wave 1) ✅                                |
| `packages/transformer-core/src/transformer.ts`                 | Hook annotation erasure into visitor (Wave 1) ✅                          |
| `packages/transformer/src/index.ts`                            | Opaque type annotation erasure (Wave 1) ✅                                |
| `packages/transformer/tests/opaque-annotation-erasure.test.ts` | Tests for Wave 1 ✅                                                       |
| `packages/std/src/macros/match-v2.ts`                          | Variable naming, guard optimization, null check (Waves 2-3)               |
| `packages/core/src/context.ts`                                 | `tryShortName` helper (Wave 2)                                            |
| `packages/macros/src/specialize.ts`                            | Primitive intrinsic registry, `getInstanceOrIntrinsicMethods` (Wave 4) ✅ |
| `packages/macros/src/typeclass.ts`                             | Register derived instances for specialization (Wave 4) ✅                 |
| `packages/transformer-core/src/specialization.ts`              | `tryInlineDerivedInstanceCall`, recursive inlining, DCE (Wave 4) ✅       |
| `packages/transformer-core/src/transformer.ts`                 | Hook inlining + DCE into visitor (Wave 4) ✅                              |
| `packages/transformer/src/index.ts`                            | Mirror inlining + DCE in Node.js transformer (Wave 4) ✅                  |
| `packages/transformer/tests/derive-inline.test.ts`             | 14 tests covering all Wave 4 gate criteria ✅                             |
| `packages/transformer/src/index.ts`                            | Strict output mode + opaque return type stripping (Wave 5) ✅             |
| `packages/transformer/src/pipeline.ts`                         | Single-program strict output typecheck (Wave 5) ✅                        |
| `packages/transformer-core/src/transform.ts`                   | Browser-compatible strict output typecheck (Wave 5) ✅                    |
| `packages/transformer-core/src/types.ts`                       | `strictOutput` option on TransformOptions (Wave 5) ✅                     |
| `packages/transformer-core/src/rewriting.ts`                   | Unconditional opaque return type stripping (Wave 5) ✅                    |
| `packages/transformer-core/src/transformer.ts`                 | Hook opaque return type stripping into visitor (Wave 5) ✅                |
| `packages/transformer-core/src/specialization.ts`              | Strip leaked type params from specialized functions (Wave 5) ✅           |
| `packages/macros/src/specialize.ts`                            | Strip leaked type params from specialized functions (Wave 5) ✅           |
| `api/compile.ts`                                               | Enable strict output mode (Wave 5) ✅                                     |
| `api/playground-declarations.ts`                               | Fix ambient declarations for Eq, registerInstance, Option (Wave 5) ✅     |
| `packages/transformer/tests/strict-output.test.ts`             | 35 tests covering all Wave 5 gate criteria ✅                             |

## Consequences

1. **Benefits:**
   - Output is valid TypeScript — users can copy-paste from the playground
   - Generated code looks human-written, not machine-generated
   - Zero-cost philosophy is actually realized in the output (no leftover dictionaries)
   - Trust: users who inspect the output see clean, minimal code

2. **Trade-offs:**
   - Strict output mode adds a typecheck pass (~100-200ms) — opt-in only
   - Guard hoisting in match adds complexity to the codegen — but the output is dramatically cleaner
   - Auto-inlining derived instances increases transformer complexity — but this is the core promise of the project

3. **Future work:**
   - Extend strict output to multi-file projects (check cross-file type coherence)
   - Source-map accuracy for inlined code (map back to the typeclass definition)
   - Dead code elimination as a general pass (not just for inlined instances)

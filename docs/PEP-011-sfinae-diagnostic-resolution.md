# PEP-011: SFINAE Diagnostic Resolution

**Status:** Draft
**Date:** 2026-03-15
**Author:** Dean Povey

## Context

typesugar's macro system rewrites code at compile time: extension methods become function calls, typeclass operators become inlined comparisons, newtypes erase to raw values. But TypeScript's type checker runs on the **original** source code, before the transformer. This creates phantom errors -- diagnostics that are valid from TypeScript's perspective but invalid from typesugar's, because the transformer will resolve them at emit time.

Today these phantom errors block adoption of key features:

- **Extension methods** -- `(42).clamp(0, 100)` reports "Property 'clamp' does not exist on type 'number'" (TS2339)
- **Newtype assignment** -- `const id: UserId = 42` reports "Type 'number' is not assignable to type 'UserId'" (TS2322) without `wrap()`
- **Opaque type boundaries** -- Assigning `T | null` to `Option<T>` (and back) would error once Option becomes an interface (PEP-012)
- **Macro-generated code** -- Auto-derived instances and comptime results can produce diagnostics at synthetic positions

The current approach is ad-hoc: the language service plugin suppresses diagnostics whose source positions can't be mapped back to the original source. This only handles macro-generated code. Everything else shows red squiggles.

### The Principle: Substitution Failure Is Not An Error

C++ templates use SFINAE: when template argument substitution produces an invalid type, the compiler silently removes that overload from the candidate set instead of reporting an error. The substitution "failed," but it's not an error -- it's information that guides resolution.

typesugar needs the same principle. When TypeScript reports an error at a site where the transformer has a valid rewrite, the error should be suppressed. The "substitution" (TypeScript's standard type checking) "failed," but typesugar's rewrite system handles it -- so it's not an error.

This must be:

1. **Principled** -- Every suppression is justified by a specific rewrite rule that makes the emitted code valid
2. **General** -- One mechanism for all rewrite categories, not ad-hoc per-feature suppression
3. **Extensible** -- User-defined macros can register their own SFINAE rules
4. **Auditable** -- Developers can see which diagnostics were suppressed and why

## Design

### SFINAE Rule Interface

```typescript
interface SfinaeRule {
  /** Human-readable name for audit output */
  name: string;

  /** TypeScript error codes this rule can suppress */
  errorCodes: readonly number[];

  /**
   * Evaluate whether this diagnostic should be suppressed.
   * Returns true if the typesugar rewrite system handles this case.
   */
  shouldSuppress(
    diagnostic: ts.Diagnostic,
    checker: ts.TypeChecker,
    sourceFile: ts.SourceFile
  ): boolean;
}
```

### SFINAE Rule Registry

```typescript
const sfinaeRules: SfinaeRule[] = [];

function registerSfinaeRule(rule: SfinaeRule): void;
function evaluateSfinae(diagnostic: ts.Diagnostic, ...): boolean;
```

Rules are registered at transformer initialization, alongside macro registration. Built-in rules ship with `@typesugar/macros`. User-defined macros can register additional rules.

### Diagnostic Filter Pipeline

The SFINAE filter runs in two places:

1. **Language service plugin** -- `getSemanticDiagnostics()` filters diagnostics before showing them in the IDE
2. **CLI/build pipeline** -- `TransformationPipeline.collectDiagnostics()` filters before reporting to the user

Both use the same `evaluateSfinae()` function:

```
TypeScript type checker
  → raw diagnostics
  → SFINAE filter (evaluateSfinae for each diagnostic)
  → filtered diagnostics shown to user
```

### Built-in SFINAE Rules

#### Rule 1: ExtensionMethodCall

**Error codes:** TS2339 ("Property 'X' does not exist on type 'Y'")

**Condition:** An extension method named 'X' is resolvable for type 'Y' through:

- The standalone extension registry (from `registerExtensions`)
- Import-scoped resolution (a function or namespace property imported in the current file whose first parameter matches)
- The type rewrite registry (from `@opaque` -- PEP-012)

**How it works:** When the diagnostic reports TS2339 for a property access on a call expression, the rule runs the same resolution logic as `tryRewriteExtensionMethod` in the transformer. If the extension resolves, the diagnostic is suppressed.

**Limitation:** This suppresses the "property doesn't exist" error, but TypeScript still infers the return type as `any` for the call expression (since it can't resolve the method signature). For concrete types with global augmentation (PEP-012 Wave 7), the return type is correct because the augmented interface declares the method. For opaque types (PEP-012), the interface declares the method so this rule isn't even needed -- TypeScript is happy.

This rule primarily helps with extension methods on **concrete types that don't yet have augmentation**, providing a better experience during incremental adoption.

#### Rule 2: TypeRewriteAssignment

**Error codes:** TS2322 ("Type 'X' is not assignable to type 'Y'"), TS2345 ("Argument of type 'X' is not assignable to parameter of type 'Y'"), TS2355 ("A function whose declared type is neither 'void' nor 'any' must return a value.")

**Condition:** Either the source or target type is registered in the `typeRewriteRegistry` (PEP-012), and the other type matches the registered underlying representation.

**Examples:**

- `const o: Option<number> = nullableValue` -- Target is `@opaque` Option, source matches underlying `number | null` → suppress
- `const n: number | null = someOption` -- Source is `@opaque` Option, target matches underlying `number | null` → suppress
- `fn(someOption)` where param is `number | null` -- Same logic for arguments

**How it works:** Look up both source and target types in `typeRewriteRegistry`. If one is an opaque type and the other is assignable to its underlying representation, suppress. This is checked via the type checker's `isTypeAssignableTo` using the underlying type.

#### Rule 3: NewtypeAssignment

**Error codes:** TS2322, TS2345

**Condition:** The target type is a `Newtype<Base, Brand>` (from `@typesugar/type-system`) and the source type is assignable to `Base`, or vice versa.

**How it works:** Check if the type has the `__brand` phantom field from the newtype system. If so, extract the base type and check assignability.

This rule makes `const id: UserId = 42` work without `wrap()`, since at runtime `UserId` IS `number`.

#### Rule 4: MacroGenerated (existing)

**Error codes:** Any

**Condition:** The diagnostic's source position cannot be mapped back to the original source via the source map.

**How it works:** This is the existing suppression logic in the language service plugin, now formalized as a SFINAE rule. Diagnostics in macro-generated code that don't map to original positions are suppressed.

### Audit Mode

A `--show-sfinae` flag (or `TYPESUGAR_SHOW_SFINAE=1` env var) prints suppressed diagnostics with their justification:

```
[SFINAE] Suppressed TS2339 at src/app.ts:12:5
  "Property 'clamp' does not exist on type 'number'"
  Rule: ExtensionMethodCall
  Resolved: clamp (from "@typesugar/std/extensions/number")

[SFINAE] Suppressed TS2322 at src/app.ts:15:3
  "Type 'number | null' is not assignable to type 'Option<number>'"
  Rule: TypeRewriteAssignment
  Underlying: Option<number> → number | null (runtime identity)
```

This makes the system transparent and debuggable.

## Waves

### Wave 1: SFINAE Infrastructure

**Tasks:**

- [x] Define `SfinaeRule` interface in `@typesugar/core`
- [x] Create `sfinaeRuleRegistry` with `registerSfinaeRule()` and `evaluateSfinae()`
- [x] Port existing position-mapping suppression to Rule 4 (MacroGenerated)
- [x] Unit tests for registry operations

**Gate:**

- [x] `pnpm build` passes
- [x] `pnpm vitest run packages/core` passes
- [x] Existing diagnostic suppression behavior is preserved (no regression)

### Wave 2: Language Service Integration

**Tasks:**

- [ ] Integrate `evaluateSfinae()` into `getSemanticDiagnostics()` in `packages/transformer/src/language-service.ts`
- [ ] Integrate into `getSuggestionDiagnostics()` where applicable
- [ ] Add `--show-sfinae` audit output
- [ ] Integration tests: verify diagnostics are suppressed in IDE scenarios

**Gate:**

- [ ] `pnpm build` passes
- [ ] Language service tests pass
- [ ] Existing extension method completions still work
- [ ] Audit mode shows suppressed diagnostics

### Wave 3: ExtensionMethodCall Rule

**Tasks:**

- [ ] Implement Rule 1 (ExtensionMethodCall) for TS2339
- [ ] Reuse extension resolution logic from `tryRewriteExtensionMethod`
- [ ] Handle both standalone extensions and import-scoped resolution
- [ ] Tests: `(42).clamp(0, 100)` with `import { clamp }` suppresses TS2339

**Gate:**

- [ ] `pnpm build` passes
- [ ] Extension method SFINAE tests pass
- [ ] No false positives: `(42).nonExistent()` still errors

### Wave 4: NewtypeAssignment Rule

**Tasks:**

- [ ] Implement Rule 3 (NewtypeAssignment) for TS2322/TS2345
- [ ] Detect `Newtype<Base, Brand>` types via the `__brand` phantom field
- [ ] Handle both directions: `Base → Newtype` and `Newtype → Base`
- [ ] Tests: `const id: UserId = 42` suppresses without `wrap()`

**Gate:**

- [ ] `pnpm build` passes
- [ ] Newtype SFINAE tests pass
- [ ] `wrap()` / `unwrap()` still work (not broken by SFINAE)

### Wave 5: TypeRewriteAssignment Rule

**Tasks:**

- [ ] Implement Rule 2 (TypeRewriteAssignment) for TS2322/TS2345/TS2355
- [ ] Consult `typeRewriteRegistry` (populated by PEP-012's `@opaque`)
- [ ] Handle both directions: underlying → opaque and opaque → underlying
- [ ] Tests with mock registry entries (actual `@opaque` types come in PEP-012)

**Gate:**

- [ ] `pnpm build` passes
- [ ] Type rewrite SFINAE tests pass
- [ ] No false positives for unrelated assignment errors

### Wave 6: CLI Pipeline Integration

**Tasks:**

- [ ] Integrate `evaluateSfinae()` into `TransformationPipeline` diagnostic collection
- [ ] Ensure CLI build (`typesugar build`, `tspc`) filters diagnostics consistently with IDE
- [ ] Add `--show-sfinae` flag to CLI
- [ ] End-to-end test: build a file with SFINAE-suppressible errors, verify clean output

**Gate:**

- [ ] `pnpm build` passes
- [ ] CLI produces same filtered diagnostics as IDE
- [ ] `--show-sfinae` works in CLI
- [ ] Full test suite passes

## Files Changed

| File                                           | Change                                                    |
| ---------------------------------------------- | --------------------------------------------------------- |
| `packages/core/src/sfinae.ts`                  | New: `SfinaeRule` interface, registry, `evaluateSfinae()` |
| `packages/core/src/index.ts`                   | Export SFINAE API                                         |
| `packages/macros/src/sfinae-rules.ts`          | New: Built-in SFINAE rules (Rules 1-4)                    |
| `packages/macros/src/index.ts`                 | Register built-in SFINAE rules                            |
| `packages/transformer/src/language-service.ts` | Integrate SFINAE filter into `getSemanticDiagnostics()`   |
| `packages/transformer/src/pipeline.ts`         | Integrate SFINAE filter into diagnostic collection        |
| `packages/transformer/src/index.ts`            | Pass SFINAE context to diagnostic handling                |
| `tests/sfinae.test.ts`                         | New: SFINAE rule tests                                    |
| `tests/sfinae-extension.test.ts`               | New: Extension method SFINAE integration tests            |
| `tests/sfinae-newtype.test.ts`                 | New: Newtype assignment SFINAE tests                      |

## Security Considerations

SFINAE suppresses diagnostics, which could theoretically hide real errors. Mitigations:

1. **Rules are specific** -- Each rule checks precise conditions (type registry match, extension resolution), not broad patterns
2. **Audit mode** -- `--show-sfinae` makes suppression transparent and debuggable
3. **No type inference changes** -- SFINAE only suppresses diagnostics; it does not change what TypeScript infers. If the inferred type is wrong, downstream errors will still surface
4. **Extensible but controlled** -- User-defined rules go through the same registry and audit system

## Consequences

**Benefits:**

- Phantom errors from typesugar rewrites no longer confuse developers
- Extension methods on concrete types become usable in IDE without red squiggles
- Newtype assignments work without ceremony (`wrap()`/`unwrap()` become optional)
- Foundation for PEP-012 (Type Macros) implicit conversions at opaque type boundaries
- General mechanism -- one system for all current and future rewrite categories

**Trade-offs:**

- Adds a diagnostic filtering layer that must be maintained alongside rewrite logic
- False negatives possible if a SFINAE rule is too broad (mitigated by specificity and audit mode)
- CLI users without the language service plugin still see phantom errors until Wave 6

**Future work:**

- PEP-012 (Type Macros) registers Rule 2 entries via `@opaque`
- Typeclass operator SFINAE rules (operator overloading errors)
- User-defined SFINAE rules for custom macros
- Potential `--strict-sfinae` mode that requires explicit opt-in per rule

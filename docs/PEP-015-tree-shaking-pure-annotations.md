# PEP-015: Automatic Tree-Shaking via `/*#__PURE__*/` Annotations

**Status:** Draft
**Date:** 2026-03-17
**Author:** Dean Povey

## Context

JavaScript bundlers (Webpack, Rollup, esbuild, Vite) perform dead code elimination (tree-shaking) to remove unused exports from bundles. However, bundlers are conservative — they cannot eliminate code that _might_ have side effects without proof otherwise. Two mechanisms provide that proof:

1. **`"sideEffects": false`** in `package.json` — tells the bundler that entire modules can be dropped if nothing is imported from them.
2. **`/*#__PURE__*/`** annotations on expressions — tells the bundler that a specific expression has no side effects and its result can be discarded if unused.

typesugar generates significant amounts of code at compile time: typeclass instance constants, specialized function hoists, auto-derived instances, `registerInstance()` calls, and method erasure rewrites. Without `/*#__PURE__*/` on this generated code, bundlers must assume it's all side-effectful and keep it in the bundle — even when the user never references it.

### Current State

**What's already done:**

- `"sideEffects": false` is declared on 34 of 36 packages (exceptions: `@typesugar/std` and `@typesugar/vscode`, both intentionally `true`)
- `MacroContext.markPure()` API exists in `packages/core/src/context.ts`
- `typeclass.ts` manually emits `/*#__PURE__*/` on ~40+ generated expressions (instance constants, `registerInstance()` calls, primitive instances)
- `specialize.ts` marks hoisted specialization declarations as pure via `createHoistedSpecialization()`
- `unplugin-typesugar` has `/*#__PURE__*/` on its `createUnplugin()` export

**What's missing:**

- The **transformer** has no automatic pure-annotation pass — every macro must manually call `markPure()` or splice the comment string
- Generated code from `@adt`, `@opaque`, `@extension`, `@deriving`, and other macros may lack annotations
- No way for macro authors to declare their output as pure — they must know about and manually use `markPure()`
- `registerInstance()` calls are inherently side-effectful (mutate a `Map`), creating a floor on tree-shakeability even with `/*#__PURE__*/`
- No user-facing `@pure` annotation for hand-written code

### The Problem in Practice

Consider a user who imports only `Eq` from `@typesugar/std`:

```typescript
import { Eq } from "@typesugar/std";
```

The module also exports `Ord`, `Show`, `Hash`, `Semigroup`, `Monoid`, and dozens of instances. Without `/*#__PURE__*/`, the bundler keeps all instance registrations and their associated code, even though the user only wanted `Eq`.

With proper annotations, the bundler can eliminate everything the user didn't reference — potentially saving kilobytes of unused typeclass machinery.

### Why typesugar Can Do This Better Than a Bundler

A general-purpose bundler operates on emitted JavaScript without type information. It can only reason about syntactic purity: is this a literal? A function definition? An IIFE?

typesugar's transformer has three advantages:

1. **Type information** — the TypeChecker is available at transform time, enabling type-aware purity analysis
2. **Knowledge of generated code** — the transformer knows exactly which nodes it created and what they do
3. **Macro-level semantics** — macro authors know whether their output is pure; this just needs a way to declare it

This is analogous to:

- **Rust**: `#[must_use]` and `#[inline]` — the compiler adds attributes that guide optimization
- **Scala 3**: `@compileTimeOnly` and `transparent inline` — compile-time annotations that control code generation
- **Zig**: `comptime` — the compiler has full semantic knowledge at compile time

## Design

### Three Tiers of Purity Annotation

#### Tier 1: Automatic Pure Pass in the Transformer

After all macros have expanded, the transformer runs a final pass over generated `VariableStatement` nodes. If the initializer is syntactically pure, `/*#__PURE__*/` is added automatically.

**Syntactically pure expressions** (conservative — no false positives):

| Expression Kind                                       | Example                          | Pure?              |
| ----------------------------------------------------- | -------------------------------- | ------------------ |
| Object literal (no spread, no method calls in values) | `{ equals: (a, b) => a === b }`  | Yes                |
| Array literal (no spread, no calls in elements)       | `[1, 2, 3]`                      | Yes                |
| Arrow function / function expression                  | `(x) => x + 1`                   | Yes                |
| Numeric / string / boolean / null literal             | `42`, `"hello"`, `true`, `null`  | Yes                |
| `Object.freeze(literal)`                              | `Object.freeze({ x: 1 })`        | Yes                |
| `new Map()` / `new Set()` (no args)                   | `new Map()`                      | Yes                |
| Call to a `/*#__PURE__*/`-marked function             | `/*#__PURE__*/ createInstance()` | Yes (transitively) |
| Conditional with pure branches                        | `cond ? pureA : pureB`           | Yes                |

**Not pure** (conservative — don't annotate):

| Expression Kind                    | Why                                  |
| ---------------------------------- | ------------------------------------ |
| Arbitrary function calls           | Can't prove no side effects          |
| Property access on non-literals    | Getters can have side effects        |
| `new Foo()` (user-defined)         | Constructor could do anything        |
| Spread elements                    | Source could be a generator or proxy |
| Template literals with expressions | Tag functions can have side effects  |

The pass only annotates **top-level variable declarations** (module scope), since those are the ones bundlers can eliminate. Block-scoped variables are already handled by normal dead code elimination.

#### Tier 2: Macro-Level `pure` Flag

Add a `pure` field to `MacroExpansionResult`:

```typescript
export interface MacroExpansionResult {
  success: boolean;
  nodes?: ts.Node[];
  diagnostics: MacroDiagnostic[];
  /** If true, all generated top-level expressions are pure (tree-shakeable). */
  pure?: boolean;
}
```

When a macro returns `pure: true`, the transformer marks all generated variable declarations and expression statements with `/*#__PURE__*/` automatically. This shifts the burden from "every macro author must call `markPure()` on every node" to "declare once that your output is pure."

Built-in macros that should declare `pure: true`:

- `@typeclass` instance generation
- `@deriving` / auto-derivation output
- `@adt` constructor and type guard generation
- `@opaque` companion function generation
- `specialize()` / `inlineMethod()` hoisted declarations
- `@extension` standalone function generation

Macros that should NOT declare `pure: true`:

- `comptime()` — may have arbitrary side effects
- `@cfg` — conditional compilation, side effects depend on conditions
- `include_str!()` / `include_json!()` — file I/O at compile time (but output is pure)

For `include_str!()` and similar: the macro expansion itself has side effects (file reads), but the _output_ is a pure expression (a string literal). The `pure` flag applies to the output nodes, not the expansion process.

#### Tier 3: User-Facing `@pure` JSDoc Annotation

Allow users to mark their own functions and constants as pure:

```typescript
/** @pure */
const expensiveLookup = buildLookupTable(data);

/** @pure */
function createCodec<T>(schema: Schema<T>): Codec<T> {
  return { encode: ..., decode: ... };
}
```

The transformer emits `/*#__PURE__*/` on the initializer / function expression. This is an escape hatch for cases where the user knows an expression is pure but it doesn't look syntactically pure (e.g., a function call that only allocates).

### Eliminate Instance Registration (Tier 4)

The current `registerInstance()` pattern is fundamentally side-effectful:

```javascript
const eqPoint = /*#__PURE__*/ { equals: (a, b) => a.x === b.x };
/*#__PURE__*/ Eq.registerInstance("Point", eqPoint);
```

The `/*#__PURE__*/` on `registerInstance()` is a white lie — the call mutates a global `Map`. It works because if the entire module is unused, the bundler drops everything. But if _any_ export from the module is used, all `registerInstance()` calls survive.

The key insight: `summon()` is already resolved at compile time by the transformer. The registry is only needed for (a) runtime reflection and (b) code not processed by the transformer. For most users, `registerInstance()` is dead weight that prevents per-instance tree-shaking.

The solution is not lazy registration (which adds runtime complexity for no benefit) but **eliminating registration entirely** for the default case:

```javascript
// Before (Waves 1-4): module-level tree-shaking only
const eqPoint = /*#__PURE__*/ { equals: (a, b) => a.x === b.x };
/*#__PURE__*/ Eq.registerInstance("Point", eqPoint); // anchors eqPoint in bundle

// After (Wave 5): per-instance tree-shaking
const eqPoint = /*#__PURE__*/ { equals: (a, b) => a.x === b.x };
// No registerInstance() — summon() resolves at compile time
// If nothing references eqPoint, bundler drops it
```

Runtime reflection becomes opt-in via `@typesugar/typeclass/reflect`:

```typescript
import { reflect } from "@typesugar/typeclass";
reflect.register(eqPoint); // explicit opt-in
const eq = reflect.getInstance<Eq<Point>>("Point"); // runtime lookup
```

### `@typesugar/std` Side Effects

`@typesugar/std` is `"sideEffects": true` because it uses `declare global` for built-in type augmentation. This is correct and intentional — the global augmentation IS a side effect.

However, with proper `/*#__PURE__*/` annotations on individual exports, bundlers can still eliminate unused functions and instances within the module, even though the module itself can't be entirely dropped. This makes Tiers 1-3 valuable even for packages that can't be `sideEffects: false`.

## Implementation

### Auto-Pure Pass (Tier 1)

New function in `packages/transformer/src/index.ts`:

```typescript
function isExpressionSyntacticallyPure(expr: ts.Expression): boolean {
  if (ts.isObjectLiteralExpression(expr)) {
    return expr.properties.every((prop) => {
      if (ts.isPropertyAssignment(prop)) {
        return isExpressionSyntacticallyPure(prop.initializer);
      }
      if (ts.isShorthandPropertyAssignment(prop)) return true;
      if (ts.isMethodDeclaration(prop)) return true; // method def is pure
      return false; // spread, computed, etc.
    });
  }
  if (ts.isArrayLiteralExpression(expr)) {
    return expr.elements.every(
      (el) => !ts.isSpreadElement(el) && isExpressionSyntacticallyPure(el)
    );
  }
  if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) return true;
  if (ts.isNumericLiteral(expr) || ts.isStringLiteral(expr)) return true;
  if (
    expr.kind === ts.SyntaxKind.TrueKeyword ||
    expr.kind === ts.SyntaxKind.FalseKeyword ||
    expr.kind === ts.SyntaxKind.NullKeyword
  )
    return true;
  if (ts.isConditionalExpression(expr)) {
    return (
      isExpressionSyntacticallyPure(expr.whenTrue) && isExpressionSyntacticallyPure(expr.whenFalse)
    );
  }
  if (ts.isParenthesizedExpression(expr)) {
    return isExpressionSyntacticallyPure(expr.expression);
  }
  if (ts.isAsExpression(expr) || ts.isTypeAssertionExpression(expr)) {
    return isExpressionSyntacticallyPure(expr.expression);
  }
  return false;
}
```

This runs in `visitStatementContainer` after all macro expansion and hoisting is complete, iterating over top-level `VariableStatement` nodes and annotating pure initializers that don't already have the comment.

### Macro `pure` Flag (Tier 2)

Add `pure?: boolean` to `MacroExpansionResult`. In the transformer's macro dispatch, after collecting expanded nodes:

```typescript
if (result.pure && result.nodes) {
  for (const node of result.nodes) {
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (decl.initializer) {
          this.ctx.markPure(decl.initializer);
        }
      }
    }
  }
}
```

### `@pure` JSDoc Annotation (Tier 3)

Register `@pure` as a recognized JSDoc tag in the transformer. When visiting a variable declaration or function declaration with `@pure`:

```typescript
// User writes:
/** @pure */
const codec = createCodec(schema);

// Transformer emits:
const codec = /*#__PURE__*/ createCodec(schema);
```

### Diagnostic: Warn on Impure-Looking `@pure`

When a user writes `/** @pure */` on something that contains obviously impure expressions (e.g., `console.log`, `fs.writeFileSync`, `document.getElementById`), emit a warning:

```
warning[TS9401]: @pure annotation on expression that appears to have side effects
  --> src/config.ts:12:1
   |
12 | /** @pure */
   | ^^^^^^^^^^^ expression calls 'console.log' which may have side effects
   |
   = help: @pure is a hint to bundlers. If this expression truly has no
           observable side effects, the annotation is correct. Otherwise,
           the bundler may incorrectly eliminate it.
```

This is a soft warning, not an error — the user may know something the analyzer doesn't.

## Waves

### Wave 1: Auto-Pure Pass in Transformer

**Tasks:**

- [ ] Implement `isExpressionSyntacticallyPure()` in `packages/transformer/src/pure-analysis.ts`
- [ ] Add auto-pure pass to `visitStatementContainer` for module-scope variable declarations
- [ ] Skip nodes that already have `/*#__PURE__*/` (avoid double-annotating)
- [ ] Add `hasLeadingPureComment()` utility to check for existing annotation
- [ ] Add tests: verify auto-annotation on object literals, arrow functions, conditionals
- [ ] Add tests: verify NO annotation on function calls, property access, `new` expressions
- [ ] Add tests: verify existing manual `/*#__PURE__*/` is preserved (not duplicated)
- [ ] Verify `pnpm test` passes with auto-pure active

**Gate:**

- [ ] `pnpm test` passes
- [ ] `pnpm typecheck` passes
- [ ] Generated output for typeclass instances includes `/*#__PURE__*/`
- [ ] Generated output for non-pure expressions does NOT include `/*#__PURE__*/`
- [ ] Bundle size comparison: measure before/after with a test app that imports a subset of `@typesugar/fp`

### Wave 2: Macro `pure` Flag

**Tasks:**

- [ ] Add `pure?: boolean` field to `MacroExpansionResult` in `packages/core/src/types.ts`
- [ ] Update transformer macro dispatch to auto-annotate nodes when `pure: true`
- [ ] Add `pure: true` to `@typeclass` instance generation output
- [ ] Add `pure: true` to `@deriving` / auto-derivation output
- [ ] Add `pure: true` to `@adt` constructor and type guard generation
- [ ] Add `pure: true` to `@opaque` companion function generation
- [ ] Add `pure: true` to `@extension` standalone function generation
- [ ] Update `createHoistedSpecialization()` to use the flag instead of manual annotation
- [ ] Remove manual `markPure()` calls in macros that now declare `pure: true`
- [ ] Add tests: macro returning `pure: true` produces annotated output
- [ ] Add tests: macro returning `pure: false` or omitting `pure` does NOT annotate

**Gate:**

- [ ] `pnpm test` passes
- [ ] `pnpm typecheck` passes
- [ ] Manual `markPure()` calls in `typeclass.ts` reduced by >50%
- [ ] All built-in macros audited for correct `pure` flag

### Wave 3: User-Facing `@pure` Annotation

**Tasks:**

- [ ] Register `@pure` as a recognized JSDoc tag in the transformer
- [ ] Implement transformer visitor for `@pure` on `VariableStatement` and `FunctionDeclaration`
- [ ] Implement impure-expression detector for diagnostic warnings (known impure callees: `console.*`, `Math.random`, `Date.now`, DOM APIs, `fs.*`)
- [ ] Register diagnostic code TS9401 for impure `@pure` warning
- [ ] Add tests: `@pure` on variable declaration emits `/*#__PURE__*/`
- [ ] Add tests: `@pure` on function declaration emits `/*#__PURE__*/`
- [ ] Add tests: `@pure` on impure expression emits warning
- [ ] Update macro-authoring docs with `pure` flag guidance
- [ ] Add guide: `docs/guides/tree-shaking.md` covering all three tiers

**Gate:**

- [ ] `pnpm test` passes
- [ ] `pnpm typecheck` passes
- [ ] `@pure` annotation works in both `.ts` and `.sts` files
- [ ] Documentation complete with examples

### Wave 4: Audit and Optimize

**Tasks:**

- [ ] Audit all packages for missing `sideEffects` field (should be 100% coverage)
- [ ] Audit `@typesugar/std` — can any sub-modules be marked `sideEffects: false`? (e.g., `@typesugar/std/match`)
- [ ] Audit generated code across all macros — verify `/*#__PURE__*/` coverage
- [ ] Create bundle-size benchmark: import subsets of typesugar packages, measure bundle size with Rollup/esbuild
- [ ] Compare bundle sizes before and after PEP-015
- [ ] Document tree-shaking results in `docs/guides/tree-shaking.md`
- [ ] Consider `sideEffects` array pattern for `@typesugar/std`: `"sideEffects": ["./src/global-augmentation.ts"]`

**Gate:**

- [ ] `pnpm test` passes
- [ ] Bundle size benchmark shows measurable improvement
- [ ] All 36 packages audited

### Wave 5: Eliminate Instance Registration for Compile-Time-Resolved Instances

Waves 1-4 annotate generated code so bundlers can drop _unused modules_. But `registerInstance()` calls are genuinely side-effectful — they mutate a global `Map` at module load time. If _any_ export from a module is used, all `registerInstance()` calls in that module survive the bundle, even if the registered instances are never summoned.

This wave eliminates `registerInstance()` for the common case where instances are resolved at compile time by the transformer.

**Current flow:**

```typescript
// Generated by @typeclass / @deriving:
const eqPoint: Eq<Point> = /*#__PURE__*/ { equals: (a, b) => a.x === b.x && a.y === b.y };
/*#__PURE__*/ Eq.registerInstance<Point>("Point", eqPoint);

// At call site, summon() is resolved at compile time:
// summon<Eq<Point>>()  →  eqPoint  (transformer replaces, never hits registry)
```

The `registerInstance()` call exists only as a runtime fallback (for code not processed by the transformer) and for runtime reflection (`Eq.getInstance("Point")`). For most users, it's dead weight.

**Design: Two-mode registration**

1. **Compile-time mode (default):** The transformer resolves `summon()` calls directly to the instance variable. No `registerInstance()` call is emitted. The instance constant is a plain variable with `/*#__PURE__*/`, fully tree-shakeable at per-binding granularity.

2. **Runtime mode (opt-in):** When runtime reflection or dynamic dispatch is needed, users annotate with `/** @runtime */` or import a reflection API:

   ```typescript
   import { reflect } from "@typesugar/typeclass";

   // Explicitly register for runtime access
   reflect.register(eqPoint);

   // Runtime lookup (not compile-time resolved)
   const eq = reflect.getInstance<Eq<Point>>("Point");
   ```

**What changes:**

- The `@typeclass` macro stops emitting `registerInstance()` by default
- `summon()` continues to work unchanged (it's already compile-time)
- A new `@typesugar/typeclass/reflect` entry point provides opt-in runtime registration
- Existing code that calls `registerInstance()` directly gets a deprecation warning with migration guidance
- The `instanceRegistry` `Map` still exists but is only populated when explicitly requested

**Migration path:**

| Current pattern                                                | After Wave 5                                            |
| -------------------------------------------------------------- | ------------------------------------------------------- |
| `summon<Eq<Point>>()`                                          | Unchanged — already compile-time                        |
| `Eq.registerInstance("Point", eqPoint)`                        | Removed from generated code                             |
| `Eq.getInstance("Point")` (runtime lookup)                     | `reflect.getInstance<Eq<Point>>("Point")` — must opt in |
| `findInstance(registry, "Eq", "Point")` (transformer internal) | Unchanged — transformer uses AST-level resolution       |

**Tasks:**

- [ ] Audit all `registerInstance()` call sites — categorize as compile-time-resolvable vs. runtime-needed
- [ ] Modify `@typeclass` macro to skip `registerInstance()` emission by default
- [ ] Add `/** @runtime */` JSDoc annotation to opt into runtime registration
- [ ] Create `@typesugar/typeclass/reflect` entry point with `register()` and `getInstance()`
- [ ] Add deprecation warning on direct `registerInstance()` calls in user code
- [ ] Verify `summon()` still resolves correctly without registration (should be no-op — it's already compile-time)
- [ ] Add tests: generated code does NOT contain `registerInstance()` by default
- [ ] Add tests: `@runtime` annotation emits registration
- [ ] Add tests: `reflect.getInstance()` works for explicitly registered instances
- [ ] Bundle size comparison: measure per-instance elimination with a module that defines 10+ instances but only 2 are used

**Gate:**

- [ ] `pnpm test` passes
- [ ] `pnpm typecheck` passes
- [ ] Generated output for `@typeclass` does NOT contain `registerInstance()` by default
- [ ] `summon()` works unchanged in all existing tests
- [ ] Bundle size benchmark shows per-instance tree-shaking improvement

## Files Changed

| File                                        | Change                                                     |
| ------------------------------------------- | ---------------------------------------------------------- |
| `packages/transformer/src/pure-analysis.ts` | New: syntactic purity checker                              |
| `packages/transformer/src/index.ts`         | Wave 1: auto-pure pass in `visitStatementContainer`        |
| `packages/core/src/types.ts`                | Wave 2: `pure?: boolean` on `MacroExpansionResult`         |
| `packages/macros/src/typeclass.ts`          | Wave 2: add `pure: true`, remove manual `markPure()` calls |
| `packages/macros/src/adt.ts`                | Wave 2: add `pure: true` to expansion result               |
| `packages/macros/src/opaque.ts`             | Wave 2: add `pure: true` to expansion result               |
| `packages/macros/src/extension.ts`          | Wave 2: add `pure: true` to expansion result               |
| `packages/macros/src/specialize.ts`         | Wave 2: use `pure` flag instead of manual annotation       |
| `packages/transformer/src/index.ts`         | Wave 3: `@pure` JSDoc handler                              |
| `packages/core/src/diagnostics.ts`          | Wave 3: TS9401 diagnostic descriptor                       |
| `docs/guides/tree-shaking.md`               | Wave 3: new guide                                          |
| `packages/std/package.json`                 | Wave 4: consider `sideEffects` array                       |
| `packages/macros/src/typeclass.ts`          | Wave 5: remove `registerInstance()` from default output    |
| `packages/typeclass/src/reflect.ts`         | Wave 5: new opt-in runtime reflection API                  |
| `packages/typeclass/src/index.ts`           | Wave 5: export reflect entry point                         |
| Test files                                  | All waves: verification tests                              |

## Consequences

**Benefits:**

1. **Smaller bundles** — unused typeclass instances, specialized functions, and auto-derived code is eliminated
2. **Zero effort for macro authors** — Tier 1 auto-annotates; Tier 2 is a single boolean flag
3. **User escape hatch** — `@pure` annotation for hand-written code that the analyzer can't prove pure
4. **Composable with existing tools** — `/*#__PURE__*/` is a standard understood by all major bundlers
5. **Compile-time advantage** — typesugar can annotate more aggressively than bundlers because it has type info and macro semantics
6. **Per-instance tree-shaking** — Wave 5 eliminates `registerInstance()`, making individual instances droppable even within a used module

**Trade-offs:**

1. **Conservative by default** — Tier 1 only annotates syntactically obvious cases; some pure expressions will be missed
2. **`@pure` is trust-based** — incorrect user annotations could cause bundlers to drop needed code (mitigated by the impure-expression warning)
3. **Small transformer overhead** — the auto-pure pass adds one extra walk over module-scope statements
4. **Runtime reflection is opt-in** — code that relied on implicit `registerInstance()` for runtime lookups must migrate to the explicit `reflect` API (Wave 5)

**Alternatives considered:**

- **Do nothing, rely on bundler heuristics** — Rejected. Bundlers are too conservative for generated code patterns like `{ equals: ... }` object literals.
- **Annotate everything as pure** — Rejected. False positives would cause runtime breakage. Conservative correctness is essential.
- **Babel plugin instead of transformer pass** — Rejected. typesugar already has a transformer; adding another tool is unnecessary complexity.
- **Runtime purity tracking** — Rejected. Defeats the zero-cost principle. Purity must be determined at compile time.
- **Lazy registration (register on first `summon()`)** — Rejected in favour of eliminating registration entirely. `summon()` is already compile-time; making it lazily register at runtime adds complexity for no benefit. The cleaner design is: no registration by default, explicit opt-in for reflection.

**Future work:**

- **Cross-module purity analysis** — use import graphs to determine if imported functions are pure
- **Effect system integration** — `@typesugar/type-system` effects could inform purity analysis (a function with `Effect<Pure>` is provably pure)
- **ESLint rule** — `@typesugar/eslint-plugin` rule that warns when a top-level declaration in a `sideEffects: false` package lacks `/*#__PURE__*/`

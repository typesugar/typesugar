# PEP-032: Self-Contained Macro Expansions via Companion Objects

**Status:** Implemented
**Date:** 2026-03-31
**Author:** Dean Povey, Claude
**Depends on:** PEP-025 (Match API), PEP-031 (LSP Server)

## Context

Macro expansions generate code that references symbols not imported in the user's file. For example, `@derive(Eq)` on `interface Point` expands to:

```typescript
const eqPoint: Eq<Point> = {
  equals: (a, b) => eqNumber.equals(a.x, b.x) && eqNumber.equals(a.y, b.y),
};
```

But `Eq`, `eqNumber`, and the generated `eqPoint` binding all reference symbols with no corresponding import. The user wrote:

```typescript
import { derive } from "typesugar";

@derive(Eq)
interface Point { x: number; y: number; }
```

They should not need to know that the expansion internally uses `eqNumber` from `@typesugar/typeclass`.

### Consequences of the current approach

1. **LSP server shows false errors** — "Cannot find name 'eqNumber'" on valid macro-expanded code (PEP-031 blocker)
2. **`typesugar run` output isn't standalone** — expanded files can't be typechecked independently
3. **Breaks editor tooling** — any tool that reads the expanded output (formatters, linters, bundlers) sees invalid TS
4. **Forces SFINAE hacks** — the in-process TS plugin suppresses these errors, but the standalone LSP can't

### How other languages handle this

**Rust** — Proc macros emit fully qualified paths (`::core::cmp::PartialEq`). No imports needed because Rust has absolute paths for all items.

**Scala 3** — `derives Eq` generates a `given Eq[T]` in the companion object. The compiler's implicit search finds instances in companion objects of types mentioned in the signature.

**Haskell** — `deriving (Eq, Ord)` is handled by the compiler which has built-in knowledge of these classes. Instance resolution is part of the type system.

**Key insight from all three:** The user imports the _typeclass_ (or it's in scope via language rules), and the _implementation details_ are resolved automatically. The user never manually imports primitive instances or helper functions.

### Why not emit imports?

An earlier version of this PEP proposed an `ImportCollector`/`ImportEmitter` pipeline where each macro calls `ctx.requireImport(...)` and a post-expansion pass inserts import statements. This works but adds significant complexity:

- Import deduplication and merge logic
- Path resolution (absolute to relative)
- Conflict handling with existing user imports
- Every macro must explicitly declare its import requirements
- Cross-file instances still need import coordination

The companion object approach described below eliminates all of this by ensuring that importing a typeclass or data type brings its instances along for free.

## Design

### Core Idea: Dual Companions

TypeScript's declaration merging allows an `interface` and a `const` with the same name to coexist. The interface is used as a type; the const is used as a value. This is the same pattern used by `class` declarations, `enum`s, and libraries like `io-ts`.

We exploit this in two places:

1. **Typeclass companion** — holds primitive instances (`Eq.number`, `Eq.string`, etc.)
2. **Data type companion** — holds derived instances (`Point.Eq`, `User.Showable`, etc.)

When you import a typeclass, you get its primitives. When you import a data type, you get its instances. No extra imports needed.

### Typeclass Companion

When `@typeclass` expands:

```typescript
// What the user writes:
@typeclass
export interface Showable<T> {
  show(x: T): string;
}

// What the macro generates:
export interface Showable<T> {
  show(x: T): string;
}

export const Showable = {
  string: showableString,
  number: showableNumber,
  boolean: showableBoolean,
} as const;
```

The companion const holds all primitive instances defined in the same file as the typeclass. These are the instances that derived expansions most commonly need.

This replaces the current `generateCompanionNamespace()` pattern which emits a `namespace Show { summon(), registerInstance(), ... }`. The runtime registry methods (`summon`, `registerInstance`, `hasInstance`) move to module-level functions or are replaced by the companion-based resolution (see [Interaction with summon and implicit()](#interaction-with-summon-and-implicit)).

### Data Type Companion

When `@derive(Showable, Eq)` expands on a data type:

```typescript
// What the user writes:
import { Showable } from "./showable";
import { Eq } from "@typesugar/typeclass";

@derive(Showable, Eq)
interface User { name: string; age: number; }

// What the macro generates:
interface User { name: string; age: number; }

const User = {
  Showable: {
    show: (u: User) => Showable.string.show(u.name) + ", " + Showable.number.show(u.age.toString()),
  } satisfies Showable<User>,
  Eq: {
    equals: (a: User, b: User) => Eq.string.equals(a.name, b.name) && Eq.number.equals(a.age, b.age),
  } satisfies Eq<User>,
} as const;
```

The `satisfies` operator ensures TypeScript checks the instance against the typeclass interface while preserving the literal type for the companion.

### Consumer Experience

```typescript
import { Showable } from "./showable"; // typeclass type + primitive instances
import { User } from "./user"; // data type + derived instances

// Direct use:
User.Showable.show(myUser);

// Passing to generic code:
printAll(User.Showable, users);
```

No extra imports. No side-effect imports. No import coordination.

### Cross-File Instance References

When `@derive(Eq)` on `Team` needs the `Eq` instance for `User` (from another file):

```typescript
import { Eq } from "@typesugar/typeclass";
import { User } from "./user";

@derive(Eq)
interface Team { lead: User; name: string; }

// Expands to:
interface Team { lead: User; name: string; }

const Team = {
  Eq: {
    equals: (a: Team, b: Team) =>
      User.Eq.equals(a.lead, b.lead) && Eq.string.equals(a.name, b.name),
  } satisfies Eq<Team>,
} as const;
```

The macro references `User.Eq` — and `User` is already imported because the type uses it. **No additional imports are ever needed for derived instances.** This is the key advantage: if your type references another type, you already import it, and the companion comes with it.

## Special Cases

### `@derive` on Classes

Classes are already both types and values, so a second `const` with the same name is illegal. Instead, the macro adds static-like properties via namespace declaration merging:

```typescript
@derive(Eq)
class Point {
  constructor(
    public x: number,
    public y: number
  ) {}
}

// Expands to:
class Point {
  constructor(
    public x: number,
    public y: number
  ) {}
}

(Point as any).Eq = {
  equals: (a: Point, b: Point) => Eq.number.equals(a.x, b.x) && Eq.number.equals(a.y, b.y),
} satisfies Eq<Point>;

declare namespace Point {
  const Eq: Eq<Point>;
}
```

Consumers use `Point.Eq` identically to the interface case.

### Generic Types

A generic type can't have a concrete instance on its companion — it needs a factory:

```typescript
@derive(Eq)
interface Pair<A, B> { fst: A; snd: B; }

// Expands to:
interface Pair<A, B> { fst: A; snd: B; }

const Pair = {
  Eq: <A, B>(eqA: Eq<A>, eqB: Eq<B>): Eq<Pair<A, B>> => ({
    equals: (a, b) => eqA.equals(a.fst, b.fst) && eqB.equals(a.snd, b.snd),
  }),
};
```

Usage:

```typescript
const eqPairNums = Pair.Eq(Eq.number, Eq.number);
eqPairNums.equals({ fst: 1, snd: 2 }, { fst: 1, snd: 2 });
```

This mirrors Scala where companion `given` instances for parameterized types are `def`s, not `val`s.

### Orphan Instances

When neither the typeclass nor the data type is owned by the user (e.g., `Showable<Date>`), there is no companion to attach to. Orphan instances fall back to a flat const:

```typescript
export const showableDate: Showable<Date> = {
  show: (d) => d.toISOString(),
};
```

The instance is registered in the global `instanceRegistry` for resolution by `summon`, `implicit()`, and autospecialization. Consumers import it by name. Orphan instances are rare and inherently non-local — this trade-off is acceptable.

### Name Clashes

If the user already has a `const` with the same name as the interface:

```typescript
interface Config { host: string; port: number; }
const Config = { default: { host: "localhost", port: 3000 } };

@derive(Eq)  // Can't generate a second `const Config`
```

The macro detects the existing value binding and **merges** the instance into it:

```typescript
interface Config { host: string; port: number; }
const Config = {
  default: { host: "localhost", port: 3000 },
  Eq: { equals: (a, b) => ... } satisfies Eq<Config>,
};
```

If the existing binding is not an object literal (e.g., a function call or class), the macro emits a diagnostic error with guidance.

### Non-Exported Types

If the interface is not exported, the companion const is also not exported. Same-file usage works as normal via `Foo.Eq`. Cross-file access is impossible by design — this is correct.

### Recursive Types

Self-referential instances work because JavaScript closures capture bindings, not values:

```typescript
@derive(Eq)
interface Tree<A> { value: A; children: Tree<A>[]; }

const Tree = {
  Eq: <A>(eqA: Eq<A>): Eq<Tree<A>> => ({
    equals: (a, b) =>
      eqA.equals(a.value, b.value) &&
      a.children.length === b.children.length &&
      a.children.every((c, i) => Tree.Eq(eqA).equals(c, b.children[i])),
  }),
};
```

`Tree.Eq` references itself inside the closure body, which is evaluated lazily at call time — after `Tree` is fully initialized.

### Circular Cross-File Dependencies

If `Foo` (file A) has a field of type `Bar` (file B), and `Bar` has a field of type `Foo`, both deriving `Eq`:

- File A: `Foo.Eq` references `Bar.Eq` → imports `Bar` from file B
- File B: `Bar.Eq` references `Foo.Eq` → imports `Foo` from file A

This is a circular module dependency. ES module semantics handle this if the instance properties are accessed lazily (inside function bodies, not at top-level initialization). Since `equals` is a function, `Bar.Eq` is only accessed when `equals` is called, not when the module initializes. **This works correctly** with standard ES module circular reference handling.

## Instance Resolution: Import-Scoped, Not Global

### Principle

Instance resolution should be scoped to what the current file has imported, not a global process-wide singleton. This matches TypeScript's module semantics — you can only use what you import — and eliminates ordering dependencies and stale-registry bugs.

With companions, this falls out naturally: if `consumer.ts` imports `User` and `Eq`, it can see `User.Eq` and `Eq.number` — exactly the instances reachable through its imports. The companion _is_ the registry for that file's scope.

### Implementation

The global `instanceRegistry` on `globalThis` can be retained as a **performance cache** — instances are registered globally as they are processed, but resolution is filtered to only return instances whose companion object is in scope (i.e., the data type or typeclass is imported in the current file). This avoids reprocessing every file's AST on each lookup while maintaining correct scoping.

```typescript
// Global cache (populated during macro expansion across all files):
globalThis.__typesugar_instanceRegistry = [
  { typeclassName: "Eq", forType: "Point", companionPath: "Point.Eq", sourceModule: "./point" },
  { typeclassName: "Eq", forType: "User", companionPath: "User.Eq", sourceModule: "./user" },
  ...
];

// Resolution filters to what's imported in the current file:
function resolveImplicit(typeclassName: string, forType: string, currentFileImports: Set<string>) {
  return instanceRegistry.find(i =>
    i.typeclassName === typeclassName &&
    i.forType === forType &&
    currentFileImports.has(i.forType)  // only if the data type is imported
  );
}
```

For concrete types at call sites, the companion reference (`User.Eq`) is already import-scoped — if `User` isn't imported, the code won't compile. The registry filtering is primarily relevant for `summon` and `implicit()` where the instance is looked up by type name rather than directly referenced.

### Registry Entry Format

```typescript
// Before:
{ typeclassName: "Eq", forType: "Point", instanceName: "eqPoint", derived: true }

// After:
{ typeclassName: "Eq", forType: "Point", companionPath: "Point.Eq", sourceModule: "./point", derived: true }
```

For generic types:

```typescript
{ typeclassName: "Eq", forType: "Pair", companionPath: "Pair.Eq", sourceModule: "./pair", derived: true, generic: true }
```

### resolveImplicit()

`resolveImplicit(typeclassName, forType)` returns the companion path (`"Point.Eq"`) instead of the flat name (`"eqPoint"`). The three-phase resolution in `transformImplicitsCall()` is unchanged in structure:

1. **Enclosing scope** — checks `ImplicitScope.available` for caller-provided instances (unchanged)
2. **Registry lookup** — returns `"Point.Eq"` instead of `"eqPoint"`, filtered to imported types
3. **Auto-derivation** — `tryDeriveViaGeneric()` generates an inline expression (unchanged)

### summon()

`summon<Eq<Point>>()` resolves via the registry to `Point.Eq`. Since `Point` must already be imported (the user is working with `Point` values), no additional import is needed. For generic summon (`summon<Eq<A>>()`), the result is the implicit parameter from the enclosing scope — unchanged.

### Autospecialization

`tryAutoSpecialize()` inlines dictionary method calls for zero-cost abstraction. The change is in instance detection:

```typescript
// Before: getInstanceName(arg) returns "eqPoint", checks registeredMethodsMap.get("eqPoint")
// After: getInstanceName(arg) returns "Point.Eq", checks registeredMethodsMap.get("Point.Eq")
```

`registerInstanceMethods()` is called with the companion path:

```typescript
// Before:
registerInstanceMethods("eqPoint", "Point", { equals: { params: ["a", "b"], source: "..." } });

// After:
registerInstanceMethods("Point.Eq", "Point", { equals: { params: ["a", "b"], source: "..." } });
```

The specialization cache key, hoisted function naming, and inlining logic are all unchanged — they operate on instance names opaquely.

## Migration from Current System

### What changes

| Component            | Before                                            | After                                                |
| -------------------- | ------------------------------------------------- | ---------------------------------------------------- |
| Typeclass companion  | `namespace Show { summon(), registerInstance() }` | `const Show = { string: showString, ... }`           |
| Instance naming      | `eqPoint` (flat variable)                         | `Point.Eq` (companion property)                      |
| Registry entries     | `instanceName: "eqPoint"`                         | `instanceName: "Point.Eq"`                           |
| `@derive` output     | `const eqPoint: Eq<Point> = { ... }`              | `const Point = { Eq: { ... } satisfies Eq<Point> }`  |
| Cross-file reference | `import { eqPoint } from "./point"`               | `import { Point } from "./point"` (already imported) |

### What stays the same

- `instanceRegistry` array structure (now used as a global cache, filtered by imports at resolution time)
- `resolveImplicit()` three-phase lookup (scope → registry → auto-derive)
- `ImplicitScope` propagation through the call stack
- Autospecialization pipeline (detect → resolve → inline → hoist)
- `tryDeriveViaGeneric()` auto-derivation
- Orphan instance handling (flat const + registry)

## Waves

### Wave 0: Audit — Typeclass Usage Inventory

Audit all current uses of typeclasses, instances, `summon`, `implicit()`, autospecialization, and the instance registry across the codebase to confirm the companion strategy is viable and identify every site that needs updating.

- [ ] Catalogue all `@typeclass` definitions and their generated companion namespaces
- [ ] Catalogue all `@derive` usages — on interfaces, classes, type aliases, generics
- [ ] Catalogue all `@instance` / `@impl` usages
- [ ] Catalogue all `summon()` call sites and what they resolve to
- [ ] Catalogue all `implicit()` parameter usages and their resolution paths
- [ ] Catalogue all autospecialization sites — `registerInstanceMethods()`, `tryAutoSpecialize()`
- [ ] Catalogue all direct references to flat instance variables (`eqPoint`, `showUser`, etc.) in user-facing code and tests
- [ ] Catalogue all uses of `instanceRegistry`, `resolveImplicit()`, `typeclassRegistry`
- [ ] Identify any patterns that don't fit the companion model (orphan instances, unusual merging, runtime-constructed instances)
- [ ] Identify edge cases: types with existing value bindings, classes with `@derive`, generic derives, recursive types
- [ ] Write up findings with a go/no-go recommendation and list of required changes per component

**Gate:** Complete inventory document with every affected file, function, and line number. Confirmed that no pattern is a dealbreaker for the companion approach.

### Wave 1: Audit — Documentation Inventory

Identify all documentation, examples, and user-facing content that references the current instance naming/import patterns and will need updating.

- [ ] Catalogue all docs (`docs/`, README files, CLAUDE.md) referencing instance patterns
- [ ] Catalogue all example/showcase files that demonstrate typeclasses, derive, summon, implicit
- [ ] Catalogue playground examples that will need updating
- [ ] Catalogue any blog posts, tutorials, or external docs linked from the repo
- [ ] Catalogue PEPs that reference the old pattern and may need amendments
- [ ] Note which docs should be updated during implementation waves vs. in a dedicated docs wave

**Gate:** Complete list of all documentation that needs updating, with priority order.

### Wave 2: Typeclass Companion Generation

- [ ] Replace `generateCompanionNamespace()` with companion const generation
- [ ] Typeclass companion holds primitive instances: `Eq.number`, `Eq.string`, etc.
- [ ] Move or remove `summon()`, `registerInstance()`, `hasInstance()` from the namespace
- [ ] Update `instanceVarName()` to return companion path format (`"Point.Eq"`)
- [ ] Tests: verify typeclass companion has correct primitive instances

**Gate:** `@typeclass interface Eq<T> { ... }` generates a `const Eq` with primitive instances accessible as `Eq.number`, `Eq.string`, etc.

### Wave 3: Data Type Companion Generation

- [ ] `@derive` on interfaces generates a companion const with typeclass instances as properties
- [ ] Handle existing value bindings (detect and merge or error)
- [ ] Use `satisfies` for type checking
- [ ] `@derive` on classes generates namespace declaration merging + property assignment
- [ ] Generic types generate factory functions on the companion
- [ ] Tests: verify `Point.Eq`, `User.Showable`, `Pair.Eq(eqA, eqB)` patterns

**Gate:** `@derive(Eq) interface Point { x: number }` produces `const Point = { Eq: { equals: ... } satisfies Eq<Point> }` and expanded code is valid standalone TypeScript.

### Wave 4: Registry and Resolution Updates

- [ ] Update `instanceRegistry` entries to use companion paths and source modules
- [ ] Update `resolveImplicit()` to return companion paths, filtered by current file's imports
- [ ] Update `transformImplicitsCall()` — registry lookup returns new format, scoped to imports
- [ ] Update `summon` macro to emit companion references
- [ ] Update `registerInstanceMethods()` to use companion paths
- [ ] Update `tryAutoSpecialize()` instance detection for companion format
- [ ] Verify autospecialization inlining works with companion-referenced instances
- [ ] Tests: `implicit()` resolution, `summon`, and autospecialization all work with companion instances

**Gate:** `function show<T>(x: T, s: Showable<T> = implicit()): string` called with `show(myUser)` resolves to `User.Showable` and autospecializes correctly.

### Wave 5: Cross-File and LSP Integration

- [ ] Verify cross-file derived instances reference companions of imported types
- [ ] Verify no additional imports are needed beyond what the type signatures require
- [ ] Update LSP semantic token provider for companion-style instances
- [ ] Verify Zed/Neovim show no false "Cannot find name" errors on macro-expanded code
- [ ] Update manifest schema if needed
- [ ] End-to-end test: multi-file project with typeclasses, derives, summon, implicit, autospecialization

**Gate:** Opening any showcase file in Zed shows zero false errors; `tsc --noEmit` passes on all expanded output.

### Wave 6: Update Examples and Showcase Files

- [ ] Update all `packages/*/examples/showcase.ts` to use companion patterns
- [ ] Update all test fixtures that reference flat instance names
- [ ] Verify all showcase transforms produce valid standalone TypeScript
- [ ] Run full test suite — all tests pass

**Gate:** `pnpm test` passes with zero failures. All showcase files use companion syntax.

### Wave 7: Update Documentation

- [ ] Update all docs identified in Wave 1
- [ ] Update playground examples to demonstrate companion patterns
- [ ] Update any PEPs that reference old patterns (add amendment notes)
- [ ] Review all user-facing error messages and diagnostics for stale references

**Gate:** All documentation accurately reflects the companion pattern. No references to flat instance names remain.

### Wave 8: Code Review and Validation

- [ ] Code review all changes from Waves 2–7
- [ ] Run full test suite and verify all tests pass
- [ ] Run playground in browser — verify all examples work correctly
- [ ] Run LSP in Zed — verify no false errors on all showcase files
- [ ] Run `typesugar run` on a multi-file project — verify expanded output is standalone valid TypeScript
- [ ] Test autospecialization end-to-end — verify zero-cost abstraction still works
- [ ] Test orphan instance fallback — verify flat const + registry still works for edge cases
- [ ] Performance check — verify no regression from import-scoped registry filtering

**Gate:** All tests pass, playground works, LSP shows no false errors, autospecialization produces correct output, no performance regression.

### Wave 9: Dead Code Cleanup and @impl Companion Support

- [x] Remove dead macro-system derive paths: `expandDeriving`, `deriveAttribute`, `derivingAttribute`, `createTypeclassDeriveMacro`, and the 5 `{Name}TC` derive macros — these were bypassed by the transformer's direct derive handling
- [x] Update `@deriving` JSDoc handling to route through the transformer's `expandDeriveDecorator` instead of the removed macro-system attribute
- [x] Add derive diagnostic checks (TS9101, TS9103, TS9104) to the transformer's derive handler
- [x] Update `@impl`/`@instance` attribute macro to emit companion property assignments alongside the flat const declaration
- [x] Update `getInstanceName` in specialization to handle `ParenthesizedExpression` and `AsExpression` nodes from `(X as any).Y` patterns
- [x] Auto-compute `companionPath` in `registerInstanceWithMeta` when `instanceValue` is provided
- [x] Add duplicate companion const detection in `createTypeclassDeriveMacro` (before removal) and transformer derive handler

**Gate:** Zero regressions from PEP-032. All pre-existing test failures unchanged. `@impl`-declared instances emit companion property assignments for non-primitive types.

### Wave 10: Transformer Source Map and Output Pipeline Cleanup

Replace the fragile dual-path output pipeline (surgical text replacement vs. AST printer) with a single, correct-by-construction pipeline. Replace the dual source map generators (ExpansionTracker + diff-based fallback) with a single AST-based source map generator.

**Background:** The `preserveBlankLines` option created two code paths: a "surgical" path using `ExpansionTracker.generateExpandedCode()` (which required every transform to manually opt in via `recordExpansion()`), and an AST printer fallback. The surgical path silently dropped any untracked transform — companion objects from `@derive`/`@impl`, implicit resolution, preprocessor macro expansion, extension method rewrites, and constructor erasure were all lost. Source maps had the same problem: `ExpansionTracker.generateSourceMap()` only covered tracked expansions, falling back to a line-level diff-based generator.

**Design:** A single output pipeline:

1. Always use `printer.printFile(transformedSourceFile)` for code generation (correct by construction)
2. Generate source maps by walking the transformed AST and reading `getSourceMapRange()` on each node, correlated with output token positions via TypeScript's scanner (no opt-in tracking)
3. Optionally restore blank lines using the source map (map output lines → original lines, insert blanks where original had gaps)

Source map generation algorithm:

1. Tokenize the output with `ts.createScanner()` — gives exact token positions
2. Walk the transformed AST depth-first in source order
3. Match each leaf node (identifiers, literals) to the next output token with the same text (incremental cursor)
4. Read `getSourceMapRange(node)` on each matched node for the original position
5. Build VLQ-encoded source map from the mappings

This approach is **complete** (handles all transform types without opt-in), **precise** (token-level granularity), and has **no fallbacks** (one code path for all cases).

- [ ] Implement `generateASTSourceMap()` using scanner-based token matching
- [ ] Audit all transform methods for missing `preserveSourceMap()` calls (the catalog identified 5–6 sites)
- [ ] Add missing `preserveSourceMap()` calls to: `tryAutoSpecialize`, return type stripping, recursive inlining
- [ ] Replace `ExpansionTracker.generateSourceMap()` + `generateDiffSourceMap()` with `generateASTSourceMap()`
- [ ] Remove `trackExpansions` force-enable from `preserveBlankLines` path
- [ ] Remove surgical text replacement from `runTypescriptTransformer` (already done)
- [ ] Retain `ExpansionTracker` only for `formatExpansions()` (focused diff view) — no longer on the critical path
- [ ] Implement source-map-based `restoreBlankLines()` — use mappings to identify where original had blank lines between consecutive output statements
- [ ] Add test: all playground examples produce identical output with and without `preserveBlankLines`
- [ ] Add test: source map round-trip — for each output line, verify the mapped original line is semantically correct
- [ ] Add test: `preserveBlankLines` output has blank lines between sections matching the original
- [ ] Include transformer package version hash in `api/compile.ts` LRU cache key to prevent stale results across rebuilds
- [ ] Inline primitive equality for all typeclasses that reference primitives (currently only `Eq`; also needed for `Ord`, `Hash`, `Show`)

**Gate:** Single code path for output generation and source maps. No `ExpansionTracker` on the critical path. All 35 playground examples pass in vitest AND in the browser. Source maps are character-level precise for all transform types. `preserveBlankLines` produces correctly formatted output using source map data.

## Design Decisions

### Why companions instead of import emission?

Import emission (the `ImportCollector`/`ImportEmitter` approach) treats the symptom — missing imports — by adding machinery to emit them. The companion approach eliminates the root cause: instances are unreachable without explicit imports. By making instances properties of types the user already imports, the import problem disappears entirely.

### Why put instances on the data type, not the typeclass?

Putting all instances on the typeclass companion (`Eq.Point`, `Eq.User`, etc.) would require cross-file mutation of the typeclass object or side-effect imports — both undesirable. Putting instances on the data type (`Point.Eq`, `User.Showable`) means each file only adds properties to its own exports. No mutation of imported objects, no side effects.

### Why import-scoped resolution instead of global?

The previous global `instanceRegistry` on `globalThis` was a process-wide singleton that accumulated instances across all files. This caused ordering dependencies and stale-registry bugs (instances visible that shouldn't be, or missing because a file hadn't been processed yet). Import-scoped resolution matches TypeScript's module semantics: you can only use what you import. The global registry is retained as a performance cache to avoid reprocessing, but resolution filters it to the current file's import scope.

### Why `satisfies` instead of type annotation?

`const Point = { Eq: { ... } satisfies Eq<Point> }` checks the instance against the typeclass interface while preserving the specific literal type. A type annotation (`Eq: { ... } as Eq<Point>`) would widen the type and lose property information. `satisfies` gives both type safety and precise inference.

### Why keep the runtime registry?

The companion pattern handles the common case: concrete, statically-known types. But generic code (`function sort<T>(xs: T[], ord: Ord<T> = implicit())`) needs runtime dispatch when `T` isn't known until the call site. The registry bridges this gap — `implicit()` resolution checks scope first, then the registry (filtered to imports), then tries auto-derivation. The companion is a better _naming convention_ for instances; the registry is the _resolution mechanism_.

## Consequences

### Benefits

- **Expanded code is valid TypeScript** — can be typechecked, formatted, linted independently
- **No import coordination** — importing a type brings its instances; importing a typeclass brings its primitives
- **Import-scoped resolution** — no stale-registry or ordering bugs; matches TS module semantics
- **LSP server works without SFINAE hacks** — no false "Cannot find name" errors
- **Simpler macro implementation** — no `requireImport` API, no import collector, no merge logic
- **Consistent with TypeScript patterns** — declaration merging is well-understood
- **Tree-shaking friendly** — bundlers can see which companion properties are accessed

### Trade-offs

- **API asymmetry for generics** — `Point.Eq` is a value, `Pair.Eq` is a factory function
- **Namespace-to-const migration** — existing companion namespace generation must be reworked
- **Orphan instances remain second-class** — no companion to attach to; fall back to flat const
- **Name clash detection** — macro must handle existing value bindings gracefully

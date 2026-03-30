# PEP-032: Self-Contained Macro Expansions via Import Emission

**Status:** Draft
**Date:** 2026-03-31
**Author:** Claude (with Dean Povey)
**Depends on:** PEP-011 (Extension Methods), PEP-025 (Match API), PEP-031 (LSP Server)

## Context

Macro expansions generate code that references symbols not imported in the user's file. For example, `@derive(Eq)` on `interface Point` expands to:

```typescript
const eqPoint: Eq<Point> = {
  equals: (a, b) => eqNumber.equals(a.x, b.x) && eqNumber.equals(a.y, b.y),
  ...
};
```

But `Eq`, `eqNumber`, and the generated `pointEq` binding all reference symbols with no corresponding import. The user wrote:

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

**Rust** — Proc macros emit fully qualified paths (`::core::cmp::PartialEq`). No imports needed because Rust has absolute paths for all items. The macro output is self-contained.

**Scala 3** — `derives Eq` generates a `given Eq[T]` in the companion object. Resolution uses the implicit/given scope: the compiler searches companion objects of types mentioned in the signature, plus explicitly imported scopes. The user doesn't import implementation details, but Scala's implicit search is a compiler feature — TypeScript has nothing equivalent.

**Haskell** — `deriving (Eq, Ord)` is handled by the compiler which has built-in knowledge of these classes. For `GeneralizedNewtypeDeriving` and `DeriveAnyClass`, the compiler delegates to the typeclass's default methods or `Generic` machinery — all resolved through the module system with the typeclass in scope.

**Key insight from all three:** The user imports the _typeclass_ (or it's in scope via language rules), and the _implementation details_ are resolved automatically by the compiler/macro system. The user never manually imports primitive instances or helper functions.

## Design

### Strategy: Transformer-Level Import Collection

Rather than having each macro independently emit imports (which leads to duplication and ordering issues), the transformer pipeline collects required imports during expansion and emits them in a single pass after all macros have run.

### Architecture

```
User source
    ↓
[Preprocessor] — desugars .sts syntax
    ↓
[Macro Expander] — expands macros, records import requirements
    ↓
[Import Collector] — deduplicates and merges required imports  ← NEW
    ↓
[Import Emitter] — inserts/updates import statements          ← NEW
    ↓
Expanded TypeScript (valid, self-contained)
```

### Import Requirement API

Each macro expansion can declare the symbols it needs via a new API on the expansion context:

```typescript
interface MacroExpansionContext {
  // Existing
  expand(node: ts.Node): ts.Node;

  // New: declare that the expansion requires these symbols
  requireImport(from: string, symbols: ImportRequirement[]): void;
}

type ImportRequirement =
  | { kind: "value"; name: string; alias?: string } // import { name } from "..."
  | { kind: "type"; name: string; alias?: string } // import type { name } from "..."
  | { kind: "namespace"; name: string }; // import * as name from "..."
```

### How it works for built-in derives

When the `@derive(Eq)` macro expands `Point`:

```typescript
ctx.requireImport("@typesugar/typeclass", [{ kind: "type", name: "Eq" }]);
ctx.requireImport("@typesugar/typeclass/instances", [{ kind: "value", name: "eqNumber" }]);
```

The Import Collector gathers all requirements from all macro expansions in the file, deduplicates them, and the Import Emitter produces:

```typescript
import type { Eq } from "@typesugar/typeclass";
import { eqNumber } from "@typesugar/typeclass/instances";
```

These are merged with the user's existing imports — if the user already imports `Eq`, no duplicate is added.

### How it works for user-defined typeclasses

This is the critical case. When a user defines:

```typescript
// mylib/showable.ts
@typeclass
interface Showable<T> {
  show(x: T): string;
}
```

And later derives it:

```typescript
// app.ts
import { Showable } from "./mylib/showable";

@derive(Showable)
interface User { name: string; age: number; }
```

The `@derive` macro needs to know:

1. The `Showable<T>` type → already imported by the user
2. Primitive instances (`showableString`, `showableNumber`) → need to be imported
3. The generated `showUser` binding → no import needed (it's generated in this file)

**Resolution strategy:**

The typeclass registry (populated by `@typeclass` macro) records:

```typescript
{
  name: "Showable",
  module: "./mylib/showable",        // where the typeclass is defined
  instances: {
    string: { module: "./mylib/showable", name: "showableString" },
    number: { module: "./mylib/showable", name: "showableNumber" },
    boolean: { module: "./mylib/showable", name: "showableBoolean" },
  }
}
```

When `@derive(Showable)` expands `User`, it:

1. Looks up `Showable` in the registry
2. Determines which primitive instances it needs based on `User`'s field types (`string`, `number`)
3. Calls `ctx.requireImport("./mylib/showable", [{ kind: "value", name: "showableString" }, { kind: "value", name: "showableNumber" }])`

The registry is the key — it's Scala's implicit scope equivalent. Instead of the compiler searching companion objects at resolve time, the typeclass macro pre-registers all available instances at definition time, and the derive macro looks them up at expansion time.

### Handling transitive dependencies

If `@derive(Eq)` on a type with a field of type `Color` needs `eqColor`, and `eqColor` is defined in the user's code (from an earlier `@derive(Eq)` on `Color`), the macro system needs to handle two cases:

1. **Same file** — `eqColor` was generated earlier in the same file. No import needed.
2. **Different file** — `eqColor` is in another module. The registry records where it was generated, and `requireImport` is called.

For case 2, the instance registry already tracks this:

```typescript
// After @derive(Eq) on Color in colors.ts:
registry.registerInstance("Eq", "Color", {
  module: "./colors",
  name: "eqColor",
});
```

### Import path resolution

Import paths in `requireImport` must be relative to the file being expanded, not absolute. The Import Emitter resolves paths:

- `@typesugar/typeclass` → kept as-is (package import)
- `./mylib/showable` → resolved relative to the current file
- Paths from the registry are stored as absolute and converted to relative at emit time

### Merge rules

When merging with existing imports:

1. If the user already imports `{ Eq } from "@typesugar/typeclass"`, don't duplicate
2. If the user imports `type { Eq }` but the expansion needs the value, upgrade to a value import
3. If the user imports `* as TC from "@typesugar/typeclass"`, the expansion can reference `TC.Eq` — but this is complex; initial implementation should add a separate named import
4. Generated imports are placed after user imports, before the first non-import statement

### Interaction with the manifest

The macro manifest (`typesugar.manifest.json`) already records which module each macro comes from. This can be extended to include instance metadata:

```json
{
  "macros": {
    "decorator": {
      "derive": {
        "module": "@typesugar/derive",
        "instances": {
          "Eq": {
            "typeclass": "@typesugar/typeclass",
            "primitives": {
              "number": "eqNumber",
              "string": "eqString",
              "boolean": "eqBoolean"
            }
          }
        }
      }
    }
  }
}
```

This allows the LSP server's semantic token provider and code actions to understand the full dependency graph without running the transformer.

## Waves

### Wave 1: Import Requirement API + Collector

- [ ] Add `requireImport()` method to `MacroExpansionContext`
- [ ] Implement `ImportCollector` — accumulates requirements, deduplicates
- [ ] Implement `ImportEmitter` — merges with existing imports, emits statements
- [ ] Wire into `TransformationPipeline`: after all macros expand, run Import Emitter
- [ ] Tests: verify expanded code includes necessary imports

**Gate:** `transformCode('@derive(Eq) interface P { x: number }')` produces output with `import { eqNumber } from "..."` and `import type { Eq } from "..."`

### Wave 2: Update built-in derives

- [ ] `@derive(Eq)` — emit imports for `Eq<T>`, primitive `eq*` instances
- [ ] `@derive(Ord)` — emit imports for `Ord<T>`, primitive `ord*` instances
- [ ] `@derive(Clone)` — emit imports (if any runtime deps)
- [ ] `@derive(Debug)` — emit imports
- [ ] `@derive(Hash)` — emit imports
- [ ] `@derive(Default)` — emit imports
- [ ] `@derive(Json)` — emit imports
- [ ] `@derive(TypeGuard)` — emit imports
- [ ] Other macros: `comptime`, `match`, `summon`, `pipe` — audit and add `requireImport` calls
- [ ] Verify all showcase files produce valid standalone TS

**Gate:** Every `packages/*/examples/showcase.ts` produces expanded code that passes `tsc --noEmit` independently

### Wave 3: User-defined typeclass support

- [ ] Extend typeclass registry to record instance locations (module path + export name)
- [ ] `@typeclass` macro registers itself and its primitive instances in the registry
- [ ] `@derive` macro looks up the registry for required instances and calls `requireImport`
- [ ] `@instance` / `@impl` macro registers the new instance in the registry
- [ ] Handle transitive dependencies (derive Eq on a type containing another derived type)

**Gate:** User-defined `@typeclass` + `@derive` in separate files produces valid expanded code with correct cross-file imports

### Wave 4: LSP + manifest integration

- [ ] Update manifest schema with instance metadata
- [ ] LSP server uses self-contained expansions (no more SFINAE dependency for import errors)
- [ ] Verify Zed/Neovim show no false "Cannot find name" errors on macro-expanded code

**Gate:** Opening `packages/derive/examples/showcase.ts` in Zed shows zero false errors

## Design Decisions

### Why not fully qualified paths (like Rust)?

TypeScript's module system is import-based — there's no `::@typesugar/typeclass::Eq` syntax. Every cross-module reference must go through an import statement. This is a fundamental difference from Rust.

### Why not ambient declarations?

We could generate `.d.ts` files that declare macro-generated symbols globally. This avoids import issues but:

1. Breaks tree-shaking (bundlers can't see the dependency)
2. Pollutes the global namespace
3. Doesn't work with strict module resolution
4. Makes it impossible to have two files with the same derived type name

### Why a registry instead of Scala-style implicit search?

TypeScript has no implicit resolution. We could implement a custom resolution algorithm, but it would be:

1. Non-standard (confusing for TS developers)
2. Slow (requires scanning many files)
3. Fragile (depends on import graph analysis)

The registry is explicit, fast, and predictable. It's populated at macro definition time (`@typeclass`), updated at instance creation time (`@derive`, `@instance`), and queried at derive time. This mirrors how Scala's companion object instances work — they're statically known at the definition site.

### Why collect-then-emit instead of emit-as-you-go?

Multiple macros in a single file may need the same import. If each macro inserts its own import statement:

1. Duplicate imports appear
2. Import positions shift as earlier macros insert, breaking later macros' position tracking
3. AST manipulation becomes order-dependent

Collecting all requirements first and emitting once avoids all these issues.

## Consequences

### Benefits

- **Expanded code is valid TypeScript** — can be typechecked, formatted, linted independently
- **LSP server works without SFINAE hacks** — no false "Cannot find name" errors
- **User-defined typeclasses work seamlessly** — same derive experience as built-in ones
- **Bundlers see real dependencies** — tree-shaking works correctly on expanded code

### Trade-offs

- **Registry maintenance** — every typeclass and instance must be registered; forgetting breaks derives
- **Import emission adds complexity** — path resolution, merge logic, ordering
- **Manifest grows** — instance metadata adds size (mitigated by only including what's used)

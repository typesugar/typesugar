# PEP-052: Import-Scoped Macro Activation (cats-style syntax)

**Status:** Draft (2026-06-29)
**Date:** 2026-06-29
**Author:** Claude (with Dean Povey)
**Extends:** [PEP-017](PEP-017-derive-unification.md) ("everything is a typeclass")
**Supersedes (in part):** [PEP-027](PEP-027-use-extension-emit-registration.md) (`"use extension"` global registration)
**Relates to:** [PEP-032](PEP-032-macro-expansion-import-emission.md) (companions), [PEP-034](PEP-034-language-service-parity.md) (LS infra)

## Summary

Make every piece of typesugar sugar **activate only through an explicit import in
the file that uses it**, the way Scala/cats activates typeclass syntax
(`import cats.syntax.eq.*`). Remove all ambient behavior: the process-global
instance/type-rewrite registry, the hardcoded builtins (`Eq.number`,
`BUILTIN_METHOD_RECEIVER_NAMES`, builtin macro-name lists), and label/operator
rewrites that fire regardless of imports. The compiler becomes a **generic engine
over userland annotations**; std becomes "just a library" that uses the same
public surface as third parties.

## Motivation

Today, resolution is **ambient**:

- The landing page describes the current behavior plainly: _"the compiler sees
  `===` on a `User`, resolves the `Eq` typeclass, **auto-derives** an instance,
  and inlines it"_ — with no import, no `@derive`, nothing in the file asking for
  structural equality.
- Operators/instances resolve through a **process-global registry** populated by
  side-effecting registration as files are transformed.
- There are **hardcoded builtins** (`Eq.number`, a `BUILTIN_METHOD_RECEIVER_NAMES`
  set, builtin macro names), so std is privileged and third-party macros are not
  first-class.

This is not just a style problem. The global registry caused a real, shipped CI
failure: `tests/match-destructure.test.ts` passed in isolation but failed in the
full sharded run because another test file had registered `Option` as `@opaque`
and the state **leaked across files**, flipping the `None` codegen (fixed in
PR #29 by clearing the registry per-test — a band-aid over the architecture).
Ambient activation means non-local reasoning, order-dependence, and a privileged
standard library.

### Goals

1. **Explicit:** sugar activates only via imports visible in the using file.
2. **Local & deterministic:** a file's behavior depends only on its own imports +
   the types it references — no global state, no cross-file leakage.
3. **No hardcoded magic:** the compiler special-cases no type, operator, label, or
   macro name. Std uses the identical public mechanism as third parties.
4. **Faithful to Scala/cats:** instances are data resolved from scope; _syntax_
   (operators/methods) is activated by importing syntax modules; coherence is
   **local** (scope decides; ambiguity is an error), not global.

## Principle: two trigger classes, one import rule

Every macro kind is triggered in one of two ways:

| Trigger class | Examples                                                   | The trigger is…                                                                              | Activation                                                     |
| ------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Named**     | `comptime(x)`, `` sql`…` ``, `@derive(Eq)`, `Refined<T,P>` | an **imported identifier** (call, tag, decorator, type alias)                                | the import **is** the activation — already explicit            |
| **Syntactic** | `a === b`, `a + b`, `let:`/`requires:` labels, `F<A>` HKT  | a **syntactic form** (operator token, statement label, type application) — no name to import | an explicit **`@syntax-*` activation import** opts the file in |

The single rule: **nothing rewrites unless the using file imports the thing that
activates it.** For named triggers that's automatic. For syntactic triggers we
introduce activation-import markers (below).

## Part 1 — Typeclasses, operators, and methods

### Three tiers of escalating explicitness

```
1. Instance        @typesugar/eq  /  @derive(Eq)        → data only, no sugar
2. Method syntax   import "@typesugar/syntax/eq"        → a.eq(b) / a.notEq(b)   (additive, safe)
3. Operator syntax import "@typesugar/syntax/eq/ops"    → a === b / a !== b       (redefines a primitive — loudest opt-in)
```

- **Methods** are additive (introduce a name that didn't exist), so they're the
  ordinary "syntax" import.
- **Operators** redefine a native primitive, so they require a _separate, louder_
  import. A file that wants typeclass methods but wants `===` to stay vanilla
  simply **stops at tier 2**. Tier 3 implies tier 2 (operators pull in methods).

This is finer-grained than cats (which bundles operator+method) — appropriate
because TS has stronger reason to keep operator overloading at arm's length.

### Resolution algorithm (for `a === b` in file F)

1. **Activations:** collect from F's import graph which `@syntax-operators` /
   `@syntax-methods` markers are present and which typeclasses they name. If no
   activated typeclass declares `@op ===`, stop — `a === b` is native.
2. **Candidate typeclasses:** among activated ones, find those mapping `@op ===`
   (read from `@typeclass`/`@op` JSDoc via the checker).
3. **Instance search** for the operand type `T`, from scope only: imported
   `@instance` values, or the type's companion / `@derive` (PEP-032). No global
   registry.
4. **Rewrite** `a === b` → `eqT.equals(a, b)` (inlined/specialized). If no instance
   for `T` → native `===`. If ≥2 activated typeclasses claim `===` and both have an
   instance for `T` → **ambiguity error** (local coherence).

`!==`, and `< > <= >=` (via `Ord`), follow the same algorithm under
`@typesugar/syntax/ord` / `…/ops`.

### Method form and reference-equality escape

- **`a.eq(b)` / `a.notEq(b)`** — the method form of `Eq`, activated by tier 2.
  The method name comes from the typeclass declaration (author-controlled), so
  third parties name their own surface.
- **Reference equality**, needed only inside operator-activated files:
  - `refEq(a, b)` — a function that emits native `a === b`.
  - `a.ref === b.ref` — `a.ref` is a zero-cost identity that retypes the value as
    `Ref<T>` (a brand with **no** `Eq` instance). By rule (3) it fails the
    instance search and falls through to native `===` — **no special-casing**.
  - Both emit native `===` ("the `===` you'd get without typesugar"), not
    `Object.is`.

### Loose equality

`==` / `!=` are left native, plus an **opt-out-able lint/diagnostic** discouraging
them (we are leaning into `===` as the typeclass operator).

## Part 2 — The same strategy for the other macro kinds

The two-trigger-class rule covers all six macro kinds:

| Macro kind                                                                        | Trigger                          | Class         | Import-scoped how                                                                                                                                                                                     |
| --------------------------------------------------------------------------------- | -------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Expression** (`comptime`, `staticAssert`, `pipe`)                               | imported call ident              | named         | already explicit — resolve the callee symbol; expand iff its declaration is `@macro`. No builtin name list.                                                                                           |
| **Tagged template** (`sql`, `regex`, `html`)                                      | imported tag ident               | named         | already explicit — same, on the tag symbol.                                                                                                                                                           |
| **Attribute / derive** (`@derive`, `@reflect`, `@tailrec`)                        | imported decorator ident         | named         | already explicit — the decorator symbol's `@attribute-macro`/`@deriving` declaration drives it; derivables (`Eq`…) are imported too.                                                                  |
| **Type** (`Refined<T,P>`, `Kind<F,A>`)                                            | imported type alias              | named         | already explicit — the alias is imported; recognized by its `@type-macro` declaration.                                                                                                                |
| **Operators** (`===`, `+`, `<`)                                                   | operator token                   | **syntactic** | **NEW:** `@syntax-operators <TC>` activation import (Part 1).                                                                                                                                         |
| **Labeled block** (`let:`/`yield:` do-notation, `requires:`/`ensures:` contracts) | statement label                  | **syntactic** | **NEW:** `@syntax-labels <macro>` activation import — e.g. `import "@typesugar/contracts/syntax"` activates `requires:`/`ensures:` in the file. Replaces today's global `triggerLabels` registration. |
| **HKT** (`F<A>` → `Kind<F,A>`)                                                    | type application of a type param | **syntactic** | **NEW:** `@syntax-hkt` activation (e.g. `import "@typesugar/hkt/syntax"`), combined with the existing `@hkt` declaration tier. (Nuanced — see Open Questions.)                                        |

**Named-trigger macros are already the model** — importing the symbol _is_ the
opt-in. The only work is **de-magicking**: resolve them purely from the imported
symbol's macro annotation, deleting any hardcoded builtin name lists, so a
third-party `comptime`-style macro is resolved identically to std's.

**Syntactic-trigger macros** (operators, labels, HKT) all gain the **same
`@syntax-*` activation-import mechanism**. A file with no such marker in its import
graph is never a rewrite candidate for that form — which also gives the transformer
a cheap, correct **per-file gate** (the original question that started this thread:
"the transformer should only be in scope if there are appropriate imports").

## Part 3 — The generic engine (no hardcoded magic)

The compiler special-cases nothing. All behavior derives from userland
annotations the type-checker can read:

- `@typeclass` + `@op <token>` — declares a typeclass and which operator/method a
  member maps to.
- `@instance` / `@impl`, `@derive` / `@deriving` — instances (data) + derivation
  strategies, attached to types (companions).
- `@macro` / `@attribute-macro` / `@type-macro` — marks an exported symbol as a
  named-trigger macro.
- `@syntax-methods <TC>`, `@syntax-operators <TC>`, `@syntax-labels <macro>`,
  `@syntax-hkt` — activation markers; importing a module that carries one opts the
  importing file into that syntactic rewrite.

### Third-party authoring example (a `+` for money)

```ts
// @acme/money — typeclass (declares the operator/method mapping)
/** @typeclass */
export interface Add<A> {
  /** @op + */
  add(a: A, b: A): A;
}

// instance (data)
/** @instance */
export const addMoney: Add<Money> = { add: (a, b) => new Money(a.cents + b.cents) };

// activation markers (the import handles)
// @acme/money/syntax/add      →  /** @syntax-methods Add */   export {};
// @acme/money/syntax/add/ops  →  /** @syntax-operators Add */ export {};
```

A consumer:

```ts
import { Money } from "@acme/money";
import "@acme/money/syntax/add/ops"; // opt into the + operator HERE

const total = a + b; // → addMoney.add(a, b), inlined. Without the import: native +.
```

The transformer needs **zero** knowledge of `Add`, `Money`, or `+`. Std's `Eq`
goes through this exact path — the proof the mechanism is complete (if std needed
a builtin, the design would be leaky).

## Migration — de-magicking std

1. Delete the process-global instance/type-rewrite registry; resolve from scope
   (imports + companions) via the checker.
2. Delete hardcoded builtins (`Eq.number`, `BUILTIN_METHOD_RECEIVER_NAMES`,
   builtin macro-name lists). Reship as ordinary instance modules
   (`@typesugar/eq` etc.) and `@syntax-*` markers.
3. Convert `"use extension"` (PEP-027) global registration → `@syntax-methods`
   imports.
4. Convert label macros (contracts `requires:`/`ensures:`, do-notation) from
   global `triggerLabels` → `@syntax-labels` imports.
5. Update the language service (PEP-034) to use the same import-scoped discovery
   (it already has the checker; lexical resolution is _easier_ than the registry).
6. Update docs (`getting-started`, `type-safety`, per-package guides): operators
   and methods now require the relevant `syntax` import; `@derive`/instance is
   required for `===` (no more auto-derive-from-nowhere).

Being **pre-release with no consumers**, this is the ideal time; behavior changes
are acceptable.

## Coherence

Scala-style **local** coherence: multiple instances may exist; scope decides;
ambiguity is a compile error. This trades global coherence (Rust/Haskell) for
locality and flexibility, and is the deliberate choice implied by "follow the
Scala model." Consequence to document: e.g. a structure built with one `Ord` and
queried with another is the user's responsibility.

## Decisions (proposed defaults)

1. **Tiers:** methods and operators are **separate** imports (tier 2 vs tier 3),
   with bundles `@typesugar/syntax/all` (methods) and `…/all/ops` / a `prelude`
   (incl. operators). ✅ proposed.
2. **Operator syntax imported but no instance for `T`:** **native fallback +
   opt-in lint** (friendlier than cats's hard error, since `===` is already
   valid TS). ✅ proposed.
3. **Reference equality:** ship **both** `a.ref` and `refEq()`, both emitting
   native `===` (not `Object.is`). ✅ proposed.
4. **Loose `==`/`!=`:** native + opt-out-able discouragement lint. ✅ proposed.

## Open questions

- **HKT activation granularity.** `F<A>` rewriting is pervasive in FP code;
  requiring a per-file `@syntax-hkt` import may be friction. Options: (a) per-file
  syntax import like everything else (consistent); (b) activate when the
  enclosing declaration carries `@hkt` (more local to the declaration, less to the
  use site). Leaning (a) for consistency, but wants validation against real FP
  code ergonomics.
- **Naming** of the activation markers and syntax module paths (`/syntax/eq` vs
  `/eq/syntax`, `@syntax-operators` vs `@op-syntax`).
- **Diagnostics** for "you wrote `a === b` and an instance exists but you didn't
  import the operator syntax" — a "did you mean to `import …/ops`?" hint.
- **Phasing:** land the engine + Eq/Ord first (Part 1), then migrate labels/HKT
  (Part 2), then delete the global registry. Each is a wave.

## Acceptance criteria

- No process-global instance/type-rewrite registry; resolution is purely
  scope-based (verified by a test that previously relied on cross-file leakage —
  e.g. the match-destructure case — passing without any registry reset).
- No hardcoded type/operator/macro names in the transformer; std `Eq`/`Ord`/etc.
  are ordinary imported libraries.
- A third-party typeclass with `@op`/`@instance`/`@syntax-*` gets operators,
  methods, and IDE support with zero compiler or plugin changes (covered by a
  fixture package in the test suite).
- A file that imports no `@syntax-*` marker and no named macro is byte-for-byte
  unchanged by the transformer.

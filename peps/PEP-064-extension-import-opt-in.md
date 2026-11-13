# PEP-064: Imported Objects Supply Extension Methods Only When the Import Opts In

**Status:** In Progress (Waves 1–2 in review: PRs #97, #98)
**Date:** 2026-11-13
**Author:** Claude (with Dean Povey)
**Related:** [PEP-027](PEP-027-use-extension-emit-registration.md) (`"use extension"`
registration), [PEP-052](PEP-052-import-scoped-macro-activation.md) (import-scoped
activation), [PEP-054](PEP-054-diagnostic-suppression-rules-naming.md) (suppression rules),
audit F23 (JSDoc `@derive` applies only to imported derivables, PR #85), PR #86 (the open
decision this PEP settles).

## Context

An extension call `recv.m(args)` is rewritten to a call on an import of the file. Which
imports qualify is decided in one place, `findImportedExtensionMatches`
(`packages/macros/src/extension-imports.ts`), shared by the transformer's rewrite and the
ExtensionMethodCall diagnostic suppression rule, so `typesugar check` hides the
pre-transform TS2339 exactly where `typesugar build` rewrites the call.

Before this PEP, an import qualified as a provider when it was:

1. a function named after the method whose first parameter accepts the receiver
   (`import { clamp }` for `(42).clamp(0, 100)`); or
2. **any** imported object or namespace with a callable member of that name whose first
   parameter accepts the receiver (`receiverMatchesFirstParam`,
   `packages/core/src/extension-receiver.ts`), minus a few exclusions (default-lib members,
   `declare global` stubs, native methods, typeclass instances for another type, named
   imports of module namespaces that had not opted in).

Rule 2 is the problem. A member taking `unknown`, `any`, an unconstrained generic `T`, or
`A | null` accepts every receiver, so ordinary utility objects take over calls that should
be TS2339 errors, and the suppression rule hides the TS2339. `typesugar check` exits 0.

### Reproduction (origin/main 86bcf8c7, 2026-11-13)

```ts
// logger.ts
export const log = {
  info(msg: unknown): void {
    console.log(msg);
  },
};
export const util = {
  identity<T>(x: T): T {
    return x;
  },
};

// b.ts
import { log, util } from "./logger";
const user = { id: 1 };
export const x = user.info(); // expands to log.info(user)
export const y = (5).identity(); // expands to util.identity(5)
```

Also `import { ZeroCostOptionOps } from "@typesugar/fp"; name.isSome()` with
`name: string` expanded to `ZeroCostOptionOps.isSome(name)`. Native methods were already
protected (`hasNativeMethod`), so the harm is that mistakes compile silently and do
something nobody wrote.

PR #86 framed this as fp's `Option` namespace capturing calls; that framing does not
reproduce (`Option<A>` is an `@opaque` interface, routed through the type rewrite registry
first). The hole is the general one above.

### Why a declaration-side marker doesn't work

The first attempt was to require the provider object to be declared in a `"use extension"`
module or carry `@extension`. Two problems:

- `"use extension"` is a directive prologue in the source; it is not in a published
  `.d.ts`. std's `*Ext` objects in `dist/` carry no marker at all. A declaration-side rule
  would make a package's objects providers inside its own monorepo and not for its users.
- It is the wrong place to say it. Whether `log.info` should serve `user.info()` is a
  decision about the calling file, and the reader of that file should be able to see it.

An experiment with a declaration-side opt-in broke 5 of 9,453 tests, all of them real users
of `EffectExt` or of an unmarked user namespace (listed under Migration).

## Decision (Dean, 2026-11-13)

**Import-site opt-in, Scala-3 style: an ordinary method is never an extension.**

```ts
/** @extension */
import { log } from "./logger";

user.info(); // → log.info(user)
```

An imported object or namespace member is an extension provider only if:

- **(a)** its import declaration carries a JSDoc `@extension` tag at a real tag position
  (a line-start tag, as `isJSDocTagAtLineStart` defines it for every other typesugar JSDoc
  tag); or
- **(b)** it comes through `import * as X` (already the documented opt-in: the namespace
  import is itself the statement "I want this module's functions"); or
- **(c)** it is declared as a typeclass instance (an `@impl`/`@instance` value,
  `impl(...)`, `derived<TC<T>>()`), for receivers of its own type
  (`instanceServesReceiver`, unchanged). An instance exists to supply its methods, so it
  needs no tag. A value whose only sign of being an instance is a `TC<T>` type annotation
  does not qualify without the tag: whether `TC` is a typeclass is read by its name
  (`isTypeclassDeclared`, the pattern PEP-062 Wave 11 is removing), and a diagnostic
  filter without a program cannot read it at all, so an ordinary `users: Repo<User>`
  object would pass in `check` and be rejected by `build` (found in the Wave 1 review).

The tag belongs to the import declaration, so it covers every binding of that declaration:
`/** @extension */ import { EffectExt, Effect } from "..."` opts in both, and the `Effect`
module namespace's `map` then competes with `EffectExt.map` (an ambiguity error). Keep
extension objects in an import of their own. A per-specifier form is not possible: TypeScript
does not attach JSDoc to an import specifier.

Unchanged:

- A bare imported function named after the method (`import { clamp }` →
  `(42).clamp(0, 100)`). The name match is the opt-in.
- The exclusions that apply to every provider: default-lib members, `declare global` stubs
  seen through an apparent type, member providers when the receiver has a native method.
- Ambiguity reporting: two providers of the same method for one receiver are still an
  error, whichever opt-in each used.

### Declaration-side markers

`"use extension"` and `@extension` on declarations keep doing what they do today:
`"use extension"` emits registration calls for the module's functions (PEP-027) and marks
the module for the standalone extension registry; `@extension` on a function is the
attribute macro that registers it.

They do **not** qualify an object as a provider, in-repo or published. Reasons:

1. **One behaviour for source and `.d.ts`.** If an in-repo `"use extension"` module's
   objects qualified, the same import would provide extensions when the package is consumed
   from its source (the monorepo, project references, a path alias) and silently stop when
   consumed from `dist/`. Every test in this repo consumes packages from source, so the
   difference would be invisible here and hit users.
2. **The reader of the call site sees it.** The tag sits on the import in the same file as
   the call.
3. **One rule to document.** "Tag the import" is the whole story for objects.

With this, the old special case for a named import binding a whole module namespace
(`import { Effect } from "effect"`, where the package does `export * as Effect`, excluded
unless the module had opted in) is gone: untagged, it is not a provider like any other
object; tagged, the user asked for it.

### The tag is not an attribute macro

`@extension` is also the name of the attribute macro that registers a function. The JSDoc
macro dispatcher only looks at declaration nodes (`isJSDocMacroTargetNode`: interfaces,
classes, type aliases, variables, functions, enums), never at an `ImportDeclaration`, so the
tag on an import is never dispatched as the attribute macro (the only warning it can get is
Wave 2's "no effect" warning below). Wave 1 tests
this through the transformer, `typesugar expand`, the language service and unplugin
(PEP-056 parity).

TypeScript attaches a JSDoc comment to an `ImportDeclaration`: `ts.getJSDocTags(importDecl)`
returns the tag on TS 5.9.3 and 6.0.3 (checked 2026-11-13; the repo supports 5.9–6.x). The
comment survives `tsc` emit unchanged, which is harmless.

### Unused imports

TypeScript doesn't count an extension call as a use of the import that provides it, so
under `noUnusedLocals` an import used only through extension calls is reported
(TS6133/TS6192/TS6196). This was already true for bare functions before this PEP (checked:
`import { shout }` used only as `"hi".shout()` gives TS6133 under `typesugar check`), and a
tagged object import would hit it the moment a user writes what this PEP asks for. Wave 2
adds an **ExtensionImport** suppression rule, mirroring F23's `JSDocDeriveImport`: an unused
import diagnostic is hidden when every binding it reports serves at least one extension call
in the file, decided per call as the rewrite decides it (`extensionImportUses`,
`packages/macros/src/extension-imports.ts`): `findImportedExtensionMatches`, then
`chooseExtensionMatch`, the one rule both use for which of several matches the rewrite
calls (so `import * as L` beside `import { shout }` from the same module is still reported
unused: the rewrite calls `shout`). Only calls whose method name an import could provide
are asked; a receiver that is itself an extension call gets the provider's return type, as
the rewrite recovers it; calls in a scope opted out of extensions are skipped.

The rule is a suppression rule, so it runs over the source as written, without the
transform. Two differences from the rewrite remain: a same-file `@extension` function the
rewrite prefers over an import (the live registry is the transformer's) still counts the
import as used; and when one declaration binds a served name and an unused one, TypeScript
reports the whole declaration (TS6192, "All imports in import declaration are unused") and
the rule keeps it, since a suppression rule can hide a diagnostic but not narrow it.

### A tag that does nothing

A tagged import none of whose named or default bindings was the object of an extension call
the rewrite emitted in the file gets a warning: the tag has no effect (nothing uses the
import as an extension object, it only binds functions, or it is an `import * as X`, which
needs no tag). This mirrors F23's inactive `@derive` warning: a tag that silently does
nothing is worse than one that says so. It is a warning with no code of its own, like F23's.

The warning is not a second decision: the rewrite records the qualifier of each object
extension call it emits (`tryRewriteExtensionMethod`'s `onRewrite`), and the transformer
reads that set after visiting the whole file (live same-pass state, CLAUDE.md "Resolving
things a macro just generated"). Chained receivers, opt-out scopes and registry precedence
are therefore exactly the rewrite's. It is reported at the tag by every entry point that
transforms the file (`check`, `build`, `expand`, the language service, unplugin, the
playground). Not detected: a tag on the import of a declared typeclass instance, which needs
no tag either.

## Rejected alternatives

- **Import attributes** (`import { log } from "./logger" with { typesugar: "extension" }`):
  `tsc` keeps the attribute in emit, and Node rejects unknown attribute keys at run time,
  so the program would not load without the transformer.
- **A `useExtensions(obj)` call macro**: another runtime-looking construct that must be
  erased, separated from the import it qualifies, and order-sensitive within the file.
- **Naming conventions** (`*Ext`, `*Ops`): names say nothing about what a value is
  (CLAUDE.md "Deciding what a type is"), and `ZeroCostOptionOps` shows the name doesn't
  separate extension objects from ordinary helpers.
- **Wildcard-parameter heuristics** (skip members whose first parameter is `unknown`,
  `any`, or an unconstrained `T`): a heuristic, still matches `T extends object` and
  `Record<string, unknown>`, and still turns a mistake into a silent rewrite for any
  member whose parameter happens to fit.
- **Declaration-side opt-in** (`"use extension"`/`@extension` on the object): does not
  survive into `.d.ts` (above).

## Migration

typesugar is pre-release with no consumers, so this is a straight change, no deprecation.

Every import of an extension object in the repo gains the tag:

- `packages/macros/src/diagnostic-suppression-rules.test.ts` ("EffectExt"),
- `packages/transformer-core/tests/docs-review-engine-r3.test.ts` (the `from-effect.md`
  example),
- `packages/effect/examples/effect-adapter-example.ts` (used twice by
  `tests/package-examples.test.ts`),
- `tests/diagnostic-suppression-extension.test.ts` "suppresses TS2339 when a namespace with
  matching method is imported": an unmarked user namespace. It is split in two: untagged it
  is no longer suppressed (TS2339 is reported), tagged it is.
- Docs, READMEs and examples that import `EffectExt`/`OptionExt`/`EitherExt` or std's
  `*Ext` objects for method syntax (`docs/migration/from-effect.md`,
  `docs/vision/effect-integration.md`, `docs/errors/TS9062.md`, `packages/effect`,
  `packages/std`), found in the Wave 1 sweep.

## Waves

| Wave | Scope                                                                                                                                                                                                       | Branch                               | Status          |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | --------------- |
| 1    | The decision in `findImportedExtensionMatches`; check/build agreement and tag-not-dispatched tests (transformer, `expand`, language service, unplugin); test, docs and example migration; consistency sweep | `pep-064-extension-import-opt-in`    | In review (#97) |
| 2    | ExtensionImport unused-import suppression rule (bare functions and tagged objects); warning for a tag with no effect                                                                                        | `pep-064-wave-2-unused-and-inactive` | In review (#98) |

## Risks

- **Bare functions are still opted in by name alone.** `import { info }` where `info(msg:
unknown)` makes a typo `user.info()` become `info(user)`. This is the decided design (the
  name match is the opt-in, and std's extension functions rely on it); a function named
  after the method you call is much less likely to be an accident than any member of any
  imported object. Revisit if it bites in a case study.

- **A third-party extension object needs the tag.** Anyone used to importing `EffectExt`
  and calling methods gets TS2339 until they add `/** @extension */`. The TS9062 error page
  and the extension-methods guide say so.
- **Tools that move imports.** Prettier keeps a JSDoc comment above an import (this repo's
  `format:check` runs over the tagged imports). An import sorter or organize-imports
  action that drops or detaches the comment turns the extension off; the call then fails
  with TS2339, so the failure is loud, not a silent change of meaning.
- **The `dist/` `.d.ts` path still needs no marker**, since the tag is at the import; this
  is the point of the design.

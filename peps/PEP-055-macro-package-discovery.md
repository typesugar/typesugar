# PEP-055: Macro-Package Discovery via `package.json`

**Status:** In Progress (2026-07-11) — design accepted (all three open
questions below resolved with this PEP's own recommended defaults). Phase A
(manifest discovery + trust gate + `typesugar approve-macros` CLI, additive,
zero behavior change for existing packages) implemented in Wave 1. Phase B
(official packages declaring the field — 15 packages plus 4 facades, scope
corrected during implementation, see Wave 2 notes) implemented in Wave 2.
Phases C–E (deleting the old hardcoded lists, the `ResultAlgebra`
relocation, the docs sweep) not yet started.
**Date:** 2026-07-04
**Author:** Claude (with Dean Povey)
**Relates to:** [PEP-050](PEP-050-shipping-typesugar-libraries.md) (the `./macros` subpath split this builds on), [PEP-052](PEP-052-import-scoped-macro-activation.md) (Wave 9 names this as its prerequisite), [PEP-049](PEP-049-cruft-cleanup.md) (prior finding that a self-declared field can't be an allowlist)
**Prerequisite for:** PEP-052 Wave 9 (macro-package discovery is scoped there as "needs a PEP first" — this is that PEP)

## Summary

Replace `packages/transformer/src/macro-loader.ts`'s two hardcoded lists —
`KNOWN_MACRO_PACKAGES` (7 entries) and `FACADE_TO_PROVIDER` (4 entries) — with a
declared manifest field in each macro-hosting package's own `package.json`:

```json
{
  "typesugar": {
    "macros": "./macros"
  }
}
```

A package that ships this field is discoverable by the macro-loader the moment
it appears anywhere in the compiled program's import graph — no code change to
`@typesugar/transformer` required to add support for a new macro package, and
(for the first time) a genuinely third-party, non-`@typesugar`-scoped package
can register macros through the same mechanism `@typesugar/std`/`fp`/`effect`
already use.

This is scoped **narrowly** to the discovery/loading mechanism itself. It does
not touch macro _registration_ (`globalRegistry.register(...)`, still exactly
as-is), `MacroDefinition` shapes, or either transformer pipeline's dispatch
logic (PEP-052 Waves 2/3/6/7/8 already unified those; this PEP doesn't touch
them again).

## Motivation

### The current mechanism is a closed list

`packages/transformer/src/macro-loader.ts:32-48`:

```typescript
const FACADE_TO_PROVIDER: Record<string, string> = {
  "@typesugar/derive": "@typesugar/macros",
  "@typesugar/reflect": "@typesugar/macros",
  "@typesugar/typeclass": "@typesugar/macros",
  typesugar: "@typesugar/macros",
};

const KNOWN_MACRO_PACKAGES = new Set([
  "@typesugar/macros",
  "@typesugar/mapper",
  "@typesugar/contracts",
  ...Object.keys(FACADE_TO_PROVIDER),
]);
```

Every import specifier the loader sees is checked against these two structures
first; only if neither matches does it fall through to a narrower rule:
`mod.startsWith("@typesugar/")` (line ~79). **That prefix check is a hard
gate.** A package of any other name or scope — `my-org/typeclass-extras`,
`unscoped-macro-pack`, anything — is never spec­ulatively `require()`'d by the
macro-loader today, full stop. There is no config option, no opt-in list, no
manifest lookup that lets a genuinely third-party package participate. The
only way its macros could ever register is if something _else_ in the
compiled program happens to `require()`/import it first for an unrelated
reason — not a discovery mechanism, an accident.

Two concrete costs of this today:

1. **No third-party macro packages are possible**, despite the macro
   registration API (`defineAttributeMacro`, `defineDeriveMacro`, etc.) being
   fully public and documented. Anyone who _can_ write a macro package has no
   way to make the compiler find it without either (a) publishing under the
   `@typesugar/` npm scope (not theirs to use) or (b) asking for a PR to this
   monorepo adding their package name to `KNOWN_MACRO_PACKAGES`.
2. **`@typesugar/fp` can't host its own macro-time registrations** because it
   has no `./macros` entry point _and_ wouldn't be discovered even if it grew
   one, since `fp` isn't in either hardcoded list. This is why
   `packages/macros/src/specialize.ts:324-333` still carries
   `optionResultAlgebra`/`eitherResultAlgebra`/`promiseResultAlgebra` as
   built-in seeds inside `@typesugar/macros` — with a comment explaining
   exactly why they can't move:

   ```typescript
   // DELIBERATE builtin seeding (PEP-052 Wave 4 reviewed and retained): these
   // algebras are AST-building rewrite functions — not declarable as JSDoc
   // metadata — and fp has no macro entry to host its own registration, so
   // relocating the seeds would mean inventing loader plumbing for three lines.
   ```

   This PEP is that loader plumbing. Once `fp` can declare a `./macros` entry
   _and_ be discovered without a `KNOWN_MACRO_PACKAGES` edit,
   `optionResultAlgebra`/`eitherResultAlgebra` move into `fp`'s own macro
   entry and `promiseResultAlgebra` moves into `std`'s — `specialize.ts` keeps
   only the `ResultAlgebra` type, the registry, and
   `registerResultAlgebra`/`getResultAlgebra` as a pure, unseeded extension
   point.

### Why this needs its own PEP, not just a PR

Per PEP-052's own Wave 9 framing: this changes **what code the compiler
executes at build time**, based on data (`package.json`) supplied by a
dependency the consuming project doesn't control the content of. That is a
security-relevant change, not a refactor, and it deserves an explicit design
review — specifically because removing today's `@typesugar/`-prefix gate
genuinely **widens the trust boundary** (see "Security posture" below), which
a "just add a manifest field" description undersells.

## Design

### The manifest field

```json
{
  "name": "my-org-macros",
  "typesugar": {
    "macros": "./macros"
  }
}
```

- `typesugar.macros` is a **relative path**, resolved the same way Node/bundler
  `exports` subpaths already are: relative to the declaring package's own
  root, through that package's own `exports` map if it has one (so
  `"./macros"` here means "the specifier `${packageName}/macros`, resolved via
  this package's own `package.json#exports`" — exactly today's PEP-050 Case-1
  convention, just declared instead of assumed).
- **No new resolution algorithm.** The loader already knows how to
  `require(target)` for an arbitrary specifier (`tryLoadModule`,
  `macro-loader.ts:176-210`) — this field only changes _which_ specifiers it's
  willing to try, not _how_ it resolves them. Node's own module resolution
  (via `createRequire`, already in use) handles workspace-linked packages and
  registry-installed packages identically, since a package manager's
  workspace linking is transparent at the `node_modules` layer — there is no
  separate "workspace resolution" the loader needs to implement. (This
  directly answers the "workspace-vs-registry resolution" question the PEP-052
  Wave 9 entry flags: there isn't a distinction to design for. Node module
  resolution already erases it.)
- **Facades are a cross-package reference, not a special case.** A facade
  package (today: `@typesugar/derive`, `@typesugar/reflect`,
  `@typesugar/typeclass`, `typesugar`) declares:

  ```json
  { "typesugar": { "macros": "@typesugar/macros/macros" } }
  ```

  i.e. the value is allowed to be a **bare specifier pointing at a different
  package's macro entry**, not only a same-package relative path. The loader
  doesn't need to know "facade" is a concept at all — it just resolves
  whatever specifier the field names and `require()`s it. This replaces
  `FACADE_TO_PROVIDER` with zero special-cased loader logic: a facade is
  simply a package whose own macro entry happens to be someone else's.

- **No field present → not a macro package**, exactly like today (a package
  the loader has never heard of already silently contributes nothing). The
  one behavior change: previously, an unrecognized `@typesugar/*` package was
  spec­ulatively tried anyway (the prefix fallback); after this PEP, EVERY
  package — `@typesugar/*` or not — must declare the field to be tried. See
  "Migration" for how this is introduced without breaking existing
  `@typesugar/*` packages that haven't added it yet.

### Discovery algorithm (replacing `KNOWN_MACRO_PACKAGES`/`FACADE_TO_PROVIDER`)

For each base package name found in the compiled program's import graph
(`collectImportedModules`, unchanged):

1. Resolve that package's `package.json` (already on disk if it's
   `require()`-able at all — no new I/O beyond what `tryLoadModule` already
   does to load the module itself).
2. Read `typesugar.macros`. If absent → skip (not a macro package).
3. If present, resolve it via the security check below (default-safe: only
   auto-honored for `@typesugar/*`-scoped packages; anything else needs
   consumer opt-in — see next section), then `require()` it exactly as
   `tryLoadModule` already does.
4. Cache the parsed manifest alongside the existing `loadedPackages` memo, so
   this is a one-time-per-package cost, not a per-import cost.

No behavior changes to `MacroDefinition`, `globalRegistry`, or either
pipeline's macro dispatch — this is purely "which modules get `require()`'d,"
the same responsibility `macro-loader.ts` already has.

### Security posture

This is the section that makes this a PEP and not a PR. Quoting the existing,
already-litigated finding this design must not contradict
(`docs/SECURITY.md`, `docs/SECURITY-REVIEW.md` F1, and independently
`peps/PEP-049-cruft-cleanup.md:91`):

> A macro's self-declared `module` field can be set to anything by a hostile
> package — an allowlist built on self-declared data is "security theater."

The `typesugar.macros` field is exactly as self-declared. But it is not being
used the same way `module` is (as an identity _claim_ checked against an
allowlist) — it's being used as a **routing instruction**: "does the compiler
attempt to `require()` this dependency at all." That distinction matters, but
it doesn't make the field trustworthy — it makes the failure mode different
and, if designed carelessly, **worse**: today, a package outside the
`@typesugar/*` scope is _never_ `require()`'d by the loader, at all, under any
circumstances. A design that honors `typesugar.macros` unconditionally for
_any_ package name would mean: **any transitive dependency, of any package, at
any scope, that ships this one field gets its code executed at compile time**
— merely by existing somewhere in `node_modules` and being imported anywhere
in the program, with zero action from the consuming project. Adding a package
to your own `package.json` implies some trust, but the actual risk here is
**transitive**: you didn't choose, and likely don't know about, everything in
your dependency tree. That's a real risk for ordinary runtime dependencies too
— but there, the malicious code only runs if something you wrote actually
calls into it. Here, the code runs automatically the moment the package is
merely present in the import graph, at compile time, on your (or CI's)
machine, with whatever ambient access that environment has. That is a
materially larger blast radius, and it's exactly the class of incident
(`event-stream`, and more recently several build-plugin compromises) that has
pushed the ecosystem toward requiring **explicit, one-time consent** for
build-time code execution rather than either extreme (silent allow, or a
hand-maintained allowlist nobody keeps up to date).

**Recommendation: auto-trust `@typesugar/*`; require one-time, CLI-driven
approval for everything else — modeled on pnpm's `approve-builds`.**

- **`@typesugar/*`-scoped packages are auto-trusted, unconditionally, with no
  config and no approval step.** This is a deliberate choice, not an
  oversight: by the time a project is using `typesugar` at all, it has
  already extended unconditional code-execution trust to this publishing org
  via the compiler itself (`@typesugar/transformer`) and via
  `@typesugar/macros`, which loads unconditionally today and continues to
  regardless of this PEP. Gating one more `@typesugar/*` package (e.g.
  `@typesugar/std`) behind an approval step adds no real protection against
  the actual threat (a compromised publish to the org) — that same
  compromise could just as easily backdoor the compiler package, which has
  no gate and structurally can't have one. The approval step earns its keep
  exactly at the boundary this PEP draws: packages the project has not
  already, unavoidably, chosen to trust by picking this tool. (Tradeoff worth
  naming: a compromised `@typesugar` publish token could ship a malicious
  macro with zero friction under this design. That exposure already exists
  today via the compiler itself — this PEP does not add to it.)
- **Everything else requires one-time, explicit approval, enforced by the
  CLI, not by a hand-typed list.** The first time the loader discovers a
  non-`@typesugar/*` package declaring `typesugar.macros` that hasn't been
  approved, **the build fails** with a diagnostic naming the package(s) and
  pointing at:

  ```
  $ typesugar approve-macros
  ```

  which lists exactly what's new, prompts for confirmation (a
  `--yes`/non-interactive flag exists for scripted use, but the default
  requires a human), and writes the approval into `typesugar.config.ts`'s
  existing `security.allowedMacroPackages` field — the mechanism
  `docs/SECURITY-REVIEW.md` already sketched and deliberately deferred
  (tracked as GitHub issue #14; that sketch already supports scope-wildcard
  entries like `"@my-org/*"`, so an organization that wants to trust its own
  internal scope wholesale can write that once by hand — `approve-macros`
  just writes exact names, it doesn't need to invent wildcard support
  itself):

  ```typescript
  // typesugar.config.ts
  export default {
    security: {
      // Written by `typesugar approve-macros` — safe to hand-edit, but
      // review each entry as carefully as a new production dependency.
      allowedMacroPackages: ["my-org-macros", "@another-scope/typesugar-plugin"],
    },
  };
  ```

  This file is meant to be **committed to version control**, mirroring
  pnpm's `pnpm-workspace.yaml` `onlyBuiltDependencies` /
  `ignoredBuiltDependencies` model for lifecycle-script approval: once
  approved locally by one contributor, every other clone (and CI) reads the
  same committed decision — no repeated friction on every build, and a PR
  that introduces a new macro-package dependency shows the trust decision
  explicitly in its diff, for reviewers to scrutinize alongside the
  dependency change itself.

- **Friction is paid once per package, not once per build** — directly
  answering the "keep it low-friction" goal: after approval, subsequent
  builds (local or CI) proceed silently as long as no _new_, unapproved
  package appears. If a dependency update introduces a macro package that
  wasn't there before (a new transitive dependency, or an existing dependency
  gaining a macro entry it didn't have), the build fails again — a human must
  explicitly approve the new addition. An update to an _already-approved_
  package's _version_ does not require re-approval in this design (matching
  pnpm's precedent, and its accepted tradeoff): this catches new untrusted
  packages entering the graph, not a compromised update to a package already
  trusted. Pinning approval to a content hash of the macro entry (to also
  catch the "already-trusted package ships a malicious update" case) is a
  strictly stronger variant worth considering, called out as an open question
  below rather than specified here.
- This does **not** solve the underlying "how do we know a package's claimed
  identity is real" problem (issue #14's deeper ask — deriving trust from the
  module-resolution graph rather than a self-declared field) — that remains
  future work. What this design buys is _consent_: a third-party macro
  package can only run at build time if a human explicitly approved it, not
  merely because some transitive dependency happened to ship the field. That
  is the same bar `postinstall` scripts, Babel plugins, and bundler plugins
  already clear via explicit dependency+approval steps — this brings macro
  packages to parity with that norm, not below it.

### What does NOT change

- Macro registration itself (`globalRegistry.register`, `MacroDefinition`,
  `defineAttributeMacro`/`defineDeriveMacro`/etc.) — completely untouched.
- Either transformer pipeline's dispatch logic — PEP-052 Waves 2/3/6/7/8
  already unified JSDoc/decorator/label/operator dispatch between
  `@typesugar/transformer` and `@typesugar/transformer-core`; this PEP adds
  no new dispatch surface.
- `@typesugar/transformer-core`/`@typesugar/playground` are **out of scope**
  for the `require()`-based discovery mechanism entirely. `transformer-core`
  has zero Node dependencies by design (runs in browsers) and never does
  dynamic `require()` — its consumers (the playground) already statically
  import the macro packages they need (`import "@typesugar/std/macros"` in
  `packages/playground/src/index.ts`). This PEP only affects the Node-based
  loader (`@typesugar/transformer`'s `macro-loader.ts`), which is _already_
  the single shared implementation for every Node consumer (CLI, ts-patch,
  and `unplugin-typesugar` for esbuild/vite/rollup/webpack — confirmed
  `unplugin-typesugar` delegates entirely to `@typesugar/transformer`'s
  pipeline, no separate copy to reconcile).
- The implicit "`@typesugar/std` always loads first when any `@typesugar/*`
  import is seen" rule (`macro-loader.ts` lines ~89, ~144) is **preserved
  as-is** in this PEP, not redesigned. It's a real ordering dependency
  (Eq/Ord/Numeric instances), but making ordering fully declarative
  (e.g. a `"provides"`/`"requires"` field) is a separate, larger concern this
  PEP doesn't take on — noted as a candidate follow-up, not solved here.

## Migration plan (the actual PEP-052 Wave 9 execution, once this PEP lands)

1. **Phase A** — add `typesugar.macros` manifest reading, the auto-trust/
   approval-gated discovery algorithm above, and the `typesugar approve-macros`
   CLI command + `security.allowedMacroPackages` config read/write to
   `macro-loader.ts`, running **behind** the existing
   `KNOWN_MACRO_PACKAGES`/`FACADE_TO_PROVIDER` lists (i.e. additive: a package
   matches if it's in the old lists OR declares the new field). Zero behavior
   change for any existing package at this point — purely new, inert
   capability.
2. **Phase B** — every `@typesugar/*` package with an existing, real
   `./macros` export subpath adds the `typesugar.macros` field to its
   `package.json` (pointing at that existing subpath — no source changes
   needed). **Corrected during implementation** (see Wave 2 notes below):
   this is fifteen packages, not the four originally named here
   (`std`/`effect`/`contracts`/`mapper` plus `codec`/`erased`/`fusion`/
   `graph`/`strings`/`testing`/`type-system`/`sql`/`parser`/`units`/
   `validate`) — anything currently reachable only via the
   `@typesugar/*`-prefix fallback Phase C deletes. `@typesugar/macros`
   itself (macros live at its package root, not a `./macros` subpath)
   declares `typesugar.macros: "."`. The four facade packages
   (`@typesugar/derive`/`reflect`/`typeclass`, `typesugar`) add the
   cross-package-reference form pointing at `@typesugar/macros` (its real
   root target, not the `@typesugar/macros/macros` subpath this section
   originally assumed existed).
3. **Phase C** — delete `KNOWN_MACRO_PACKAGES`/`FACADE_TO_PROVIDER` and the
   `@typesugar/`-prefix fallback entirely; the manifest field is now the only
   discovery path. Gate: full workspace build + full test suite green with
   the old lists removed (every existing macro package must have picked up
   the field in Phase B for this to work).
4. **Phase D — the ResultAlgebra relocation.** `@typesugar/fp` grows a
   `./macros` entry (a small new file, e.g. `packages/fp/src/macros.ts`)
   declaring `typesugar.macros`; `optionResultAlgebra`/`eitherResultAlgebra`
   and their `registerResultAlgebra(...)` calls move there verbatim.
   `promiseResultAlgebra` moves into `@typesugar/std`'s existing macro entry.
   `specialize.ts`'s seed comment and the three `registerResultAlgebra(...)`
   calls at its bottom are deleted — the registry and its extension-point
   functions remain, now genuinely unseeded.
5. **Phase E** — docs sweep (`docs/SECURITY.md` gets a new subsection on the
   opt-in third-party macro package mechanism; a guide page for third-party
   macro package authors, since this PEP is what makes that a real,
   documented capability for the first time) + this PEP's status flipped to
   Implemented.

Each phase gates on the full sequential workspace build + full test suite,
matching the discipline established across PEP-052's waves.

## Acceptance criteria

- `KNOWN_MACRO_PACKAGES`/`FACADE_TO_PROVIDER` deleted from `macro-loader.ts`.
- `@typesugar/*`-scoped packages declaring `typesugar.macros` are discovered
  and registered automatically, with no config entry required — demonstrated
  by the existing official packages (Phase B) continuing to work with zero
  `security.allowedMacroPackages` entries for themselves.
- A package with no `@typesugar/` npm scope, declaring `typesugar.macros`,
  causes the build to **fail** with an actionable diagnostic the first time
  it's encountered — demonstrated with a real (test-fixture)
  third-party-shaped package, not just an `@typesugar/*` one.
- Running `typesugar approve-macros` against that failing build lists the
  package, writes it to `typesugar.config.ts`'s `security.allowedMacroPackages`,
  and the same build then succeeds with the package's macros registered.
- A subsequent build with an _unrelated_ new, unapproved macro package
  introduced (simulating a dependency update) fails again, confirming
  approval is scoped per-package, not a one-time global bypass.
- `@typesugar/fp` has its own `./macros` entry; `optionResultAlgebra`/
  `eitherResultAlgebra` live there, `promiseResultAlgebra` lives in
  `@typesugar/std`'s; `specialize.ts` has zero built-in `ResultAlgebra` seeds.
- Full workspace build + full test suite green with the deletion in place.

## Open questions (for Dean's review)

**Resolved 2026-07-10 — all three settled on this PEP's own recommended
default, no design changes:**

1. **Should approval be pinned to a content hash of the macro entry, not just
   the package name?** As designed, re-publishing an already-approved
   package with a malicious `./macros` update would NOT trigger a new
   approval prompt (matching pnpm `approve-builds`'s accepted tradeoff — it
   also approves by name, not by content). A hash-pinned variant would catch
   "trusted package, compromised update" at the cost of a fresh prompt on
   every macro-affecting release of an approved package, even benign ones.
   **Resolved: name only**, matching pnpm's precedent.
2. **Should `typesugar approve-macros` require a specific reviewer/CI
   signal** (e.g. refuse to run in a detected-CI environment, forcing
   approval to always happen locally and be committed, never generated
   on-the-fly in a pipeline) — or is a `--yes` flag for scripted/CI use
   acceptable as designed? **Resolved: `--yes` is allowed in CI**, as
   designed.
3. **Naming**: is `typesugar.macros` the right manifest key, or should it
   nest under something more explicit like `typesugar.exports.macros` to
   leave room for future `typesugar.*` manifest fields (e.g. a future
   `"provides"`/`"requires"` ordering hint, noted as out-of-scope above but
   plausible future work under the same namespace)? **Resolved: flat
   `typesugar.macros`**, as designed.

## Wave 1 (Phase A) implementation notes (2026-07-10)

Implemented as designed, additive to the existing
`KNOWN_MACRO_PACKAGES`/`FACADE_TO_PROVIDER` lists — see
`packages/transformer/src/macro-loader.ts` (`classifyManifestPackages`,
`UnapprovedMacroPackagesError`), `packages/transformer/src/config-writer.ts`,
`packages/transformer/src/approve-macros.ts`, and the `security` field added
to `TypesugarConfig` in `packages/core/src/config.ts`.

Two real, pre-existing bugs found and fixed along the way, unrelated to
this PEP's own design but directly blocking it — both in
`packages/core/src/config.ts`'s file-based config loading, which turned
out to have never actually worked for any real project, ever:

1. `loadConfigFromFiles` passed `.typesugarrc.mjs`/`typesugar.config.mjs`
   in `cosmiconfigSync`'s `searchPlaces`. `cosmiconfigSync`'s explorer
   validates every searchPlaces entry has a sync-compatible loader **at
   construction time** — `.mjs` (ESM) has none, since loading it requires
   an async `import()` — so the explorer threw immediately, on every
   single call, for every project, `.mjs` config or not. Fixed by dropping
   the two `.mjs` entries.
2. Deeper, and the actual reason bug #1's fix alone still didn't work
   against the real CLI binary: `loadConfigFromFiles` used a bare
   `require("cosmiconfig")` guarded by a "does an ambient `require` exist"
   check. `@typesugar/core` builds to both CJS and ESM; the ESM build
   (`dist/index.js` — what any `"type": "module"` consumer, including this
   repo's own CLI, actually loads) has no ambient `require` at all, so
   that bare call always threw `Dynamic require of "cosmiconfig" is not
supported`. The obvious fix — `createRequire(import.meta.url)`, the
   same pattern `macro-loader.ts` already uses — doesn't work here: unlike
   `macro-loader.ts` (Node-only), `@typesugar/core` also ships as a
   **browser** bundle (`packages/playground` bundles this package's ESM
   output directly, `platform: 'browser'`), and a static
   `import { createRequire } from "module"` makes esbuild hard-fail the
   browser build resolving `"module"` at bundle time, regardless of
   whether that code path ever runs. Fixed with
   `process.getBuiltinModule("module")` (Node 22.3+) instead: a plain
   runtime property access on `process`, invisible to bundler static
   analysis (nothing to resolve at build time), that still yields a
   correctly-scoped `createRequire` in real Node ESM. Guarded the same way
   this package's other Node/browser isomorphic code already is
   (`profiling.ts`'s `typeof process !== "undefined"` check); returns
   `undefined` for a browser or an older Node, falling back to this
   function's pre-existing "cosmiconfig not available" empty-config
   behavior — a graceful degradation, not a regression. Still needed
   `packages/core/tsup.config.ts` to gain `shims: true` (already set on
   `packages/transformer`'s tsup config, not on core's): without it,
   tsup's CJS output replaces `import.meta.url` with an empty object
   literal instead of a working polyfill, breaking `createRequire` for CJS
   consumers.

Both bugs were silently swallowed by the same outer `catch {}` in
`loadConfigFromFiles`, and both had zero prior test coverage (confirmed
during Wave 1 research: no existing test exercised the cosmiconfig
file-loading branch at all) — `vitest`'s own module loader happens to
give `require` a truthy value regardless, which is why nothing in the test
suite had ever caught bug #2, and why it only surfaced when this wave's
`approve-macros` smoke test ran the REAL built CLI binary rather than
vitest-imported source. Regression-tested in `tests/config.test.ts`'s new
"config file loading (cosmiconfig)" block, which exercises the real
file-read path (not just `config.set()`, which is all the suite tested
before).

Phase A's acceptance criteria bullets satisfied by this wave, verified both
via the automated test suite AND a manual smoke test against the real
built CLI binary (`node packages/transformer/dist/cli.js`, a throwaway
fixture package, and a real `typesugar.config.ts` round trip): the
manifest field is discovered and auto-trusted for `@typesugar/*` packages
with no config entry required; a non-`@typesugar/*`-scoped package
declaring the field fails `typesugar build` with an actionable diagnostic
(not a raw stack trace) pointing at `approve-macros`; running `typesugar
approve-macros --yes` writes the approval and a subsequent build/scan
succeeds; a second, unrelated unapproved package still fails (approval is
scoped per-package, not a global bypass). The remaining acceptance
criteria (deleting the old lists, the `fp`/`std` `ResultAlgebra`
relocation) are Phase C/D, not this wave.

## Wave 2 (Phase B) implementation notes (2026-07-11)

**Scope correction, found while implementing, not anticipated by the
original Phase B text above:** the PEP's Phase B step 2 named exactly four
packages (`std`/`effect`/`contracts`/`mapper`) as needing the field. A full
audit of `packages/*/package.json` for existing `./macros` export subpaths
found **fifteen**, not four — `codec`, `erased`, `fusion`, `graph`,
`strings`, `testing`, `type-system`, `sql`, `parser`, and `units`/`validate`
all already have a real, macro-registration-backed `./macros` subpath
(confirmed by grepping each for `globalRegistry.register`/
`defineAttributeMacro`/`MacroDefinition` markers) and were being discovered
today purely through the `@typesugar/*`-prefix speculative-load fallback
that Phase C is scoped to delete. Had Phase B landed only the four named
packages, Phase C's fallback deletion would have silently broken macro
registration for the other eleven — a real regression, not a hypothetical
one. All fifteen now declare `typesugar.macros: "./macros"`.

`@typesugar/macros` itself (the actual provider all four facades delegate
to) also needed the field — its macros live at its package **root**, not a
`./macros` subpath (`KNOWN_MACRO_PACKAGES` listed it directly, not via
`FACADE_TO_PROVIDER`). The design's `resolveManifestTarget` only handled
`"./macros"`-style relative subpaths and bare cross-package specifiers;
added a `"."` case (matching Node/npm's own `exports` map convention for
"package root") resolving to the package's own name, so
`@typesugar/macros` declares `typesugar.macros: "."`. The four facades
(`@typesugar/derive`/`reflect`/`typeclass`, `typesugar`) declare
`typesugar.macros: "@typesugar/macros"` — the PEP's own design text
illustrated this as `"@typesugar/macros/macros"`, assuming a `./macros`
subpath on the provider that doesn't actually exist; using the real root
target instead of inventing an unneeded new subpath.

**Second real gap found**: the bare `typesugar` facade package (published
unscoped on npm, not `@typesugar/typesugar`) isn't covered by the
`@typesugar/*`-prefix auto-trust check — under the old
`FACADE_TO_PROVIDER` list it was explicitly, unconditionally trusted, but
the new manifest-based `isTrusted` would have treated it as an
unapproved third-party package requiring explicit `approve-macros`
consent, purely because of its unscoped name. Fixed by adding a small,
explicit `AUTO_TRUSTED_UNSCOPED_PACKAGES` set (today just `"typesugar"`)
alongside the `@typesugar/*` prefix check in `isTrusted` — first-party
trust shouldn't hinge on npm scoping convention alone.

Both gaps were caught by a new "manifest discovery against the real
workspace packages" test block in `macro-loader.test.ts` that exercises
the actual, real (non-mocked) workspace-linked `node_modules` rather than
synthetic fixtures — worth remembering as a pattern: fixture-only tests
would not have caught either bug, since both are specific to the _real_
package.json shapes already in this repo, which no fixture happened to
reproduce.

Full workspace `pnpm build` + full `vitest run` (7294 passed, up 4 from
Wave 1's baseline, 38 pre-existing skips, 0 failures) + `npx prettier
--check .` all green after this wave. This wave is purely additive (same
guarantee as Phase A) — the old lists are untouched, so existing behavior
is unchanged; only new packages are now _also_ reachable via the manifest
path. Phase C (deleting the old lists) is the next wave, now unblocked for
all fifteen-plus-facades packages, not just the original four.

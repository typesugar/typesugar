# PEP-055: Macro-Package Discovery via `package.json`

**Status:** Draft (2026-07-04) — proposal only, no code changes
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
in the program, with zero action from the consuming project. That is a
materially larger supply-chain surface than today's implicit
`@typesugar/`-npm-scope speed bump (weak, but real — scope squatting is
possible but requires deliberately claiming the `@typesugar` org, which npm
scope ownership already gates).

**Recommendation: keep today's trust boundary as the default; only widen it
on explicit, consumer-side opt-in.**

- `@typesugar/*`-scoped packages: `typesugar.macros` is honored automatically,
  exactly like today's `KNOWN_MACRO_PACKAGES`/prefix-fallback behavior. No
  config change required for existing or new official packages — this PEP is
  invisible to that case except that it's now declarative instead of a
  hardcoded list a maintainer edits by hand.
- **Any other scope/name**: the field is only honored if the consuming
  project explicitly lists the package in `typesugar.config.ts`, e.g.:

  ```typescript
  export default {
    macroPackages: ["my-org-macros", "@another-scope/typesugar-plugin"],
  };
  ```

  This is precisely the `allowedMacroPackages` mechanism
  `docs/SECURITY-REVIEW.md` already sketched and deliberately deferred
  (tracked as GitHub issue #14) — this PEP is the concrete trigger for
  building it, rather than another round of deferral, because without it
  Wave 9's stated goal ("first-class third-party macro packages") is
  unreachable safely.

- This does **not** solve the underlying "how do we know a package's claimed
  identity is real" problem (issue #14's deeper ask — deriving trust from the
  module-resolution graph rather than a self-declared field) — that remains
  future work. What this PEP's opt-in gate buys is _consent_: a third-party
  macro package can only run at build time if the person building the
  project named it, not merely because some transitive dependency happened to
  ship the field. That is the same bar `postinstall` scripts, Babel plugins,
  and bundler plugins already clear via explicit `package.json`
  dependency+config declarations — this brings macro packages to parity with
  that norm, not below it.

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

1. **Phase A** — add `typesugar.macros` manifest reading + the security-gated
   discovery algorithm above to `macro-loader.ts`, running **behind** the
   existing `KNOWN_MACRO_PACKAGES`/`FACADE_TO_PROVIDER` lists (i.e. additive:
   a package matches if it's in the old lists OR declares the new field).
   Zero behavior change for any existing package at this point — purely new,
   inert capability.
2. **Phase B** — `@typesugar/std`, `@typesugar/effect`, `@typesugar/contracts`,
   `@typesugar/mapper` each add the `typesugar.macros` field to their
   `package.json` (pointing at their existing `./macros` subpath — no source
   changes needed, they already have one). The four facade packages
   (`@typesugar/derive`/`reflect`/`typeclass`, `typesugar`) add the
   cross-package-reference form pointing at `@typesugar/macros/macros`.
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
- A package with no `@typesugar/` npm scope, declaring `typesugar.macros` and
  listed in a consuming project's `typesugar.config.ts` `macroPackages`
  allowlist, has its macros discovered and registered — demonstrated with a
  real (test-fixture) third-party-shaped package, not just an `@typesugar/*`
  one.
- A package with no `@typesugar/` npm scope, declaring `typesugar.macros`
  but **not** listed in `macroPackages`, is confirmed NOT loaded (the
  opt-in gate is real, not decorative) — a negative test, not just the
  absence of one.
- `@typesugar/fp` has its own `./macros` entry; `optionResultAlgebra`/
  `eitherResultAlgebra` live there, `promiseResultAlgebra` lives in
  `@typesugar/std`'s; `specialize.ts` has zero built-in `ResultAlgebra` seeds.
- Full workspace build + full test suite green with the deletion in place.

## Open questions (for Dean's review)

1. **Is the recommended default-safe posture (auto-trust `@typesugar/*`,
   explicit opt-in for everything else) the right call, or should even
   `@typesugar/*` packages require listing?** The recommendation above treats
   npm-scope ownership as a meaningful (if weak) trust signal worth
   preserving as the zero-config default, matching today's behavior exactly.
   An alternative, stricter design would require every macro package —
   including official ones — to be listed in `macroPackages`, trading a
   config line for a stronger "nothing runs without explicit consent"
   guarantee.
2. **Should `typesugar.config.ts`'s `macroPackages` allowlist support
   wildcards/scope-level entries** (e.g. `"@my-org/*"`) for organizations
   that want to trust their own internal scope wholesale, or should every
   package be named individually?
3. **Naming**: is `typesugar.macros` the right manifest key, or should it
   nest under something more explicit like `typesugar.exports.macros` to
   leave room for future `typesugar.*` manifest fields (e.g. a future
   `"provides"`/`"requires"` ordering hint, noted as out-of-scope above but
   plausible future work under the same namespace)?

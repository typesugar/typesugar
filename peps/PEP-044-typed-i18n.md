# PEP-044: Type-Checked i18n with Compile-Time Message Extraction

**Status:** Draft
**Date:** 2026-06-10
**Author:** Dean Povey

## Context

i18n in TypeScript is held together with string keys and faith. The standard
stacks (i18next, FormatJS/react-intl) share the same failure modes:

- Message keys are strings; a typo is a runtime fallback to the key name.
- Interpolation variables aren't checked: `t("greeting", { nmae })` ships.
- ICU plural/select messages are parsed and interpreted _at runtime_, costing
  bundle size (the ICU parser) and startup time.
- Extraction is a separate Babel/regex tool that drifts from the source.

Each of these is a compile-time problem. typesugar can solve all four with one
tagged-template macro, because extraction, validation, and ICU compilation can
all happen during the build with full type information.

## Proposal

New package: `@typesugar/i18n`.

### Authoring

```typescript
import { t } from "@typesugar/i18n";

t`Hello ${name}!`;
t`You have ${count}:plural(one {# message} other {# messages})`;
t("checkout.title")`Review your order`; // explicit key form
```

At compile time the macro:

1. **Derives a stable key** from the message (content hash) unless given
   explicitly.
2. **Extracts** `{ key, defaultMessage, placeholders: { name: string, count: number } }`
   into a build artifact (`i18n/messages.en.json`) — extraction is a _side effect
   of compilation_, so it can never drift from source.
3. **Type-checks interpolations**: placeholder names and types come from the
   actual expressions; `:plural` requires `number`, `:date` requires
   `Date | number`, etc. Mismatches are diagnostics at the exact span.
4. **Compiles the call site** to a direct lookup-and-format against _precompiled_
   message functions — no ICU parser in the bundle:

```typescript
// generated per-locale module, built from i18n/messages.de.json:
export const m = {
  k3f9a: (a: { name: string }) => `Hallo ${a.name}!`,
  k81c2: (a: { count: number }) =>
    a.count === 1 ? `${a.count} Nachricht` : `${a.count} Nachrichten`,
};
```

Locale catalogs are ordinary translated JSON files; `typesugar i18n compile`
turns each into a module of plain functions. Plural rules use `Intl.PluralRules`
(platform-provided) selected once per locale, not per call.

### Catalog validation

`typesugar i18n check` (and a transform-time diagnostic mode) verifies for every
locale: no missing keys, no orphan keys, placeholder sets match the source, ICU
syntax is valid. A German translation that drops `{name}` is a build error, not
a production bug.

### Build artifact mechanism

This PEP introduces a small but reusable transformer capability: **artifact
emission** — macros append to named build outputs, flushed once per build
(unplugin `emitFile` / CLI write). PEP-046's diagram emission wants the same
hook; design it once in `@typesugar/core`:

```typescript
ctx.emitArtifact("i18n/messages.en.json", mergeFn);
```

Watch-mode correctness (removing entries when a call site is deleted) is the
hard part: artifacts must be keyed by contributing file so stale entries can be
swept on rebuild.

## Implementation Plan

- **Wave 1 — artifact emission API** in core + unplugin/CLI flush, file-keyed
  for watch-mode sweeping.
- **Wave 2 — `t` macro**: key derivation, placeholder typing, extraction,
  call-site compilation against the dev locale (identity catalog).
- **Wave 3 — ICU subset** (plural, select, number/date via `Intl`), per-locale
  catalog compiler, `i18n check`.
- **Wave 4 — framework sugar**: React hook wrapper, lazy locale module loading
  pattern, docs comparing bundle size vs react-intl (the headline number).

## Open Questions

1. Key strategy default: content-hash keys are collision-safe and rename-proof
   but churn when copy changes; explicit keys are stable but manual.
   Recommendation: content-hash default + explicit override, with `i18n check`
   producing a rename map between catalog versions to preserve translations on
   copy edits.
2. Runtime locale switching: per-locale modules favour static apps; SPAs need
   `await loadLocale("de")` swapping the module reference. Both fit; document.
3. Rich text / embedded markup (`<b>…</b>` in messages): defer; FormatJS-style
   tag functions can be a later wave without changing the core design.

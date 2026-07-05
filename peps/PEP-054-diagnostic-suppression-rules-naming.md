# PEP-054: Rename "SFINAE Rules" to "Diagnostic Suppression Rules"

**Status:** Implemented
**Date:** 2026-07-04
**Author:** Claude (with Dean Povey)
**Relates to:** PEP-011 (`sfinae-rules.ts` shipped in Waves 3–5)

**Implementation status:** Waves 1–2 both complete. Wave 1 ([PR #52](https://github.com/typesugar/typesugar/pull/52))
also absorbed most of Wave 2's originally-planned scope (the CLI flag/env var
rename and all remaining consumers) so the full workspace stayed green after
a single merge, rather than leaving `packages/transformer`/`lsp-server`/
`playground` broken between two sequential PRs — see that PR's description
for the rationale. Wave 2 (this PR) covers the docs prose sweep, the
changeset, and this status update. Code review (8 parallel finder agents +
fixes) ran on both waves; see each PR's description for findings.

## Context

The mechanism named "SFINAE" in this codebase — `packages/core/src/sfinae.ts`,
`packages/core/src/sfinae-rules.ts`, `packages/macros/src/sfinae-rules.ts`,
`packages/macros/src/sfinae-registration.ts`, the `--show-sfinae` CLI flag,
the `TYPESUGAR_SHOW_SFINAE` env var, and their re-exports/tests/docs — does
not do what its name says.

**SFINAE** ("Substitution Failure Is Not An Error") is a C++ template
metaprogramming rule: when substituting template arguments produces an
ill-formed type, the compiler silently removes that candidate from overload
resolution rather than emitting an error. It is fundamentally an **overload
selection** mechanism.

What this codebase's `sfinae-rules.ts` actually implements is different: each
`SfinaeRule` watches a fixed list of TypeScript diagnostic codes (2339, 2322,
2345, 2355) and, when the checker reports one of those, asks "will the macro
system make this valid once the transformer runs?" — using the compiler
error as a **trigger to look up whether a macro will resolve it**, then
suppressing the diagnostic if so. For example, `Rule 1 (ExtensionMethodCall)`
suppresses TS2339 ("Property 'X' does not exist on type 'Y'") when an
extension method named `X` is resolvable for `Y` through the standalone
extension registry or import-scoped resolution — the property genuinely
doesn't exist yet at check time, but will after the transformer runs, so the
"error" is a false positive the tooling should hide.

This is **diagnostic suppression driven by a deferred-macro-expansion
check**, not overload resolution. The name was presumably chosen as a loose,
cute analogy ("we let something that looks like an error through, similar
in spirit to SFINAE"), but it borrows a term with specific, unrelated
baggage and actively misleads anyone who knows what SFINAE actually means in
C++ — including, per this PEP's own drafting, an LLM assistant maintaining
the code.

## Decision

Rename to **`DiagnosticSuppressionRule`** and its family. This matches how
the TypeScript tooling ecosystem already talks about this exact pattern
(language-service plugins that wrap `getSemanticDiagnostics` to filter out
diagnostics they know are false positives are commonly called "diagnostic
filters"), and it describes the mechanism directly: a rule that suppresses a
diagnostic.

Considered alternatives:

- `MacroDiagnosticFilter` — leads with _why_ (a macro will resolve it) rather
  than _what_ (a diagnostic gets suppressed). Rejected in favor of the more
  general name; the "because a macro will handle it" reasoning is exactly
  what each rule's `shouldSuppress` body documents, so it doesn't need to be
  in the type name too.
- `PreExpansionDiagnosticRule` — emphasizes _when_ (before the transformer
  runs). Rejected as more awkward without adding clarity over
  `DiagnosticSuppressionRule`.

## Scope — files, symbols, and user-facing surface to rename

### Files

| Current                                           | New                                                               |
| ------------------------------------------------- | ----------------------------------------------------------------- |
| `packages/core/src/sfinae.ts`                     | `packages/core/src/diagnostic-suppression.ts`                     |
| `packages/core/src/sfinae-rules.ts`               | `packages/core/src/diagnostic-suppression-rules.ts`               |
| `packages/core/tests/sfinae.test.ts`              | `packages/core/tests/diagnostic-suppression.test.ts`              |
| `packages/macros/src/sfinae-rules.ts`             | `packages/macros/src/diagnostic-suppression-rules.ts`             |
| `packages/macros/src/sfinae-rules.test.ts`        | `packages/macros/src/diagnostic-suppression-rules.test.ts`        |
| `packages/macros/src/sfinae-registration.ts`      | `packages/macros/src/diagnostic-suppression-registration.ts`      |
| `packages/macros/src/sfinae-registration.test.ts` | `packages/macros/src/diagnostic-suppression-registration.test.ts` |

### Exported symbols

| Current                     | New                                        |
| --------------------------- | ------------------------------------------ |
| `SfinaeRule`                | `DiagnosticSuppressionRule`                |
| `SfinaeAuditEntry`          | `DiagnosticSuppressionAuditEntry`          |
| `SfinaeEvalResult`          | `DiagnosticSuppressionEvalResult`          |
| `registerSfinaeRule`        | `registerDiagnosticSuppressionRule`        |
| `registerSfinaeRuleOnce`    | `registerDiagnosticSuppressionRuleOnce`    |
| `clearSfinaeRules`          | `clearDiagnosticSuppressionRules`          |
| `getSfinaeRules`            | `getDiagnosticSuppressionRules`            |
| `getSfinaeAuditLog`         | `getDiagnosticSuppressionAuditLog`         |
| `clearSfinaeAuditLog`       | `clearDiagnosticSuppressionAuditLog`       |
| `isSfinaeAuditEnabled`      | `isDiagnosticSuppressionAuditEnabled`      |
| `setSfinaeAuditMode`        | `setDiagnosticSuppressionAuditMode`        |
| `evaluateSfinae`            | `evaluateDiagnosticSuppression`            |
| `SfinaeRegistrationOptions` | `DiagnosticSuppressionRegistrationOptions` |
| `registerAllSfinaeRules`    | `registerAllDiagnosticSuppressionRules`    |
| `ALL_SFINAE_RULE_NAMES`     | `ALL_DIAGNOSTIC_SUPPRESSION_RULE_NAMES`    |

Individual rule constructors (`createMacroGeneratedRule`,
`createExtensionMethodCallRule`, the `TypeRewriteAssignment`/
`NewtypeAssignment` rule factories) already carry descriptive names with no
"sfinae" in them — no change needed there beyond moving with their file.

Not in scope: `packages/core/src/type-rewrite-registry.ts` and its tests —
a correctly-named, separate mechanism that some suppression rules consume;
its own API/symbols are untouched (Wave 2 did fix a few stale doc-comment
mentions of "SFINAE rule" describing the _other_, renamed mechanism that
consumes this registry — not a rename of anything in this file itself).

### User-facing CLI/env surface (breaking, pre-1.0 — no deprecated alias, matching PEP-053/Wave-3/4 precedent)

| Current                          | New                                     |
| -------------------------------- | --------------------------------------- |
| `--show-sfinae` (CLI flag)       | `--show-suppressed-diagnostics`         |
| `TYPESUGAR_SHOW_SFINAE` (env)    | `TYPESUGAR_SHOW_SUPPRESSED_DIAGNOSTICS` |
| `showSfinae` (CLI options field) | `showSuppressedDiagnostics`             |

### Every other reference to update

Re-exports: `packages/core/src/index.ts`, `packages/macros/src/index.ts`.
Consumers: `packages/macros/src/adt.ts`, `packages/macros/src/opaque.ts`,
`packages/macros/src/typeclass.ts`, `packages/transformer/src/cli.ts`,
`packages/transformer/src/language-service.ts`,
`packages/transformer/tests/language-service.test.ts`,
`packages/lsp-server/src/server.ts`, `packages/playground/src/worker-entry.ts`,
`packages/core/src/test-helpers.ts`. Docs prose (replace "SFINAE" with
"diagnostic suppression rule(s)", not just symbol names):
`docs/guides/extension-methods.md`, `docs/guides/fp.md`,
`docs/guides/jsdoc-vs-decorators.md`, `docs/reference/cli.md`.

(File list assembled via `grep -rln -i sfinae` across `packages/` and `docs/`
at draft time — re-verify at implementation time in case anything shifted.)

## Waves

### Wave 1 — Core + macros rename (mechanical, tests-first)

- [x] Rename the two `core` files and update `packages/core/src/index.ts`'s
      re-exports.
- [x] Rename the symbols listed above in `packages/core/src/diagnostic-suppression.ts`
      / `diagnostic-suppression-rules.ts`.
- [x] Rename the two `macros` files (`diagnostic-suppression-rules.ts`,
      `diagnostic-suppression-registration.ts`) and their symbols
      (`SfinaeRegistrationOptions`, `registerAllSfinaeRules`,
      `ALL_SFINAE_RULE_NAMES`); update `packages/macros/src/index.ts`.
- [x] Update every consumer import in `adt.ts`, `opaque.ts`, `typeclass.ts`,
      `test-helpers.ts`.
- [x] Rename the three test files to match and update their internal
      references/describe blocks.
- **Gate:** `pnpm --filter @typesugar/core --filter @typesugar/macros build`
  - `pnpm --filter @typesugar/core --filter @typesugar/macros typecheck` +
    the renamed test suites pass. `git grep -i sfinae -- 'packages/core/src' 'packages/macros/src'`
    returns nothing outside historical PEP docs.

### Wave 2 — CLI/env rename, remaining consumers, docs, full verification

- [x] Rename the CLI flag/env var/options field in
      `packages/transformer/src/cli.ts` and `language-service.ts`; update
      `--help` text.
- [x] Update `packages/lsp-server/src/server.ts`,
      `packages/playground/src/worker-entry.ts`, and
      `packages/transformer/tests/language-service.test.ts`.
- [x] Sweep docs (`docs/guides/extension-methods.md`, `docs/guides/fp.md`,
      `docs/guides/jsdoc-vs-decorators.md`, `docs/reference/cli.md`) —
      replace "SFINAE" prose with "diagnostic suppression rule(s)"; note the
      renamed flag/env var.
- [x] Full workspace build (`pnpm build`, sequential — see PEP-052 Wave 4/5's
      note on why a full build catches what per-package filters miss) +
      full test suite.
- [x] `git grep -i sfinae` across the whole repo, excluding `peps/` (historical
      PEP text) and the following intentional, documented exceptions, returns
      nothing else: `packages/core/src/diagnostic-suppression.ts`'s own `@see
PEP-054` backreference; the `@see PEP-011` citations in
      `packages/macros/src/adt.ts`/`opaque.ts` (PEP-011 keeps its historical
      title, so the citation must keep citing it); `PHILOSOPHY.md`'s one
      explanatory paragraph on why the mechanism was originally named after
      C++'s SFINAE and why PEP-054 renamed it (kept deliberately, for the same
      reason this PEP's own Context section explains the old name before
      renaming it); and this PEP's own changeset
      (`.changeset/pep-054-diagnostic-suppression-rename.md`), which
      necessarily names the old symbols it renames. `.changeset/pep-034-language-service-parity.md`
      is an older, already-shipped changeset describing what PEP-034 shipped
      under the name valid at the time — left untouched, same as any other
      historical record. (`type-rewrite-registry.ts`'s own API/symbols stay
      unrenamed per the Scope section above, but its stale doc-comment
      mentions of the _other_, renamed mechanism were fixed, so it is not an
      exception to this grep.)
- [x] Changeset noting the breaking CLI flag/env var rename.

**Gate:** full suite green, full workspace build clean, zero remaining
"sfinae" occurrences in code/docs outside `peps/` and the intentional
exceptions listed above.

## Acceptance criteria

- No symbol, file, CLI flag, env var, or doc prose in the codebase uses
  "SFINAE" terminology, other than: historical PEP text (`peps/`, plus the
  already-shipped `.changeset/pep-034-language-service-parity.md`); this
  PEP's own `@see` backreference, Context-section explanation of the old
  name, and changeset (which necessarily names the old symbols it renames);
  the `@see PEP-011` citations in `adt.ts`/`opaque.ts` (PEP-011 keeps its
  historical title); and `PHILOSOPHY.md`'s one paragraph explaining why the
  mechanism was originally named after C++'s SFINAE. `type-rewrite-registry.ts`'s
  own symbols are deliberately not renamed (it's a separate, correctly-named
  mechanism), but its doc comments no longer use "SFINAE" to describe the
  mechanism this PEP renamed.
- `DiagnosticSuppressionRule` and its family read correctly on their own,
  without requiring the reader to know C++ template metaprogramming to
  understand what they do.

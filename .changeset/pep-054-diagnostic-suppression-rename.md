---
"@typesugar/core": minor
"@typesugar/macros": minor
"@typesugar/transformer": minor
"@typesugar/lsp-server": patch
"@typesugar/playground": patch
---

PEP-054: Rename "SFINAE rules" to "diagnostic suppression rules"

"SFINAE" borrowed C++ template-metaprogramming terminology (overload-resolution
failure) for a mechanism that actually suppresses a TypeScript diagnostic when
typesugar's macro transformer will resolve it at emit time — an unrelated,
misleading analogy. Renamed throughout to `DiagnosticSuppressionRule` and its
family.

- **`@typesugar/core`** (breaking): `packages/core/src/sfinae.ts` and
  `sfinae-rules.ts` are renamed to `diagnostic-suppression.ts` and
  `diagnostic-suppression-rules.ts`. Every exported symbol is renamed:
  `SfinaeRule` → `DiagnosticSuppressionRule`, `SfinaeAuditEntry` →
  `DiagnosticSuppressionAuditEntry`, `SfinaeEvalResult` →
  `DiagnosticSuppressionEvalResult`, `registerSfinaeRule(Once)` →
  `registerDiagnosticSuppressionRule(Once)`, `clearSfinaeRules` →
  `clearDiagnosticSuppressionRules`, `getSfinaeRules` →
  `getDiagnosticSuppressionRules`, `getSfinaeAuditLog`/`clearSfinaeAuditLog` →
  `getDiagnosticSuppressionAuditLog`/`clearDiagnosticSuppressionAuditLog`,
  `isSfinaeAuditEnabled`/`setSfinaeAuditMode` →
  `isDiagnosticSuppressionAuditEnabled`/`setDiagnosticSuppressionAuditMode`,
  `evaluateSfinae` → `evaluateDiagnosticSuppression`. No deprecated aliases
  (pre-1.0, matching PEP-053's precedent). The `TYPESUGAR_SHOW_SFINAE`
  environment variable is renamed to `TYPESUGAR_SHOW_SUPPRESSED_DIAGNOSTICS`.
- **`@typesugar/macros`** (breaking): `sfinae-rules.ts`/`sfinae-registration.ts`
  renamed to `diagnostic-suppression-rules.ts`/`diagnostic-suppression-registration.ts`.
  `SfinaeRegistrationOptions` → `DiagnosticSuppressionRegistrationOptions`,
  `registerAllSfinaeRules` → `registerAllDiagnosticSuppressionRules`,
  `ALL_SFINAE_RULE_NAMES` → `ALL_DIAGNOSTIC_SUPPRESSION_RULE_NAMES`. Individual
  rule creator functions (`createExtensionMethodCallRule`, etc.) are unchanged.
- **`@typesugar/transformer`** (breaking, CLI): the `--show-sfinae` flag is
  renamed to `--show-suppressed-diagnostics`. No deprecated alias — the old
  flag is now silently ignored (typesugar's CLI does not error on unrecognized
  flags), so scripts/CI invocations using the old name will stop enabling
  audit mode without a warning. Update any tooling that passes `--show-sfinae`
  or reads `TYPESUGAR_SHOW_SFINAE`.
- **`@typesugar/lsp-server`, `@typesugar/playground`**: internal call sites
  updated to the renamed core/macros exports; no public API changes.

Not renamed (deliberately out of scope, see PEP-054): `type-rewrite-registry.ts`
(a separate, correctly-named mechanism), and PEP-011/PEP-034's own historical
titles.

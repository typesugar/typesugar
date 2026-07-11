# typesugar Enhancement Proposals (PEPs)

Design documents for typesugar. Each PEP captures the motivation, design, and
status of a feature or cleanup effort. New work starts as a PEP before it lands.

**Status legend:** _Draft_ (proposed, not started) · _In Progress_ ·
_Implemented_ / _Complete_ / _Done_ (shipped) · _Superseded_ / _Withdrawn_
(no longer the active plan; kept for history).

| PEP                                                     | Title                                                     | Status                                                                       |
| ------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [001](PEP-001-sts-file-extension.md)                    | `.sts` File Extension for Sugared TypeScript              | Superseded by [047](PEP-047-remove-sts.md)                                   |
| [002](PEP-002-oxc-native-macro-engine.md)               | Oxc-Native Macro Engine                                   | Complete                                                                     |
| [003](PEP-003-oxc-sts-parser.md)                        | Oxc-Based `.sts` Parser                                   | Withdrawn (depends on `.sts`, removed in [047](PEP-047-remove-sts.md))       |
| [004](PEP-004-source-based-typeclass-features.md)       | Source-Based Typeclass Features                           | Complete                                                                     |
| [005](PEP-005-type-safety-and-speed.md)                 | Type Safety and Speed — Matching the TypeScript DX        | Done                                                                         |
| [006](PEP-006-cspell-dictionary.md)                     | cSpell Dictionary for typesugar                           | Draft                                                                        |
| [007](PEP-007-hkt-boilerplate-reduction.md)             | HKT Boilerplate Reduction for `.ts` Files                 | Done                                                                         |
| [008](PEP-008-pattern-matching.md)                      | Scala-Style Pattern Matching                              | Waves 1–9 Complete                                                           |
| [009](PEP-009-diff-typeclass.md)                        | Diff Typeclass                                            | Draft                                                                        |
| [010](PEP-010-match-type.md)                            | Type-Level Pattern Matching                               | Draft                                                                        |
| [011](PEP-011-sfinae-diagnostic-resolution.md)          | SFINAE Diagnostic Resolution                              | Done                                                                         |
| [012](PEP-012-type-macros.md)                           | Type Macros                                               | Done                                                                         |
| [013](PEP-013-interactive-playground.md)                | Interactive Playground                                    | Complete (Wave 8 deferred)                                                   |
| [014](PEP-014-adt-macro.md)                             | ADT Macro for Zero-Cost Discriminated Unions              | Done                                                                         |
| [015](PEP-015-browser-compatible-transformer-core.md)   | Browser-Compatible Transformer Core                       | Done                                                                         |
| [016](PEP-016-server-backed-playground.md)              | Server-Backed Playground                                  | Done (superseded by [024](PEP-024-playground-architecture-consolidation.md)) |
| [017](PEP-017-derive-unification.md)                    | Unify `@derive`/`@deriving` — "Everything is a Typeclass" | Done                                                                         |
| [019](PEP-019-output-quality.md)                        | Output Quality — Valid TypeScript, Cleaner Codegen        | Done                                                                         |
| [020](PEP-020-replace-binop-with-named-macros.md)       | Replace `__binop__` with Named Operator Macros            | Withdrawn (superseded by [047](PEP-047-remove-sts.md))                       |
| [021](PEP-021-codebase-hygiene.md)                      | Codebase Hygiene — Artifacts, Doc Consistency, Slop       | Implemented                                                                  |
| [022](PEP-022-tree-shaking-pure-annotations.md)         | Automatic Tree-Shaking via `/*#__PURE__*/`                | Draft                                                                        |
| [023](PEP-023-playground-examples-overhaul.md)          | Playground Examples Overhaul                              | Done                                                                         |
| [024](PEP-024-playground-architecture-consolidation.md) | Playground Architecture Consolidation                     | Done                                                                         |
| [025](PEP-025-match-api-consolidation.md)               | Match API Consolidation                                   | Implemented                                                                  |
| [026](PEP-026-macro-module-decomposition.md)            | Macro Module Decomposition                                | Draft                                                                        |
| [027](PEP-027-use-extension-emit-registration.md)       | Emit Extension Registration from `"use extension"`        | Complete                                                                     |
| [028](PEP-028-symbolic-type-hierarchy-fix.md)           | Fix Symbolic Expression Type Hierarchy                    | Implemented                                                                  |
| [029](PEP-029-ci-performance.md)                        | CI Performance Improvements                               | Implemented                                                                  |
| [030](PEP-030-transformer-robustness.md)                | Transformer & Macro Robustness                            | Implemented                                                                  |
| [031](PEP-031-standalone-lsp-and-zed-extension.md)      | Standalone LSP Server & Zed Extension                     | Implemented (scope reduced by [047](PEP-047-remove-sts.md))                  |
| [032](PEP-032-macro-expansion-import-emission.md)       | Self-Contained Macro Expansions via Companion Objects     | Implemented                                                                  |
| [033](PEP-033-production-readiness.md)                  | Production Readiness — CLI, Macro Registration, Docs      | Done (all waves + N1–N6 resolved 2026-06-28)                                 |
| [034](PEP-034-language-service-parity.md)               | Language Service Parity — Unified SFINAE & IDE Infra      | Implemented                                                                  |
| [035](PEP-035-emit-pipeline-architecture.md)            | Emit Pipeline Architecture                                | Implemented                                                                  |
| [036](PEP-036-source-map-red-team.md)                   | Source Map Red Team — Error Positioning Accuracy          | Done                                                                         |
| [037](PEP-037-editor-integration-testing.md)            | Editor Integration Testing Framework                      | Draft                                                                        |
| [038](PEP-038-lsp-diagnostic-pipeline-fix.md)           | LSP Diagnostic Pipeline Fix                               | Partially Implemented (Waves 1–2C done; 2D–2G open)                          |
| [039](PEP-039-core-hardening.md)                        | Core Hardening — Bug Fixes, Codegen, Test Coverage        | Complete (all 6 waves)                                                       |
| [040](PEP-040-tool-schemas.md)                          | `@tool` — Compile-Time Agent Tool Schemas                 | Draft                                                                        |
| [041](PEP-041-compile-time-di.md)                       | Compile-Time Dependency Injection                         | Draft                                                                        |
| [042](PEP-042-fusion-kernels.md)                        | Fusion Phase 2+ — Typed-Array Loops & GPU Kernels         | Draft                                                                        |
| [043](PEP-043-sql-schema-verification.md)               | Compile-Time SQL Schema Verification                      | Draft                                                                        |
| [044](PEP-044-typed-i18n.md)                            | Type-Checked i18n with Compile-Time Extraction            | Draft                                                                        |
| [045](PEP-045-taint-tracking.md)                        | Compile-Time Taint Tracking as a Security Product         | Draft                                                                        |
| [046](PEP-046-zero-cost-state-machines.md)              | Zero-Cost Verified State Machines                         | Draft                                                                        |
| [047](PEP-047-remove-sts.md)                            | Remove the `.sts` Extension and Custom Surface Syntax     | Done                                                                         |
| [048](PEP-048-package-triage.md)                        | Package Triage — Keep, Freeze, or Remove                  | Done                                                                         |
| [049](PEP-049-cruft-cleanup.md)                         | Cruft Cleanup — Plans, Docs Drift, Test Debt, Security    | Done                                                                         |
| [050](PEP-050-shipping-typesugar-libraries.md)          | Authoring & Shipping Standalone typesugar Libraries       | Done                                                                         |
| [051](PEP-051-readme-guide-consolidation.md)            | README → Guide Consolidation (one set of docs)            | Done                                                                         |
| [052](PEP-052-import-scoped-macro-activation.md)        | Import-Scoped Macro Activation (cats-style syntax)        | In Progress                                                                  |
| [053](PEP-053-always-on-specialization.md)              | Always-On Specialization (no explicit `specialize` API)   | Implemented                                                                  |
| [054](PEP-054-diagnostic-suppression-rules-naming.md)   | Rename "SFINAE Rules" to "Diagnostic Suppression Rules"   | Implemented                                                                  |
| [055](PEP-055-macro-package-discovery.md)               | Macro-Package Discovery via `package.json`                | Implemented                                                                  |
| [056](PEP-056-transformer-pipeline-unification.md)      | Transformer Pipeline Unification — One Engine, Not Two    | Implemented (Waves 1–5)                                                      |
| [057](PEP-057-ast-purity-exception-list-audit.md)       | AST-Purity Exception List Audit — Closing the Gap         | Draft                                                                        |
| [058](PEP-058-production-release-readiness.md)          | Production Release Readiness — Pipeline, AI, Onboarding   | In Progress (Wave 1)                                                         |

# PEP-045: Compile-Time Taint Tracking as a Security Product

**Status:** Draft
**Date:** 2026-06-10
**Author:** Dean Povey

## Context

The analysis (§4.8) observes that every piece of a compile-time taint system
already exists in typesugar — refined types, branded non-assignability, attribute
macros, the contracts prover — "all the pieces exist; the composition does not."
The ROADMAP then parks taint tracking at P6 with the note: "TS injection surfaces
are narrow. Frameworks solve this."

That skepticism is right about the _feature_ framing and wrong about the
_product_ framing. As a typesugar feature for typesugar users, taint tracking is
niche. As a standalone security gate — "Perl taint mode for TypeScript, enforced
in CI, zero runtime cost" — it addresses a buyer (security teams) who does not
care about typeclasses at all, and who currently pays for Semgrep/CodeQL rules
that approximate this with far less precision than a type system provides.

The mechanism is the key insight: **tsc does the flow analysis for free.**
`Tainted<string>` is not assignable to `string`, so tainted data propagating to a
clean-typed sink is a _TypeScript error_, not a bespoke dataflow engine. The
macros' job is only to brand sources, declare sinks, and bless sanitizers.

## Proposal

New package: `@typesugar/secure`.

### Core types

```typescript
type Tainted<T extends string = string> = Refined<T, "Tainted">;
```

### Sources — auto-branding via adapters

Framework adapters re-type ingress points so user code sees tainted types
without writing any annotations:

```typescript
// @typesugar/secure/express
req.query; // Record<string, Tainted<string>>
req.params; // Record<string, Tainted<string>>
req.body; // DeepTainted<T>
```

Adapters: express, hono, fastify first. `DeepTainted<T>` is a mapped type
branding every string leaf.

### Sanitizers — the only way out

```typescript
@sanitizer
function escapeHtml(s: Tainted<string>): string { ... }

const id = validate<OrderId>(req.params.id);  // validate<T>() already proves shape
```

`@sanitizer` is mostly documentation plus registry entry (for reporting); the
type signature itself does the work. Crucially, `@typesugar/validate`'s
`validate<T>()` / `is<T>()` macros become sanitizers for free — proving a value
matches `OrderId` _is_ sanitization. This is the validate ↔ refined-types
integration (ROADMAP P4) earning its keep.

### Sinks — declared, then enforced

```typescript
@sink("sql-injection")
function rawQuery(q: string): Promise<Rows>;
```

Plus a shipped sink manifest for common libraries (`pg.query`, `child_process.exec`,
`element.innerHTML =`, `res.send` with html content-type, `eval`). For sinks in
third-party code the enforcement is a transformer diagnostic at the call site
(call-site analysis over `moduleIndex()`), since we can't re-type someone else's
.d.ts safely.

### Escape hatch + audit

```typescript
const q = unsafeTrusted(s, "reviewed: constant-joined identifier");
```

Required reason string; every use is collected into a build report
(`typesugar secure report`) — the audit trail the security buyer actually wants.

## Why this is credible where P6 doubted it

- No dataflow engine to build or maintain — assignability _is_ the analysis,
  including through ordinary user functions (a helper that passes a tainted
  string through inherits the taint in its inferred types).
- False-positive control is the type system's: explicit sanitizers, no
  heuristics.
- The deliverable is a CI gate + report, not a language feature. It can be
  adopted on a codebase that uses zero other typesugar features.

Known limitation to state honestly: taint is lost through `JSON.stringify`/
`any`/string concatenation normalization (`` `${tainted}` `` yields `string`).
Template-literal and `+` concatenation need transformer help: rewrite the result
type to tainted when any operand is tainted — this is the one place macros must
supplement tsc, and it's bounded.

## Implementation Plan

- **Wave 1 — types + validate integration**: `Tainted`, `DeepTainted`,
  `validate<T>()` as sanitizer, concat/template taint propagation in the
  transformer.
- **Wave 2 — express adapter + pg/exec/innerHTML sink manifest + diagnostics.**
- **Wave 3 — `unsafeTrusted` + `secure report`** (uses PEP-044's artifact
  emission), CI mode (`--max-unsafe 0`).
- **Wave 4 — hono/fastify adapters; rule packs** (XSS, SQLi, command injection,
  path traversal categories).

## Open Questions

1. Severity model: per-sink error vs warning, and a baseline file for brownfield
   adoption (existing violations grandfathered, new ones fail). Baseline file is
   probably mandatory for real adoption — recommend Wave 3.
2. Does `DeepTainted<T>` blow up checker performance on large body types?
   Benchmark in Wave 2; fall back to shallow branding + lint-level deep checks if
   so.
3. Relationship to PEP-039-hardened diagnostics codes: claim a `sec###` range.

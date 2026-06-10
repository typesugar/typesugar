# PEP-042: Fusion Phase 2+ — Typed-Array Loops and GPU Kernel Generation

**Status:** Draft
**Date:** 2026-06-10
**Author:** Dean Povey

## Context

`@typesugar/fusion` Phase 1 (runtime lazy iterators) exists. The ROADMAP's
Phase 2 ("compile-time chain analysis", Difficulty 5 / Impact 5) plans to fuse
`.filter().map().reduce()` chains into single loops. This PEP extends that plan
with the direction that makes it genuinely unique rather than merely fast:
**numeric kernel generation** — compiling expression templates over typed arrays
into allocation-free loops, and (Phase 4) into WebGPU compute shaders.

This is the Blitz++/Eigen lineage the package names already claim. Nothing in the
JS ecosystem does this: numeric libraries (math.js, ndarray, TensorFlow.js) are
runtime interpreters of expression graphs. typesugar can evaluate the expression
graph at compile time and emit the loop a C programmer would write.

## Proposal

### Phase 2 — chain fusion (as roadmapped, made concrete)

```typescript
const total = orders
  .filter(o => o.status === "paid")
  .map(o => o.amount * 1.1)
  .reduce((a, b) => a + b, 0);
```

compiles to:

```typescript
let total = 0;
for (let i = 0; i < orders.length; i++) {
  const o = orders[i];
  if (o.status !== "paid") continue;
  total += o.amount * 1.1;
}
```

- Fusable ops: `map`, `filter`, `flatMap` (bounded), `take`, `drop`, `reduce`,
  `some/every/find`, `forEach`.
- Early termination (`take`, `find`, `some`) compiles to `break`.
- Unfusable boundaries (`sort`, `reverse`, escaping references to intermediates)
  materialize an array at the boundary and emit a **fusion diagnostic** — same
  policy as specialization diagnostics: never silently degrade (Analysis §4.6).
- Closures must be inlinable arrow literals or resolvable consts; otherwise the
  chain falls back with a diagnostic naming the blocking expression. Reuses the
  binding-time analysis planned for `specialize` (TODO §Soundness) — build it
  once, share it.

### Phase 3 — numeric expression templates over typed arrays

```typescript
import { vec } from "@typesugar/fusion/numeric";

const a = vec(Float64Array, n), b = vec(Float64Array, n);
const c = a * 2.0 + b / scale;   // via operator typeclass instances
```

Without fusion, operator overloading allocates two temporaries. With it, the
expression tree is known at compile time and emits:

```typescript
const c = new Float64Array(n);
for (let i = 0; i < n; i++) c[i] = a[i] * 2.0 + b[i] / scale;
```

- In-place forms (`c.set(a * 2 + b)`) emit zero allocations.
- Reductions (`sum(a * b)` = dot product) fuse into the same loop.
- This is the expression-templates plan from `docs/completed/` made real, scoped
  to 1-D typed arrays first. Matrices (`@typesugar/math`) come later, if at all —
  see PEP-048 triage.

### Phase 4 — GPU kernels (exploratory)

For data-parallel chains marked explicitly:

```typescript
const result = await gpu(pixels).map(p => brighten(p, 1.2)).run();
```

The macro compiles the (restricted) kernel expression to WGSL at build time via
`comptime`, emits the shader as a string constant plus the WebGPU dispatch
boilerplate, with a generated CPU fallback loop. Restrictions (no closures over
heap objects, numeric types only) are enforced with diagnostics at the offending
expression.

Phase 4 is exploratory and gated on Phases 2–3 shipping. It is, however, the
demo that no other ecosystem tool can replicate, and worth a sandbox spike early
to validate WGSL emission through `comptime`.

## Implementation Plan

- **Wave 1 — binding-time analysis pass** (shared with `specialize`): classify
  expressions static/dynamic; determine inlinability of chain callbacks.
- **Wave 2 — chain fusion** for array literals/typed receivers; fusion
  diagnostics; benchmark suite proving zero intermediate allocations
  (`tests/benchmark.test.ts` style, but published in docs, not skipped in CI —
  see PEP-049).
- **Wave 3 — numeric vec/expression templates**, in-place forms, reductions.
- **Wave 4 — WGSL spike** in `sandbox/`, then PEP update with findings.

## Open Questions

1. Opt-in vs implicit: should fusion apply to *all* array chains (implicit, like
   `===` rewriting — with the same least-surprise concerns) or only chains rooted
   in an explicit marker (`fuse(items).map...`)? Recommendation: implicit for
   `.ts` projects with the transformer enabled is the headline, but ship opt-in
   first; semantics differences (e.g. `map` side-effect ordering across a fused
   `filter`) need the explicit form while trust is built.
2. Sparse arrays / holes: fused loops index directly; document divergence or
   guard with `i in arr` checks (slow). Recommendation: document — match what
   `for-of` does and call holes unsupported.

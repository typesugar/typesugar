# PEP-046: Zero-Cost Verified State Machines

**Status:** Draft
**Date:** 2026-06-10
**Author:** Dean Povey

## Context

XState is the de-facto statechart library for TypeScript. It is also a runtime
interpreter: the machine definition is a JSON-ish object walked on every event,
typing requires generated typegen files (or heavy inference), and the bundle
carries the interpreter. Meanwhile `@typesugar/graph` already contains state
machine machinery and the ROADMAP (P5 "State Machine Verification") plans
reachability/deadlock/determinism checks.

This PEP combines them into a wedge: **define a machine in plain TypeScript,
get compile-time verification (XState can't do that), and compile to a switch
function (XState won't do that).**

## Proposal

Part of `@typesugar/graph` (no new package).

### Definition

```typescript
const order = machine({
  initial: "cart",
  states: {
    cart: { on: { CHECKOUT: "payment" } },
    payment: {
      on: { SUCCESS: "confirmed", FAILURE: "payment", CANCEL: "cart" },
      entry: (ctx) => startPaymentTimer(ctx),
    },
    confirmed: { final: true },
    legacy: { on: { NEVER: "cart" } }, // ← unreachable
  },
});
```

`machine()` is an expression macro. The config must be a static object literal
(actions/guards may be arbitrary expressions; the _graph_ must be static —
enforced with a diagnostic on any computed key).

### Compile-time verification

At expansion time, on the static graph:

- **Reachability** — `legacy` above is a compile error pointing at its span.
- **Dead ends** — non-final states with no outgoing transitions.
- **Determinism** — duplicate event keys per state (incl. after spread merging).
- **Final-state sanity** — at least one final state reachable from initial
  (configurable off for long-running machines).
- **Exhaustiveness at call sites** — `send()` accepts only the union of events
  valid in _some_ state; optionally (strict mode) the phantom-typed API below
  narrows to events valid in the _current_ state.

### Generated code

A discriminated-union state + switch transition function — what you'd write by
hand:

```typescript
type OrderState = { tag: "cart" } | { tag: "payment" } | { tag: "confirmed" };
function orderTransition(s: OrderState, e: OrderEvent, ctx: Ctx): OrderState {
  switch (s.tag) {
    case "cart":
      return e.type === "CHECKOUT" ? (startPaymentTimer(ctx), { tag: "payment" }) : s;
    ...
  }
}
```

No interpreter, no subscription machinery in the core output. A thin optional
runtime (`createActor`-style, ~30 lines) is provided for users who want
listeners, but the transition function is the product.

### Phantom-typed strict mode

For workflow-engine use, the existing phantom state machine types in
`@typesugar/type-system` integrate so that `send` is only callable with events
legal in the statically-known current state:

```typescript
const m = order.start(); // Machine<"cart">
const m2 = m.send("CHECKOUT"); // Machine<"payment">
m2.send("CHECKOUT"); // compile error: not valid in "payment"
```

### Diagram artifact

Via the artifact-emission hook (PEP-044 Wave 1): emit
`machines/order.mmd` (Mermaid stateDiagram) per machine on build. Free
documentation, and the kind of demo that screenshots well.

## Scope exclusions (v1)

Hierarchical/parallel states, history states, delayed transitions, actor
spawning. These are XState's deep end; v1 targets the 80% flat-machine case
where verification + zero-cost output is a clean win. Hierarchy is a follow-up
PEP if adoption warrants.

## Implementation Plan

- **Wave 1 — `machine()` macro**: static-graph extraction, codegen
  (state union, transition switch, entry/exit actions), event union typing.
- **Wave 2 — verification**: reachability, dead-end, determinism, diagnostics
  with spans into the config literal.
- **Wave 3 — phantom strict mode** + thin actor runtime.
- **Wave 4 — Mermaid artifact + docs/benchmark vs XState** (bundle size,
  transition throughput).

## Open Questions

1. Guards: `on: { PAY: { target: "paid", guard: (ctx) => ctx.total > 0 } }` —
   include in Wave 1 (they're just a conditional in the switch) or defer?
   Recommendation: Wave 1; ubiquitous in real machines.
2. Context typing: single `Ctx` type parameter vs per-state context narrowing
   (Typestate). Per-state context is powerful but explodes scope — defer to the
   phantom strict mode wave.
3. Naming collision: `match()` exists in std; ensure generated state unions play
   nicely with `match()` exhaustiveness (they should — discriminated unions are
   its bread and butter; add an integration test).

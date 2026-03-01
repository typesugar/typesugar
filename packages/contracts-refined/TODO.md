# TODO

## Roadmap

### Prover Integration

- [ ] [2026-02-21] Compose refined type facts with `@validate` — when `@typesugar/validate` generates checks for refined types, the prover should be able to eliminate redundant checks (e.g., if the prover already knows `x: Positive`, skip the `x > 0` runtime check)
- [ ] [2026-02-21] Cross-function refinement propagation — if a function accepts `Positive` and passes it to another function expecting `NonNegative`, the prover should use the subtyping declarations to elide the second check
- [ ] [2026-02-21] Taint-to-refinement bridge — `@sanitized` functions that return refined types should register their output brands with the prover for downstream proof elimination

### Decidability Improvements

- [ ] [2026-02-21] Emit warnings when a "compile-time" decidable predicate falls back to runtime — currently the decidability annotations exist but aren't used for diagnostics

# TODO

## Deferred

### Cross-Cutting Concern Utilities

- [ ] `@memoize` attribute macro — wraps functions with cache lookup; use `Hash` typeclass for key generation when available; configurable `maxSize` and `ttl`; strippable via `cfg()`
- [ ] `@authorize` attribute macro — inject authorization checks at function entry; type-aware (verify function has access to `Session` or `AuthContext` parameter); compose with other cross-cutting macros via `expandAfter`

### Extension Method Gaps

- [ ] Type-aware logging extensions — `.debug()` extension on all types that uses `Show` typeclass for structured output, strippable via `cfg("debug")`
- [ ] `.timed()` extension on async functions — wraps with timing and returns `[result, durationMs]`; zero-cost when stripped via `cfg("profile")`

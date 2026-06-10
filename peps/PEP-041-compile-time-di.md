# PEP-041: Compile-Time Dependency Injection

**Status:** Draft
**Date:** 2026-06-10
**Author:** Dean Povey

## Context

Dependency injection in TypeScript today means a runtime container: NestJS,
InversifyJS, tsyringe, Awilix. All of them share the same costs:

- `reflect-metadata` + `emitDecoratorMetadata` (loses unions/generics, couples to
  legacy decorators)
- Runtime resolution: container lookups on hot paths, lazy failures at request
  time instead of build time
- Token boilerplate: interfaces erase, so users maintain parallel `Symbol` tokens
- Bundle weight and tree-shaking opacity — the container is a dynamic graph the
  bundler cannot see through

typesugar's implicit resolution machinery (`= implicit()`, the instance registry,
resolution traces) is _already_ a DI container — one that runs at compile time.
This PEP names that capability and productizes it. The ROADMAP's P5 "Implicit
Context Passing" gestures at the mechanism; this PEP reframes it around the use
case enterprise TypeScript teams actually have.

**The pitch:** NestJS-style wiring where the "container" compiles to plain
constructor calls. Misconfigured graphs are compile errors with resolution
traces. Zero runtime, zero metadata, zero tokens.

## Proposal

New package: `@typesugar/inject`.

### Declaring injectables

```typescript
@injectable
class Database {
  constructor(private config: DbConfig = inject()) {}
}

@injectable
class UserRepo {
  constructor(private db: Database = inject()) {}
}

@injectable({ scope: "transient" })
class RequestContext { ... }
```

`inject()` is the `implicit()` pattern: a default-parameter marker the transformer
recognizes. `@injectable` registers the class (constructor signature, scope,
provided type) in a compile-time registry — the same manifest/registry
infrastructure typeclass instances use.

### Bindings for interfaces

Interfaces erase, so binding an interface to an implementation is an explicit,
compile-time declaration — not a runtime token:

```typescript
// bindings.ts
@provides<Logger>()
class PinoLogger implements Logger { ... }

// or value/factory bindings:
@module
const AppModule = {
  bindings: [
    bind<Clock>().to(SystemClock),
    bind<DbConfig>().toValue({ url: env.DATABASE_URL }),
  ],
};
```

Resolution is keyed by checker type identity (the same mechanism `summon<TC<T>>()`
uses today), so no `Symbol` tokens exist anywhere.

### Wiring

```typescript
const app = wire<App>(AppModule);
```

`wire<T>()` is an expression macro. At compile time it:

1. Resolves the full constructor graph for `T` from the registry + bindings.
2. Topologically sorts it; detects cycles (compile error with the cycle path).
3. Emits plain code:

```typescript
const __config = { url: env.DATABASE_URL };
const __logger = /*#__PURE__*/ new PinoLogger();
const __db = /*#__PURE__*/ new Database(__config);
const __userRepo = /*#__PURE__*/ new UserRepo(__db);
const app = new App(__userRepo, __logger);
```

Singletons are module-level consts (shared across `wire()` calls in the same
module); transients are factory closures. Missing bindings produce a compile
error carrying a **resolution trace** (`packages/core/src/resolution-trace.ts` —
infrastructure already built for `summon()`): what was sought, what was found,
why each candidate was rejected.

### Testing story

```typescript
const app = wire<App>(AppModule, { override: [bind<Database>().to(FakeDb)] });
```

Overrides are applied at the macro call site — each `wire()` is its own static
graph, so test wiring has no global state to reset.

## What this is _not_

- Not request-scoped runtime DI (no per-request container). Transient scope +
  explicit factories cover the common cases; request scoping is a future PEP if
  demanded.
- Not lazy/conditional graphs. The graph must be statically resolvable — that is
  the point. `cfg()` handles build-variant wiring.

## Implementation Plan

- **Wave 1 — registry + `@injectable`.** Constructor signature capture, scope
  metadata, manifest discovery across packages.
- **Wave 2 — `wire<T>()`.** Graph resolution, toposort, cycle detection, codegen,
  resolution-trace diagnostics.
- **Wave 3 — bindings.** `@provides<T>()`, `bind<T>()` value/factory/class forms,
  `@module` grouping, overrides.
- **Wave 4 — benchmarks + comparison docs.** Bundle-size and cold-start
  comparisons vs NestJS/tsyringe; this is the headline material.

## Open Questions

1. Cross-module singletons: two `wire()` calls in different modules wanting the
   same singleton instance. Options: (a) hoist to the binding's defining module,
   (b) document one-composition-root as the pattern (recommended — matches the
   "explicit graph" philosophy).
2. Should `@injectable` be required at all, or can any class with an `inject()`
   default be auto-registered? Recommendation: require it — implicit registration
   recreates the coherence/orphan problems the analysis (§4.3) warns about.
3. Interaction with PEP-045 (taint) and PEP-040 (`@tool`): all three add
   call-graph-aware companions; share the manifest format.

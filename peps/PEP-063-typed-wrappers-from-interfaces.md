# PEP-063: Typed Wrappers from Interfaces — Zero-Cost Around-Advice, `forward<S>()`, `mock<T>(defaults)`

**Status:** In Progress (Waves 1–2 implemented; Wave 3 in review, #89)
**Date:** 2026-11-13
**Author:** Claude (with Dean Povey)
**Related:** [PEP-053](PEP-053-always-on-specialization.md) (always-on specialization),
[PEP-062](PEP-062-typeclass-dispatch-everywhere.md) (typeclass dispatch everywhere),
[PEP-041](PEP-041-compile-time-di.md) (compile-time DI: where wrappers would be chosen at
wiring time). Research notes and prototype: `~/src/personal/typesugar-compile-time-proxies/`
(not in the repo).

## Context

Dean asked (2026-11-13) whether typesugar should offer a "compile-time proxy", like Java
interceptors (`@Transactional`, CDI `@Interceptor`, Spring AOP), and whether there is a
better shape than annotations.

What people dislike about the annotation/proxy style, across Spring AOP, CDI, Castle
DynamicProxy, AspectJ, NestJS interceptors, C# interceptors and JS `Proxy`:

1. **Self-invocation bypass.** A proxy wraps the object, so `this.foo()` inside it skips the
   advice (`@Transactional` on an internal call silently does nothing).
2. **Invisible control flow.** Nothing at the call site says the call is retried, traced or
   transactional.
3. **Untyped pointcuts.** AspectJ's `execution(* com..*Service.*(..))` silently matches
   nothing after a rename.
4. **Ordering** between aspects is a number (`@Order`, `@Priority`).
5. **Runtime cost.** Reflection at startup; a JS `Proxy` `get` trap costs about 21 ns per
   call against 2.5–3 ns for a closure wrapper and 0.6 ns for a direct call (Node 22,
   measured in the research prototype).

The shapes people like are explicit and typed: ZIO's `effect @@ aspect`, Effect layers,
Rust's `#[tracing::instrument]` (compile time, local). The common thread is that the wrapper
is said where the service is built, typed against its interface, in source order.

The research also measured what typesugar does today with an aspect written as a typeclass
instance (`around<R>(op: string, body: () => R): R`):

- A no-op instance (`around: (op, body) => body()`) specializes, but leaves the thunk as
  `(() => "user:" + id)()`.
- A real instance with a block body (`try`/`finally` timing) is **not inlined at all**: TS9602
  "inlining returned no result; falling back to dictionary passing". The expression inliner
  can't turn a `try` into an expression, so the whole specialization is dropped.
- An `async` instance method is never even extracted for inlining.

So the typeclass machinery, which is typesugar's answer to "typed, explicit, zero cost", stops
working exactly where around-advice needs it.

A forwarding wrapper generated at compile time is **not faster** than a hand-written closure
wrapper when the advice is on (measured equal within noise); it is about 7x faster than a
`Proxy`. The only runtime win a macro has over a plain wrapper is compiling the advice out
when it is disabled. The rest of the value is typing and boilerplate: the macro knows the
interface's members, their parameters and return types.

## Decision

Not an AOP feature: no annotations on targets, no type- or module-scoped weaving with
pointcuts (that recreates AspectJ's invisible control flow and needs a cross-file registry
consulted during every file's transform). Instead, three pieces that make the explicit,
typed shapes zero cost and cheap to write:

1. **Wave 1 — around-advice inlines.** `return T.around("op", () => expr)` with a
   block-bodied (or `async`) `around` inlines as statements into the specialization.
2. **Wave 2 — `forward<S>(inner, advice)`.** A typed forwarding object generated from an
   interface, with the advice inlined per member.
3. **Wave 3 — `mock<T>(defaults)`.** The existing compile-time `mock<T>()` (testing) honours
   the defaults argument it already advertises.

Deferred (not in this PEP's waves): `client<S>(transport)` RPC stubs with per-method codecs;
`.with(...)` wrappers at the PEP-041 DI wiring point.

## Design

### Wave 1: statement-position inlining of instance methods

`inlineMethodAsStatements` (`packages/macros/src/specialize.ts`) inlines a dictionary call in
`return D.m(args)` position as `m`'s statements. Every `return` in the body returns from the
enclosing (hoisted, specialized) function, which is what `return D.m(args)` did with `m`'s
result; a body that can finish without returning gets a trailing `return;`. The
specializer (`rewriteDictCallsForAutoSpec`, `packages/transformer-core/src/specialization.ts`)
tries the expression inliner first and only uses this for what it declines. A concise arrow
callee (`=> T.around(...)`) is treated as `{ return T.around(...); }`.

```ts
/** @impl Traced<UserSvc> */
const timed: Traced<UserSvc> = {
  around: (op, body) => {
    const t0 = performance.now();
    try {
      return body();
    } finally {
      console.log(op, performance.now() - t0);
    }
  },
};
function getUser(id: string, T: Traced<UserSvc> = implicit()): string {
  return T.around("getUser", () => "user:" + id);
}
getUser("1");

// emits
const __typesugar___getUser_UserSvc_0__ = (id: string) => {
  {
    const __typesugar_t0_0__ = performance.now();
    try {
      return "user:" + id;
    } finally {
      console.log("getUser", performance.now() - __typesugar_t0_0__);
    }
  }
};
__typesugar___getUser_UserSvc_0__("1");
```

Rules:

- **Arguments** are evaluated once, in order, before the body. A literal is substituted. A
  function argument is substituted only where its parameter's one use is a plain call
  (`body()`), so neither its identity nor a `const`'s inferred name can be observed; anything
  else declines. Other values go into a fresh `const`, or are dropped when the body never
  reads them and they have no effect (an advice's unused `args`).
- **Thunk beta-reduction** (also in the expression inliner, `substituteParamRefs`): `body()`
  where `body` is bound to `() => expr` and read nowhere else becomes `(expr)`. Exact: calling
  a parameterless non-async arrow evaluates its expression in place; inside a loop (retry) it
  is still evaluated per iteration. Not when the call's value is itself called, tagged or
  deleted (`body()()` would bind `this`), and not when the arrow reads `this`/`arguments`.
- **Hygiene.** Every name the body declares gets a fresh name, so it can't capture a name the
  arguments use (`twice(t0)` with advice declaring `t0`). A body free name the enclosing
  function binds (the caller has its own `note` and the advice calls the module's `note`)
  declines, as does a local that shares a name with a free name or an undeclared global
  (`undefined`), a parameter redeclared inside the body, and a method with no recorded
  free-name symbols.
- **Declines** (dictionary passing, as before): receiver use (`this`, `arguments`), generators,
  labels, destructuring, classes, default/rest parameters, a parameter written to (including
  `for (p of ...)` and `[p] = ...`), a spread or mismatched argument count.
- **`async`.** Instance extraction now keeps `async` methods
  (`methodDependsOnReceiverExceptAsync`). The statement path puts an `async` body in
  `return (async () => { ... })();` after the argument `const`s, which is exactly the call
  (synchronous argument errors, the same promise and timing, the caller's own `try` never
  sees the body's throws) with the arguments substituted. The expression inliner applies an
  `async` method in place as an async arrow, so an async instance doesn't add TS9602 warnings.
- Type names in the inlined body are re-expressed for the call site by the existing
  `reexpressInlinedTypes`.

Shape note (CLAUDE.md "Resolving things a macro just generated"): this adds no resolution
mechanism; it consumes the instance methods the existing extractor resolves through the
checker at the call site.

### Wave 2: `forward<S>(inner, advice?)`

```ts
import { forward } from "typesugar";

const repo: UserRepo = forward<UserRepo>(new PgUserRepo(db), {
  around: (method, args, next) => {
    const t0 = performance.now();
    try {
      return next();
    } finally {
      metrics.record(method, performance.now() - t0);
    }
  },
  only: ["get", "save"], // (keyof UserRepo)[]: a rename is a compile error
  when: "metrics", // compile-time cfg condition; false → `forward` emits `inner`
});
```

- An expression macro reads `S`'s members with the checker (from the type argument, real
  source) and emits an IIFE taking `inner`, returning an object literal typed `S` (so every
  member's parameters are contextually typed, generic members included):
  `((inner: UserRepo): UserRepo => ({ get(id) { <advice inlined> }, save(u) { ... },
count() { return inner.count(); } }))(new PgUserRepo(db))`.
- **Advice inlining** reuses Wave 1: the `around` arrow is treated as a method and inlined
  with `method` → the member name literal, `args` → `[id]`, `next` → `() => inner.get(id)`
  (beta-reduced). An advice that isn't an object literal, or an `around` the inliner
  declines, is called through: `advice.around("get", [id], () => inner.get(id))`. Still a
  typed forwarding object with no reflection.
- **Typing.** `Advice<S>.around` is generic per member:
  `<K extends MethodKeys<S>>(method: K, args: Parameters<S[K]>, next: () => ReturnType<S[K]>) => ReturnType<S[K]> | Promise<unknown>`.
  The `Promise<unknown>` is there because TypeScript can't relate an async function's inferred
  `Promise<R>` to `Promise<Awaited<R>>` for a generic `K`; an inlined advice is still checked
  exactly (its body lands in the object literal typed `S`), and a called-through advice's
  result is cast back to `ReturnType<S["m"]>` (`never` for a generic member).
- **Free names.** `forward` records the advice's free names with the checker (as instance
  extraction does), so the statement inliner can rename the advice's locals.
- **Ordering.** `forward<S>(inner, [outer, inner2])`: the first advice is outermost.
- **`async`.** An `async` advice applies only to promise-returning members (a warning for the
  others it would have matched); inlined, its body is `return (async () => { ... })()`, exactly
  the call. A sync advice around a promise-returning member wraps the promise as written.
- **`this`.** Calls are `inner.m(...)`, so `this` inside the implementation is the real object
  and `#private` fields work (unlike `Proxy`). Non-method members are forwarded as getters.
- **Self-calls bypass the advice**, as with every forwarding proxy (Spring's problem). The
  guide says so first, and points to Wave 1 (advice inside the method) for self-call
  coverage.
- **Overloaded members** forward without advice (`inner.m.bind(inner)`), with a warning.

### Wave 3: `mock<T>(defaults)`

`mock<UserRepo>({ get: async (id) => ({ id }) })`: the macro passes the defaults through to
`createMockObject<T>(names, defaults)`; a function default is the mock's implementation
(still call-tracked, still overridable), anything else is copied as a property. Previously
the argument was silently dropped.

## Waves

| Wave | Scope                                                                                         | Branch                           | Status          |
| ---- | --------------------------------------------------------------------------------------------- | -------------------------------- | --------------- |
| 1    | Statement inlining of around-advice; thunk beta-reduction; `async` instance methods extracted | `pep-063-wave-1-around-inlining` | Implemented     |
| 2    | `forward<S>(inner, advice)` macro, runtime stub, guide                                        | `pep-063-wave-2-forward`         | Implemented     |
| 3    | `mock<T>(defaults)` honours defaults                                                          | `pep-063-wave-3-mock-defaults`   | In review (#89) |

## Risks

- **Inlining block bodies** is where hygiene and control-flow bugs live (`return` mapping,
  `await`, labels, `arguments`, name capture). Wave 1 declines conservatively and keeps
  dictionary passing, which is always correct.
- **`async` instance methods now count toward the free-name rule.** A call site is
  specialized only if every method of the instance resolves its free names there; an
  `async` method used to be dropped from extraction, so it didn't count. Same rule as for
  every other method; noted because it can turn a specialization off.
- **`forward` sells no speed when the advice is on.** Measured equal to a closure wrapper. The
  docs sell typing, compile-out and no reflection, not nanoseconds.
- **Self-call bypass** will surprise Spring users; documented up front.

## Open questions

- Should `forward` also accept an `Around<S>` typeclass instance resolved from scope
  (`forward<S>(inner)` with no advice argument)? That would make the instance choice
  import-scoped like other typeclasses (PEP-052), at the cost of more invisible behaviour.

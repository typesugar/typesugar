# Typed Forwarding with `forward<S>()`

`forward<S>(inner, advice)` wraps an object that implements interface `S` in a
forwarding object generated at compile time: every method of `S` calls the same
method on `inner`, and an advice's `around` runs around each call. It is what
Java interceptors and Spring AOP proxies do, but explicit at the place you
build the service, typed against the interface, and with no `Proxy` and no
reflection at run time.

> **Calls an object makes on itself bypass the advice.** `forward` wraps
> `inner`; when `inner.getTwice()` calls `this.get()`, that call goes to
> `inner.get`, not through the advice. This is true of every forwarding proxy
> (it is Spring's self-invocation problem). To cover self-calls, put the
> advice inside the method with an [around-advice
> typeclass](./specialize.md#around-advice-wrapping-a-call-in-an-instance-method).

## Usage

```typescript
import { forward } from "typesugar";

interface UserRepo {
  get(id: string): Promise<User>;
  save(user: User): Promise<void>;
  count(): number;
}

const repo = forward<UserRepo>(new PgUserRepo(db), {
  around: (method, args, next) => {
    const t0 = performance.now();
    try {
      return next();
    } finally {
      metrics.record(method, performance.now() - t0);
    }
  },
  only: ["get", "save"],
  when: "metrics",
});
```

Compiles to (with `metrics` on):

```typescript
const repo = ((inner: UserRepo): UserRepo => ({
  get(id) {
    const __typesugar_t0_0__ = performance.now();
    try {
      return inner.get(id);
    } finally {
      metrics.record("get", performance.now() - __typesugar_t0_0__);
    }
  },
  save(user) {
    // ... the same, for "save"
  },
  count() {
    return inner.count();
  },
}))(new PgUserRepo(db));
```

and with `metrics` off, to `const repo = (new PgUserRepo(db)) satisfies UserRepo as UserRepo;`:
the object itself, typed `UserRepo`.

## The advice

| Field    | Meaning                                                                                                                 |
| -------- | ----------------------------------------------------------------------------------------------------------------------- |
| `around` | `(method, args, next) => result`: runs in place of each method. `next()` calls the method on `inner`.                   |
| `only`   | The methods the advice applies to. A name that isn't a method of `S` is a type error, so a rename can't leave it stale. |
| `when`   | A compile-time [`cfg`](./conditional-compilation.md) condition. False: the advice is dropped. Inline advice only.       |

`around` is typed per member: for `get`, `args` is `[id: string]` and `next()`
returns `Promise<User>`, and `around` must return that type. In practice that
means returning `next()`'s result (or something TypeScript can see is the same
type); advice that returns a value of its own, like a cache, needs a cast.

- **Inlined.** An advice written as an object literal with an inline `around`
  is copied into each method, with `method` as the member's name, `args` as its
  arguments and `next()` as the call on `inner`. The result is the code you
  would have written by hand.
- **Called through.** Any other advice (a variable of type `Advice<S>`, a
  function call) is evaluated once, when `forward` runs, and each method calls
  its `around`, checking at run time that it has one and that `only` (if any)
  lists the method. `when` can't be checked at run time, so it is an error on
  such an advice. The same call-through happens when an inline `around` can't
  be copied safely (it reads a name that one of the generated parameters
  would shadow). Either way there is no `Proxy`. A called-through advice can't
  be checked for `async` at compile time: give an async one an `only` list of
  promise-returning methods.
- **Several advices**: pass a list, outermost first:
  `forward<S>(inner, [tracing, retries])`.
- **`async`**: a sync advice around a promise-returning method sees the promise
  (`next()` returns it). An `async` advice is applied only to methods that
  return a promise; its body is inlined as an async arrow called in place,
  which behaves exactly like calling the advice.
- **`this` and private fields** work: methods are called as `inner.m(...)`, so
  `inner`'s own `#private` fields are reachable, unlike through a `Proxy`.
- **Properties** are forwarded with getters, and setters when writable (no
  `readonly`, or an accessor with a `set`). A function-typed property
  (`onClick: () => void`) is forwarded as a method, advice included; assigning
  to it on the forwarding object doesn't reach `inner`.
- **Overloaded and optional methods** are forwarded as `inner.m.bind(inner)`,
  without advice, with a warning when an advice would have applied.
- **Names** that aren't identifiers (`"content-type"`, `0`) are forwarded as
  quoted members.
- **Fluent methods** that return `this` return `inner`, so in
  `repo.add(1).add(2)` only the first call goes through the advice.
- **Optional parameters** are passed on as written, so an omitted one arrives
  as `undefined` (`args.length` is the declared count).
- **What `S` can be**: an interface or object type, or a class without private
  or protected members. `any`, a type parameter, a union and a callable type
  are compile errors.

## When to use it, and when not

A forwarding object is not faster than a hand-written wrapper function when the
advice is on (they measure the same; both are several times faster than a JS
`Proxy`). What `forward` adds:

- the forwarding code for every member, kept in step with the interface;
- typed `only` lists and per-member `args`/`next` types;
- the advice compiled out entirely when `when` is false.

For a single function, a plain wrapper is fine. For transactions, prefer an
explicit `db.transaction(async (tx) => ...)`: what goes wrong in Spring is
exactly a transaction boundary hidden in a proxy.

## Learn More

- [Specialization](./specialize.md): around-advice written as a typeclass
  instance
- [Conditional Compilation](./conditional-compilation.md): `cfg` conditions
- [Testing](./testing.md): `mock<T>()` for test doubles generated from an
  interface

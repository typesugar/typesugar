---
name: "ParCombine typeclass for par:/yield:"
overview: "Replace hardcoded Promise special-casing in par: with a ParCombine typeclass. AsyncIterable support comes for free as a registered instance."
todos: []
isProject: false
---

# ParCombine Typeclass for `par:/yield:`

## Problem

The `par:` macro currently hardcodes strategy selection:

```typescript
const usePromiseAll = typeConstructorName === "Promise";
const result = usePromiseAll
  ? buildPromiseAll(ctx, steps, returnExpr)
  : buildApplicativeChain(ctx, steps, returnExpr);
```

Adding AsyncIterable support would mean another `else if` branch. This doesn't scale and violates the typeclass principle — behavior for a type should be defined *with the type*, not hardcoded in the macro.

## Design: ParCombine Typeclass

Follow the same pattern as `FlatMap` (used by `let:`): define a typeclass with a registry, register instances for known types, and have the macro look up instances at compile time.

### Interface

```typescript
/**
 * ParCombine typeclass — parallel combination for type constructors.
 *
 * Defines how to combine multiple independent effects of the same
 * type constructor into a single effect containing all results.
 *
 * Used by the par:/yield: macro to generate combination code.
 *
 * @macro-only — Like FlatMap, uses `unknown` because the macro handles
 * type safety at the call site through compile-time code generation.
 */
interface ParCombine<F> {
  /**
   * Combine multiple independent effects into a single effect of an array.
   * e.g., Promise.all for Promise, short-circuit collect for Option.
   */
  all(effects: readonly unknown[]): unknown;

  /**
   * Map/transform the combined result.
   * e.g., .then() for Promise, direct call for synchronous types.
   */
  map(combined: unknown, f: (results: unknown[]) => unknown): unknown;
}
```

### Why `all` + `map` instead of `ap`

The current generic path uses `.map().ap().ap()` chains, which assumes the value type has `map` and `ap` methods. This is fragile — Promise doesn't have `.ap()`, AsyncIterable doesn't have `.map()`, etc.

The `all + map` interface captures what `par:` actually means: "run all these independently, then combine results." Each instance defines *how* to do this for its type:


| Type          | `all`                                       | `map`                      |
| ------------- | ------------------------------------------- | -------------------------- |
| Promise       | `Promise.all(effects)`                      | `.then(f)`                 |
| AsyncIterable | `Promise.all(effects.map(Array.fromAsync))` | `.then(f)`                 |
| Array         | Cartesian product                           | `.map(f)` (on outer array) |
| Option (null) | Collect, short-circuit on null              | null check + call          |
| Iterable      | `Array.from` each, then collect             | Direct call (synchronous)  |


### Instances

```typescript
const parCombinePromise: ParCombine<_PromiseTag> = {
  all: (effects) => Promise.all(effects as Promise<unknown>[]),
  map: (combined, f) => (combined as Promise<unknown[]>).then(f),
};

const parCombineAsyncIterable: ParCombine<_AsyncIterableTag> = {
  all: (effects) =>
    Promise.all((effects as AsyncIterable<unknown>[]).map((e) => Array.fromAsync(e))),
  map: (combined, f) => (combined as Promise<unknown[]>).then(f),
};

const parCombineArray: ParCombine<_ArrayTag> = {
  all: (effects) => {
    // Cartesian product: [[1,2], [3,4]] → [[1,3],[1,4],[2,3],[2,4]]
    return (effects as unknown[][]).reduce<unknown[][]>(
      (acc, arr) => acc.flatMap((combo) => (arr as unknown[]).map((item) => [...combo, item])),
      [[]]
    );
  },
  map: (combined, f) => (combined as unknown[][]).map(f),
};

const parCombineIterable: ParCombine<_IterableTag> = {
  all: (effects) => {
    // Collect each iterable to array, then cartesian product
    const arrays = (effects as Iterable<unknown>[]).map((it) => Array.from(it));
    return arrays.reduce<unknown[][]>(
      (acc, arr) => acc.flatMap((combo) => arr.map((item) => [...combo, item])),
      [[]]
    );
  },
  map: (combined, f) => (combined as unknown[][]).map(f),
};
```

### Registry

```typescript
const parCombineInstances: GenericRegistry<string, ParCombine<unknown>> = createGenericRegistry({
  name: "ParCombineRegistry",
  duplicateStrategy: "replace",
});

parCombineInstances.set("Promise", parCombinePromise as ParCombine<unknown>);
parCombineInstances.set("AsyncIterable", parCombineAsyncIterable as ParCombine<unknown>);
parCombineInstances.set("Array", parCombineArray as ParCombine<unknown>);
parCombineInstances.set("Iterable", parCombineIterable as ParCombine<unknown>);

export function registerParCombine<F>(name: string, instance: ParCombine<F>): void { ... }
export function getParCombine(name: string): ParCombine<unknown> | undefined { ... }
```

### Code Generation

The `par:` macro generates calls through the ParCombine instance:

```typescript
// par: { a << fetchUser(id); b << loadConfig() }
// yield: ({ user: a, config: b })
//
// Generated code:
import { getParCombine } from "@typesugar/std";
const __pc = getParCombine("Promise")!;
__pc.map(
  __pc.all([fetchUser(id), loadConfig()]),
  (([a, b]) => ({ user: a, config: b })) as any
);
```

With specialization, the Promise instance inlines to:

```typescript
Promise.all([fetchUser(id), loadConfig()]).then(([a, b]) => ({ user: a, config: b }));
```

### Fallback for Unregistered Types

If no ParCombine instance exists for a type, the macro falls back to the existing `.map().ap()` applicative chain. This preserves backward compatibility for types that have `.map()` and `.ap()` methods but haven't registered a ParCombine instance.

```typescript
const parCombine = getParCombine(typeConstructorName);
const result = parCombine
  ? buildParCombine(ctx, parCombine, typeConstructorName, steps, returnExpr)
  : buildApplicativeChain(ctx, steps, returnExpr);  // fallback
```

## Implementation

### File Changes


| File                                          | Change                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------- |
| `packages/std/src/typeclasses/par-combine.ts` | **New**: ParCombine typeclass, instances, registry                                    |
| `packages/std/src/typeclasses/index.ts`       | Export par-combine module                                                             |
| `packages/std/src/macros/par-yield.ts`        | Refactor: look up ParCombine, remove hardcoded Promise check, add `buildParCombine()` |
| `packages/std/tests/comprehensions.test.ts`   | Add AsyncIterable par: tests, add ParCombine registry tests                           |
| `docs/guides/do-notation.md`                  | Document ParCombine, AsyncIterable support, custom instance registration              |


### Step-by-step

1. **Create `par-combine.ts`** with the typeclass interface, built-in instances (Promise, AsyncIterable, Array, Iterable), and registry functions (`registerParCombine`, `getParCombine`).
2. **Export from `packages/std/src/typeclasses/index.ts`**.
3. **Refactor `par-yield.ts`**:
  - Import `getParCombine` from the new module
  - Replace the `usePromiseAll` boolean check with a `getParCombine(typeConstructorName)` lookup
  - Add `buildParCombine()` function that generates `__pc.map(__pc.all([...]), ([a,b,c]) => expr)`
  - Keep `buildApplicativeChain()` as fallback for types without a registered ParCombine instance
  - Remove `buildPromiseAll()` (its behavior is now captured by the Promise ParCombine instance)
4. **Add tests**:
  - AsyncIterable par: combination (collect-all-then-combine via `Array.fromAsync`)
  - Iterable par: combination
  - Custom ParCombine registration
  - Single-effect optimization (no `all` needed — just `map`)
5. **Update documentation**: document the ParCombine typeclass, how to register custom instances, and AsyncIterable support.

### Tests

```typescript
describe("par: with ParCombine typeclass", () => {
  describe("AsyncIterable", () => {
    it("should collect and combine async iterables", async () => {
      async function* nums() { yield 1; yield 2; yield 3; }
      async function* strs() { yield "a"; yield "b"; }

      const pc = getParCombine("AsyncIterable")!;
      const result = await (pc.map(
        pc.all([nums(), strs()]),
        (([ns, ss]: [number[], string[]]) => ({ ns, ss })) as any
      ) as Promise<{ ns: number[]; ss: string[] }>);

      expect(result).toEqual({ ns: [1, 2, 3], ss: ["a", "b"] });
    });
  });

  describe("custom registration", () => {
    it("should allow registering custom ParCombine instances", () => {
      registerParCombine("MyEffect", {
        all: (effects) => /* custom combination */,
        map: (combined, f) => /* custom mapping */,
      });
      expect(getParCombine("MyEffect")).toBeDefined();
    });
  });
});
```

## Open Questions

1. **Single-effect optimization** — When there's only one bind step, should we skip `all` and just use `map` directly? e.g., `parCombine.map(fa, (a) => expr)` instead of `parCombine.map(parCombine.all([fa]), ([a]) => expr)`. The current code does this for Promise (`.then()` instead of `Promise.all`). Answer: yes — add a single-effect fast path in the generated code.
2. **Return type shift for AsyncIterable** — `par:` with AsyncIterable returns a `Promise<...>`, not an `AsyncIterable<...>`. This is inherent to the collect-all semantics. Document clearly.
3. **Array semantics** — Should Array `par:` be cartesian product (all combinations) or zip (element-wise)? Cartesian product matches Haskell's Applicative for lists. Zip matches `ZipList`. Current `buildApplicativeChain` does `.map().ap()` which is cartesian product for types that implement it that way. Proposal: cartesian product by default, document the semantics.
4. `**Array.fromAsync` availability** — Stage 4, available in Node 22+ and all modern browsers. The AsyncIterable instance uses it directly. Users on older runtimes would need a polyfill or could register a custom instance with an inline helper.


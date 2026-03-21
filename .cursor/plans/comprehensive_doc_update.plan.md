---
name: ""
overview: ""
todos: []
isProject: false
---

# Comprehensive Documentation Update — Agent Prompt

You are updating documentation for the **typesugar** monorepo after several packages were added or modified without corresponding doc updates. This prompt contains all the context you need to make every change. Execute all steps, then format-check, commit, and push.

## Background

Three packages were recently changed:

1. `**@typesugar/std`** — `Hash<A>` typeclass was added (interface + primitive instances + combinators)
2. `**@typesugar/collections**` — NEW package: collection typeclasses + HashSet + HashMap
3. `**@typesugar/graph**` — `GraphLike<G,N,E>` typeclass and generic algorithm variants (`*G`) were added
4. `**@typesugar/effect**` — Layer resolution now uses `GraphLike` via `topoSortG`; `layerMake<R>(...)` was added

No documentation was updated for any of these changes. The effect README also buries the service/layer system (its primary value prop) below optimization macros.

---

## Step 1: CREATE `packages/collections/README.md`

This file does not exist yet. Create a full README following the style of `packages/math/README.md` and `packages/fp/README.md`.

### What the package exports (from `packages/collections/src/index.ts`)

**Typeclasses** (from `src/typeclasses.ts`):

- `IterableOnce<I, A>` — one-shot fold (non-HKT analog of Foldable). Methods: `fold<B>(i, z, f)`
- `Iterable<I, A> extends IterableOnce` — re-traversable. Methods: `iterator(i)`
- `Seq<S, A> extends Iterable` — ordered, indexed. Methods: `length(s)`, `nth(s, index)`
- `SetLike<S, K> extends Iterable` — read-only set. Methods: `has(s, k)`, `size(s)`
- `MapLike<M, K, V> extends Iterable` — read-only map. Methods: `get(m, k)`, `has(m, k)`, `size(m)`, `keys(m)`, `values(m)`
- `PersistentSetLike<S, K> extends SetLike` — immutable. Methods: `empty`, `add(s, k)`, `remove(s, k)`
- `PersistentMapLike<M, K, V> extends MapLike` — immutable. Methods: `empty`, `set(m, k, v)`, `remove(m, k)`
- `MutableSetLike<S, K> extends SetLike` — mutable. Methods: `create()`, `add(s, k)`, `delete(s, k)`, `clear(s)`
- `MutableMapLike<M, K, V> extends MapLike` — mutable. Methods: `create()`, `set(m, k, v)`, `delete(m, k)`, `clear(m)`

**Data structures**:

- `HashSet<K>` — hash-based set using `Eq<K>` + `Hash<K>`. Constructor: `new HashSet<K>(eq, hash)`. API mirrors native `Set`.
- `HashMap<K, V>` — hash-based map using `Eq<K>` + `Hash<K>`. Constructor: `new HashMap<K, V>(eq, hash)`. API mirrors native `Map`. Extra: `getOrElse(key, fallback)`.

**Instances** (from `src/instances.ts`):

- `arrayIterableOnce`, `arrayIterable`, `arraySeq`, `arraySeqOf<A>()` — Array as Seq
- `nativeSetLike<K>()`, `nativeMutableSetLike<K>()` — native Set
- `nativeMapLike<K,V>()`, `nativeMutableMapLike<K,V>()` — native Map
- `stringIterable`, `stringSeq` — string as Seq
- `hashSetLike<K>(eq, hash)`, `hashMutableSetLike<K>(eq, hash)` — HashSet
- `hashMapLike<K,V>(eq, hash)`, `hashMutableMapLike<K,V>(eq, hash)` — HashMap
- `mutableSetFor<K>(eq, hash)` — auto-derivation entry point for sets
- `mutableMapFor<K,V>(eq, hash)` — auto-derivation entry point for maps

**Derived operations** (from `src/derived.ts`):

- From IterableOnce: `forEach`, `toArray`, `find`, `exists`, `forAll`, `count`, `sum`
- From Seq: `head`, `last`, `take`, `drop`, `sorted` (needs `Ord<A>`), `seqContains` (needs `Eq<A>`)
- From SetLike: `union`, `intersection`, `difference`, `isSubsetOf`
- From MapLike: `getOrElse`, `mapValues`, `filterEntries`, `mapEntries`

### README sections to include

1. **Title/Tagline**: `# @typesugar/collections` / `> Collection typeclasses and hash-based data structures.`
2. **Installation**: `npm install @typesugar/collections`
3. **Quick Start**: Show HashSet with a custom Point key type using Eq + Hash, then derived set operations (union, intersection)
4. **Collection Typeclass Hierarchy**: ASCII or Mermaid diagram:

```
   IterableOnce<I, A>
     └── Iterable<I, A>
           ├── Seq<S, A>
           ├── SetLike<S, K>  → PersistentSetLike / MutableSetLike
           └── MapLike<M, K, V> → PersistentMapLike / MutableMapLike
   

```

1. **HashSet and HashMap**: Show construction, custom keys, collision handling
2. **Instances table**: Which types get which typeclasses

  | Type           | Typeclass                            |
  | -------------- | ------------------------------------ |
  | `Array<A>`     | `Seq<A[], A>`                        |
  | `Set<K>`       | `MutableSetLike<Set<K>, K>`          |
  | `Map<K,V>`     | `MutableMapLike<Map<K,V>, K, V>`     |
  | `HashSet<K>`   | `MutableSetLike<HashSet<K>, K>`      |
  | `HashMap<K,V>` | `MutableMapLike<HashMap<K,V>, K, V>` |
  | `string`       | `Seq<string, string>`                |

3. **Derived Operations**: Table of all free functions with their typeclass source
4. **Auto-Derivation**: Show `mutableSetFor(eq, hash)` and `mutableMapFor(eq, hash)` — given `Eq<K>` + `Hash<K>`, you get a `MutableSetLike` backed by `HashSet`
5. **Zero-Cost Guarantee**: With `specialize()`, `HashSet<string>` compiles to native `Set<string>` performance
6. **Integration**: How collections works with std (Hash, Eq), graph (HashSet/HashMap in generic algorithms), effect (layer graph)
7. **API Quick Reference**: Tables of types, instances, operations
8. **License**: MIT

**Inspired by**: Scala collections, Haskell Data.Set/Data.Map, Rust std::collections

---

## Step 2: UPDATE `packages/effect/README.md`

The current README leads with optimization macros (`@compiled`, `@fused`, `specializeSchema`). The `@service` macro doesn't appear until line 248. **Restructure** to lead with the service/layer system.

### Current structure (lines 1-515)

```
1. Intro: "Make Effect-TS faster at compile time."
2. Zero-Cost Optimizations (lines 58-173): @compiled, @fused, specializeSchema
3. Rich Diagnostics (lines 177-244): EFFECT001, cycles, error completeness, schema drift
4. Service & Layer System (lines 248-368): @service, @layer, layerMake, resolveLayer
5. Testing (lines 371-394)
6. Do-Notation (lines 398-411)
7. Derive Macros (lines 415-436)
8. API Reference (lines 440-497)
9. How It Works (lines 500-509)
10. License
```

### New structure

```
1. Intro — Rewrite: "Zero-boilerplate services, automatic layer wiring, and compile-time optimization for Effect-TS."
2. Service & Layer System — MOVE UP. @service, @layer, layerMake<R>(...), resolveLayer<R>(). Show the debug tree. This is the primary value prop.
3. Rich Diagnostics — Keep as-is.
4. Zero-Cost Optimizations — @compiled, @fused, specializeSchema. Still prominent, just not the lead.
5. Layer Dependency Resolution — NEW subsection: explain that layer-graph.ts defines a `layerGraphLike` (a GraphLike instance for the layer dep graph), uses `topoSortG` from `@typesugar/graph` for resolution, and the debug tree visualization.
6. Testing — Keep as-is.
7. Do-Notation — Keep as-is.
8. Derive Macros — Keep as-is.
9. API Reference — Keep tables. Add `layerMake<R>(...layers)` and `layerGraphLike` exports to the Service & Layer table (they're already there, just confirm).
10. How It Works — Keep as-is.
11. License
```

### Key changes to the intro

Current opening:

> Make Effect-TS faster at compile time. Rich diagnostics. Zero runtime cost.

New opening:

> Zero-boilerplate services, automatic layer wiring, and compile-time optimization for Effect-TS.

The "What You Get" section should show `@service` and `@layer` FIRST (the daily workflow), then `@compiled` as a bonus.

### Actual exports to document (from `packages/effect/src/index.ts`)

Service & Layer:

- `@service` — decorator, generates Context.Tag + accessor namespace
- `@layer(Service, opts?)` — decorator, creates layer with dependency tracking
- `layerMake<R>(...layers)` — ZIO-style explicit wiring
- `resolveLayer<R>(opts?)` — implicit wiring from `@layer` registrations in import scope
- `layerGraphLike` — GraphLike instance for layer dependency graphs (exported from `layer-graph.ts`)
- `formatDebugTree()` — format resolved graph as tree string
- `serviceRegistry`, `layerRegistry`

Optimization:

- `@compiled` / `compileGen()` — eliminate generator overhead
- `@fused` / `fusePipeline()` — pipeline fusion
- `specializeSchema()` / `specializeSchemaUnsafe()` — compile-time validation

Derives: `EffectSchema`, `EffectEqual`, `EffectHash`
Extensions: `EffectExt`, `OptionExt`, `EitherExt`
Testing: `mockService`, `testLayer`, `combineLayers`, `assertCalled`, `assertNotCalled`, `assertCalledTimes`
HKT: `EffectF`, `ChunkF`, etc.
Typeclass instances: `effectFunctor`, `effectApply`, `effectApplicative`, `effectMonad`, `effectMonadError`, `chunkFunctor`, `chunkFoldable`, `chunkTraverse`, etc.

---

## Step 3: UPDATE `packages/graph/README.md`

Add new sections **after** the existing "State Machine DSL" content (line 196) and **before** "Zero-Cost Guarantee" (line 198).

### New sections to add

#### GraphLike Typeclass

Explain the abstraction. The interface (from `packages/graph/src/typeclass.ts`):

```typescript
interface GraphLike<G, N, E> {
  nodes(g: G): Iterable<N>;
  edges(g: G): Iterable<E>;
  successors(g: G, node: N): Iterable<N>;
  edgeSource(e: E): N;
  edgeTarget(e: E): N;
  isDirected(g: G): boolean;
}

interface WeightedGraphLike<G, N, E, W> extends GraphLike<G, N, E> {
  edgeWeight(e: E): W;
}
```

#### Node Identity via Eq + Hash

Haskell/Scala-style design: `N` can be any type. Node identity comes from `Eq<N>` + `Hash<N>` constraints **on the algorithm functions**, not baked into the typeclass. This lets you use `number`, `string`, custom structs — anything with `Eq` + `Hash`.

#### Generic Algorithms

All `*G` variants (from `packages/graph/src/generic-algorithms.ts`):


| Algorithm       | Generic Function                                         | Signature sketch                     |
| --------------- | -------------------------------------------------------- | ------------------------------------ |
| Topo sort       | `topoSortG(g, GL, eq, hash)`                             | `→ {ok, order} | {ok: false, cycle}` |
| Cycle detection | `hasCyclesG(g, GL, eq, hash)`                            | `→ boolean`                          |
| BFS             | `bfsG(g, start, GL, eq, hash)`                           | `→ N[]`                              |
| DFS             | `dfsG(g, start, GL, eq, hash)`                           | `→ N[]`                              |
| Reachability    | `reachableG(g, start, GL, eq, hash)`                     | `→ HashSet<N>`                       |
| Has path        | `hasPathG(g, from, to, GL, eq, hash)`                    | `→ boolean`                          |
| Shortest path   | `shortestPathG(g, from, to, GL, eq, hash)`               | `→ N[] | null`                       |
| Dijkstra        | `dijkstraWithG(g, from, to, WGL, eq, hash, monoid, ord)` | `→ {path, weight} | null`            |
| SCC             | `sccG(g, GL, eq, hash)`                                  | `→ N[][]`                            |


#### Custom Graph Example

Show a custom `AdjGraph<number>` with a `GraphLike` instance and running algorithms on it (this exists in the tests — `packages/graph/tests/typeclass.test.ts`).

#### Concrete Instances

- `graphLike: GraphLike<Graph, string, GraphEdge>` — for the built-in `Graph` type
- `weightedGraphLike: WeightedGraphLike<Graph, string, GraphEdge, number>`

#### Backward Compatibility

Existing functions (`topoSort`, `bfs`, `dijkstra`, etc.) are unchanged — they now delegate to the `*G` variants internally but have the same API.

### Also update

- The **Algorithms table** (lines 123-135): add a note or new section for generic variants
- The **API reference** would benefit from listing GraphLike exports

---

## Step 4: UPDATE `packages/std/README.md`

### What to add

The `Hash<A>` typeclass was added to `packages/std/src/typeclasses/index.ts`. The current README lists typeclasses only under "API Reference > Typeclasses" (line 222-228) which mentions `FlatMap<F>` only.

Add a **Hash** section (either as part of a new "Standard Typeclasses" section or alongside FlatMap). Content:

```typescript
interface Hash<A> {
  hash(a: A): number;
}
```

Primitive instances: `hashNumber`, `hashString`, `hashBoolean`, `hashBigInt`, `hashDate`

Combinators: `makeHash(fn)`, `hashBy(f, H)`, `hashArray(H)`

Law: `Eq.equals(a, b) => Hash.hash(a) === Hash.hash(b)`

Mention that Hash enables `@typesugar/collections` (HashSet, HashMap).

### Current API Reference section (lines 222-228)

```markdown
### Typeclasses

- `FlatMap<F>` — Sequencing for type constructors (map, flatMap)
- `flatMapArray`, `flatMapPromise`, `flatMapIterable`, `flatMapAsyncIterable` — Built-in instances
- `registerFlatMap(name, instance)` — Register a custom FlatMap instance
- `getFlatMap(name)` — Look up a FlatMap instance by name
```

Update this to include Hash and mention the other standard typeclasses (Eq, Ord, Show, Semigroup, Monoid) which are also exported from std but not listed in the README.

---

## Step 5: UPDATE Root `README.md`

### Add `@typesugar/collections` to the Data Structures & Algorithms table

Current table (lines 91-104):

```markdown
| [@typesugar/fp](packages/fp)             | Option, Either, IO, Result, List                |
| [@typesugar/hlist](packages/hlist)       | Heterogeneous lists (Boost.Fusion)              |
...
| [@typesugar/symbolic](packages/symbolic) | Symbolic math, calculus, simplification         |
```

Add a row for collections. Also update the graph description to mention GraphLike:

```markdown
| [@typesugar/collections](packages/collections) | Collection typeclasses, HashSet, HashMap        |
| [@typesugar/graph](packages/graph)       | GraphLike typeclass, algorithms, state machines |
```

### Update the effect description in the Ecosystem Integrations table (line 110)

Current: `| [@typesugar/effect](packages/effect) | Effect-TS adapter |`

Update to: `| [@typesugar/effect](packages/effect) | Effect-TS services, layers, optimization |`

---

## Step 6: UPDATE `AGENTS.md`

### Architecture tree (lines 115-130)

Add `collections/` to the "Data Structures & Algorithms" section. Currently:

```
├── fp/                 # @typesugar/fp — ...
├── hlist/              # @typesugar/hlist — ...
...
├── graph/              # @typesugar/graph — graph algorithms, state machines (Boost.Graph)
```

Add after graph (or in alphabetical position):

```
├── collections/        # @typesugar/collections — collection typeclasses, HashSet, HashMap
```

Update the graph line:

```
├── graph/              # @typesugar/graph — GraphLike typeclass, graph algorithms, state machines (Boost.Graph)
```

Update the effect line (line 128):

```
├── effect/             # @typesugar/effect — Effect TS integration (@service, @layer, layerMake, resolveLayer, derives)
```

### Package Boundaries table (lines 942-953)

Update these rows:

1. `@typesugar/std` — add Hash: `Standard typeclasses (Eq, Ord, Show, Hash, Semigroup, FlatMap), built-in type extensions, ...`
2. `@typesugar/collections` — update: `Collection typeclass hierarchy (IterableOnce, Iterable, Seq, MapLike, SetLike), HashSet<K>, HashMap<K,V>` | `Typeclass definitions (those live in std)`
3. `@typesugar/graph` — update: `GraphLike<G,N,E> typeclass, graph construction/algorithms (topo sort, SCC, Dijkstra), state machine definition/verification` | `Visual rendering`

---

## Step 7: UPDATE `docs/guides/index.md`

### Data Structures & Algorithms section (lines 51-66)

Add a row for Collections:

```markdown
| [Collections](./collections.md)   | Typeclasses for collections, HashSet, HashMap |
```

Update the graph guide description:

```markdown
| [Graph Algorithms](./graph.md)    | GraphLike typeclass, BFS, DFS, Dijkstra, state machines |
```

### Standard Library section (lines 7-14)

Update the Standard Typeclasses description:

```markdown
| [Standard Typeclasses](./std-typeclasses.md) | Eq, Ord, Hash, Show, Monoid, FlatMap |
```

---

## Step 8: UPDATE `docs/reference/packages.md`

### Add new section for @typesugar/collections

Insert after `@typesugar/codec` (line 672) in the "Data Structures & Algorithms" section:

```markdown
### @typesugar/collections {#collections}

Collection typeclasses and hash-based data structures.

npm install @typesugar/collections

**Exports:**

// Typeclasses
IterableOnce, Iterable, Seq, SetLike, MapLike
PersistentSetLike, PersistentMapLike, MutableSetLike, MutableMapLike

// Data structures
HashSet, HashMap

// Instances
arraySeq, arraySeqOf, nativeSetLike, nativeMutableSetLike
nativeMapLike, nativeMutableMapLike, stringSeq
hashSetLike, hashMutableSetLike, hashMapLike, hashMutableMapLike
mutableSetFor, mutableMapFor

// Derived operations
forEach, toArray, find, exists, forAll, count, sum
head, last, take, drop, sorted, seqContains
union, intersection, difference, isSubsetOf
getOrElse, mapValues, filterEntries, mapEntries

**Inspired by:** Scala collections, Haskell Data.Set/Data.Map, Rust std::collections
```

### Update @typesugar/std section (lines 219-248)

Add Hash to the exports list. Currently lists: `(Eq, Ord, Show, Semigroup, Monoid)`. Update to: `(Eq, Ord, Show, Hash, Semigroup, Monoid)`. Also add `hashString, hashNumber, hashBoolean, hashBigInt, hashDate, makeHash, hashBy, hashArray`.

### Update @typesugar/graph section (lines 611-631)

Add to exports:

```
// Typeclass
GraphLike, WeightedGraphLike, graphLike, weightedGraphLike

// Generic algorithms
topoSortG, hasCyclesG, bfsG, dfsG, reachableG, hasPathG, shortestPathG, dijkstraWithG, sccG
```

### Update @typesugar/effect section (lines 756-777)

Add to exports:

```
layerMake();
layerGraphLike;       // GraphLike instance for layer dependency graphs
formatDebugTree();
```

Reorder the exports list to put `service()`, `layer()`, `layerMake()`, `resolveLayer()` first (before `compiled()`, `fused()`, etc.).

---

## Step 9: Format check

Run `pnpm format` (or `pnpm prettier --write`) on all modified/created files. Then verify with `pnpm format:check`.

---

## Step 10: Commit and push

Commit message: `docs: comprehensive documentation update for collections, graph, effect, and std`

Stage only documentation files. Push to remote.

---

## Voice guidelines

- Write like a friendly open-source maintainer, not a corporate tech writer
- Be direct: "Here's how to..." not "The following section describes..."
- Keep it concise — developers skim docs
- Include working, copy-pasteable examples
- SHOW, don't tell: instead of "rich error messages", show the actual error output
- No marketing speak: no "powerful", "seamless", "enterprise-grade"
- Every TypeScript code block must be syntactically valid and match real API signatures
- Follow the style of existing READMEs (especially `packages/math/README.md` and `packages/fp/README.md`)


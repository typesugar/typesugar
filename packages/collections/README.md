# @typesugar/collections

> Collection typeclasses and hash-based data structures.

## Installation

```bash
pnpm add @typesugar/collections
```

## Quick Start

`HashSet` and `HashMap` use `Eq<K>` + `Hash<K>` for key identity. The compiler auto-derives these from your type's fields and fills them in implicitly — you just write the code you'd expect:

```typescript
import { HashSet, union, intersection, type Eq, type Hash } from "@typesugar/collections";

interface Point {
  x: number;
  y: number;
}

// Eq<Point> and Hash<Point> are auto-derived and implicitly resolved
const a = new HashSet<Point>();
a.add({ x: 1, y: 2 }).add({ x: 2, y: 3 });

const b = new HashSet<Point>();
b.add({ x: 2, y: 3 }).add({ x: 3, y: 4 });

const u = union(a, b); // {1,2}, {2,3}, {3,4}
const i = intersection(a, b); // {2,3}
```

Under the hood, the compiler sees the `Eq<K>` and `Hash<K>` parameters on `HashSet`'s constructor and `union`'s signature, auto-derives instances from `Point`'s fields, and fills them in — then specializes everything to direct field comparisons. Zero boilerplate, zero runtime cost.

---

## Collection Typeclass Hierarchy

```text
IterableOnce<I, A>
  └── Iterable<I, A>
        ├── Seq<S, A>
        ├── SetLike<S, K>  → PersistentSetLike / MutableSetLike
        └── MapLike<M, K, V> → PersistentMapLike / MutableMapLike
```

- **IterableOnce** — one-shot fold (non-HKT analog of Foldable). Methods: `fold(i, z, f)`
- **Iterable** — re-traversable. Methods: `iterator(i)`
- **Seq** — ordered, indexed. Methods: `length(s)`, `nth(s, index)`
- **SetLike** — read-only set. Methods: `has(s, k)`, `size(s)`
- **MapLike** — read-only map. Methods: `get(m, k)`, `has(m, k)`, `size(m)`, `keys(m)`, `values(m)`
- **PersistentSetLike / PersistentMapLike** — immutable (`empty`, `add`/`set`, `remove`)
- **MutableSetLike / MutableMapLike** — mutable (`create()`, `add`/`set`, `delete`, `clear`)

---

## HashSet and HashMap

Native `Set`/`Map` use reference equality for objects — `HashSet`/`HashMap` use structural equality via the `Eq` and `Hash` typeclasses. The compiler resolves these implicitly, so usage looks like native collections:

```typescript
import { HashSet, HashMap, type Eq, type Hash } from "@typesugar/collections";

// Primitives
const nums = new HashSet<number>();
nums.add(1).add(2).add(1);
nums.size; // 2

const map = new HashMap<string, number>();
map.set("a", 1).set("b", 2);
map.get("a"); // 1
map.getOrElse("c", 0); // 0 (key missing → fallback)

// Custom types — Eq + Hash auto-derived from fields
interface UserId {
  org: string;
  id: number;
}
const users = new HashSet<UserId>();
users.add({ org: "acme", id: 1 });
users.add({ org: "acme", id: 1 }); // duplicate, not added
users.size; // 1
```

**Custom instances** — if you need non-default behavior (e.g., case-insensitive keys), provide an explicit `@instance` to override auto-derivation:

```typescript
import { type Eq, type Hash, makeEq, makeHash, hashString } from "@typesugar/std";

@instance const ciEq: Eq<string> = makeEq(
  (a, b) => a.toLowerCase() === b.toLowerCase()
);
@instance const ciHash: Hash<string> = makeHash(
  (s) => hashString.hash(s.toLowerCase())
);

// Now HashSet<string> uses case-insensitive comparison
const tags = new HashSet<string>();
tags.add("TypeScript");
tags.add("typescript"); // duplicate under ciEq, not added
tags.size; // 1
```

---

## Instances

| Type           | Typeclass                            |
| -------------- | ------------------------------------ |
| `Array<A>`     | `Seq<A[], A>`                        |
| `Set<K>`       | `MutableSetLike<Set<K>, K>`          |
| `Map<K,V>`     | `MutableMapLike<Map<K,V>, K, V>`     |
| `HashSet<K>`   | `MutableSetLike<HashSet<K>, K>`      |
| `HashMap<K,V>` | `MutableMapLike<HashMap<K,V>, K, V>` |
| `string`       | `Seq<string, string>`                |

Instance factories: `arraySeqOf<A>()`, `nativeMutableSetLike<K>()`, `nativeMutableMapLike<K,V>()`, `hashMutableSetLike<K>()`, `hashMutableMapLike<K,V>()`.

---

## Derived Operations

Free functions built on the typeclass interfaces. Typeclass instance parameters are resolved implicitly by the compiler.

| Operation       | From         | What you write         |
| --------------- | ------------ | ---------------------- |
| `forEach`       | IterableOnce | `forEach(items, f)`    |
| `toArray`       | IterableOnce | `toArray(items)`       |
| `find`          | IterableOnce | `find(items, pred)`    |
| `exists`        | IterableOnce | `exists(items, pred)`  |
| `forAll`        | IterableOnce | `forAll(items, pred)`  |
| `count`         | IterableOnce | `count(items)`         |
| `sum`           | IterableOnce | `sum(nums)`            |
| `head`          | Seq          | `head(seq)`            |
| `last`          | Seq          | `last(seq)`            |
| `take`          | Seq          | `take(seq, n)`         |
| `drop`          | Seq          | `drop(seq, n)`         |
| `sorted`        | Seq          | `sorted(seq)`          |
| `seqContains`   | Seq          | `seqContains(seq, x)`  |
| `union`         | SetLike      | `union(a, b)`          |
| `intersection`  | SetLike      | `intersection(a, b)`   |
| `difference`    | SetLike      | `difference(a, b)`     |
| `isSubsetOf`    | SetLike      | `isSubsetOf(a, b)`     |
| `getOrElse`     | MapLike      | `getOrElse(m, k, def)` |
| `mapValues`     | MapLike      | `mapValues(m, f)`      |
| `filterEntries` | MapLike      | `filterEntries(m, p)`  |
| `mapEntries`    | MapLike      | `mapEntries(m)`        |

The actual function signatures include typeclass instance parameters (e.g., `union(a, b, SL, MSL)`) — the compiler fills these in from the types of `a` and `b`.

---

## Auto-Derivation

`Eq` and `Hash` are auto-derived for any struct whose fields have instances (all primitives do). This means:

- `HashSet<Point>` just works — no annotations needed
- `HashMap<UserId, Account>` just works
- Nested types work too: if `Address` has `Eq` + `Hash`, then a struct containing `Address` gets them automatically

For generic code where `K` isn't concrete yet, `mutableSetFor` and `mutableMapFor` give you a `MutableSetLike`/`MutableMapLike` backed by `HashSet`/`HashMap`:

```typescript
import { mutableSetFor, type Eq, type Hash } from "@typesugar/collections";

@implicits
function dedup<K>(items: K[], eq: Eq<K>, hash: Hash<K>): K[] {
  const setInstance = mutableSetFor(eq, hash);
  const seen = setInstance.create();
  return items.filter((k) => {
    if (setInstance.has(seen, k)) return false;
    setInstance.add(seen, k);
    return true;
  });
}

// At call sites, eq and hash are filled in automatically:
const unique = dedup([{ x: 1, y: 2 }, { x: 1, y: 2 }, { x: 3, y: 4 }]);
// → [{ x: 1, y: 2 }, { x: 3, y: 4 }]
```

---

## Zero-Cost Guarantee

With `specialize()`, `HashSet<string>` compiles to the equivalent of native `Set<string>` — no wrapper overhead, direct method calls. For custom keys, the only cost is the `Eq`/`Hash` logic for your fields; the collection infrastructure itself inlines away.

---

## Integration

- **@typesugar/std** — `Eq`, `Hash`, `Ord` are auto-derived from type structure. Explicit instances (`makeEq`, `makeHash`) are only needed for custom behavior.
- **@typesugar/graph** — Generic algorithms (`topoSortG`, `dijkstraWithG`, `sccG`) use `HashSet` and `HashMap` internally for visited sets and distance maps.
- **@typesugar/effect** — Layer dependency resolution uses `HashMap` internally for the layer graph.

---

## API Quick Reference

### Types

| Type                      | Description      |
| ------------------------- | ---------------- |
| `IterableOnce<I, A>`      | One-shot fold    |
| `Iterable<I, A>`          | Re-traversable   |
| `Seq<S, A>`               | Ordered, indexed |
| `SetLike<S, K>`           | Read-only set    |
| `MapLike<M, K, V>`        | Read-only map    |
| `MutableSetLike<S, K>`    | Mutable set      |
| `MutableMapLike<M, K, V>` | Mutable map      |

### Data Structures

| Type           | Constructor          | Notes                                               |
| -------------- | -------------------- | --------------------------------------------------- |
| `HashSet<K>`   | `new HashSet<K>()`   | API mirrors native `Set`. Eq/Hash auto-resolved.    |
| `HashMap<K,V>` | `new HashMap<K,V>()` | API mirrors native `Map`. `getOrElse(k, fallback)`. |

### Instance Factories

For generic code where you need to pass instances explicitly:

| Factory                       | Produces                             |
| ----------------------------- | ------------------------------------ |
| `arraySeqOf<A>()`             | `Seq<A[], A>`                        |
| `nativeSetLike<K>()`          | `SetLike<Set<K>, K>`                 |
| `nativeMutableSetLike<K>()`   | `MutableSetLike<Set<K>, K>`          |
| `nativeMapLike<K,V>()`        | `MapLike<Map<K,V>, K, V>`            |
| `nativeMutableMapLike<K,V>()` | `MutableMapLike<Map<K,V>, K, V>`     |
| `hashSetLike<K>()`            | `SetLike<HashSet<K>, K>`             |
| `hashMutableSetLike<K>()`     | `MutableSetLike<HashSet<K>, K>`      |
| `hashMapLike<K,V>()`          | `MapLike<HashMap<K,V>, K, V>`        |
| `hashMutableMapLike<K,V>()`   | `MutableMapLike<HashMap<K,V>, K, V>` |
| `mutableSetFor<K>()`          | `MutableSetLike<HashSet<K>, K>`      |
| `mutableMapFor<K,V>()`        | `MutableMapLike<HashMap<K,V>, K, V>` |

**Inspired by:** Scala collections, Haskell Data.Set/Data.Map, Rust std::collections

## License

MIT

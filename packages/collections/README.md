# @typesugar/collections

> 📖 **Full documentation:** [Package reference](https://typesugar.org/reference/packages). The microsite is the canonical reference; this README is a quickstart.

> Status: experimental — API may change before 1.0.

> Collection typeclasses and hash-based data structures.

## Installation

```bash
pnpm add @typesugar/collections @typesugar/std
```

## Quick Start

`HashSet` and `HashMap` use `Eq<K>` + `Hash<K>` for key identity. You pass both instances
to the constructor; for primitives, `@typesugar/std` exports them (`eqNumber`/`hashNumber`,
`eqString`/`hashString`, ...), and `makeEq`/`makeHash` build them for your own types:

```typescript
import {
  HashSet,
  union,
  intersection,
  hashSetLike,
  hashMutableSetLike,
} from "@typesugar/collections";
import { makeEq, makeHash } from "@typesugar/std";

interface Point {
  x: number;
  y: number;
}

const eqPoint = makeEq<Point>((a, b) => a.x === b.x && a.y === b.y);
const hashPoint = makeHash<Point>((p) => p.x * 31 + p.y);

const a = new HashSet<Point>(eqPoint, hashPoint);
a.add({ x: 1, y: 2 }).add({ x: 2, y: 3 });

const b = new HashSet<Point>(eqPoint, hashPoint);
b.add({ x: 2, y: 3 }).add({ x: 3, y: 4 });

// Set operations take the SetLike / MutableSetLike instances explicitly
const SL = hashSetLike(eqPoint, hashPoint);
const MSL = hashMutableSetLike(eqPoint, hashPoint);
const u = union(a, b, SL, MSL); // {1,2}, {2,3}, {3,4}  (size 3)
const i = intersection(a, b, SL, MSL); // {2,3}
```

Instances are not derived or filled in for you: the constructors and the derived
operations take them as ordinary required parameters.

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

Native `Set`/`Map` use reference equality for objects — `HashSet`/`HashMap` use structural equality via the `Eq` and `Hash` typeclasses you pass in:

```typescript
import { HashSet, HashMap } from "@typesugar/collections";
import { eqNumber, hashNumber, eqString, hashString, makeEq, makeHash } from "@typesugar/std";

// Primitives
const nums = new HashSet<number>(eqNumber, hashNumber);
nums.add(1).add(2).add(1);
nums.size; // 2

const map = new HashMap<string, number>(eqString, hashString);
map.set("a", 1).set("b", 2);
map.get("a"); // 1
map.getOrElse("c", 0); // 0 (key missing → fallback)

// Custom types
interface UserId {
  org: string;
  id: number;
}
const eqUserId = makeEq<UserId>((a, b) => a.org === b.org && a.id === b.id);
const hashUserId = makeHash<UserId>((u) => hashString.hash(u.org) * 31 + u.id);

const users = new HashSet<UserId>(eqUserId, hashUserId);
users.add({ org: "acme", id: 1 });
users.add({ org: "acme", id: 1 }); // duplicate, not added
users.size; // 1
```

**Custom behaviour** — non-default equality (e.g., case-insensitive keys) is just a different pair of instances:

```typescript
import { makeEq, hashBy, hashString } from "@typesugar/std";

const ciEq = makeEq<string>((a, b) => a.toLowerCase() === b.toLowerCase());
const ciHash = hashBy((s: string) => s.toLowerCase(), hashString);

const tags = new HashSet<string>(ciEq, ciHash);
tags.add("TypeScript");
tags.add("typescript"); // duplicate under ciEq, not added
tags.size; // 1
```

Keep the law in mind: values that are equal under `Eq` must have the same `Hash`.

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

Instance factories: `arraySeqOf<A>()`, `nativeMutableSetLike<K>()`, `nativeMutableMapLike<K,V>()`, `hashMutableSetLike(eq, hash)`, `hashMutableMapLike(eq, hash)`.

---

## Derived Operations

Free functions built on the typeclass interfaces. Each takes its typeclass instances as trailing parameters.

| Operation       | From         | Signature                      |
| --------------- | ------------ | ------------------------------ |
| `forEach`       | IterableOnce | `forEach(items, f, IO)`        |
| `toArray`       | IterableOnce | `toArray(items, IO)`           |
| `find`          | IterableOnce | `find(items, pred, IO)`        |
| `exists`        | IterableOnce | `exists(items, pred, IO)`      |
| `forAll`        | IterableOnce | `forAll(items, pred, IO)`      |
| `count`         | IterableOnce | `count(items, IO)`             |
| `sum`           | IterableOnce | `sum(nums, IO)`                |
| `head`          | Seq          | `head(seq, SQ)`                |
| `last`          | Seq          | `last(seq, SQ)`                |
| `take`          | Seq          | `take(seq, n, SQ)`             |
| `drop`          | Seq          | `drop(seq, n, SQ)`             |
| `sorted`        | Seq          | `sorted(seq, SQ, ord)`         |
| `seqContains`   | Seq          | `seqContains(seq, x, SQ, eq)`  |
| `union`         | SetLike      | `union(a, b, SL, MSL)`         |
| `intersection`  | SetLike      | `intersection(a, b, SL, MSL)`  |
| `difference`    | SetLike      | `difference(a, b, SL, MSL)`    |
| `isSubsetOf`    | SetLike      | `isSubsetOf(a, b, SL)`         |
| `getOrElse`     | MapLike      | `getOrElse(m, k, def, ML)`     |
| `mapValues`     | MapLike      | `mapValues(m, f, ML, MML)`     |
| `filterEntries` | MapLike      | `filterEntries(m, p, ML, MML)` |
| `mapEntries`    | MapLike      | `mapEntries(m, ML)`            |

---

## Generic Code

For generic code, take the instances as parameters and build a `MutableSetLike`/`MutableMapLike` backed by `HashSet`/`HashMap` with `mutableSetFor` and `mutableMapFor`:

```typescript
import { mutableSetFor, type Eq, type Hash } from "@typesugar/collections";

function dedup<K>(items: K[], eq: Eq<K>, hash: Hash<K>): K[] {
  const setInstance = mutableSetFor(eq, hash);
  const seen = setInstance.create();
  return items.filter((k) => {
    if (setInstance.has(seen, k)) return false;
    setInstance.add(seen, k);
    return true;
  });
}

const unique = dedup(
  [
    { x: 1, y: 2 },
    { x: 1, y: 2 },
    { x: 3, y: 4 },
  ],
  eqPoint,
  hashPoint
);
// → [{ x: 1, y: 2 }, { x: 3, y: 4 }]
```

---

## Integration

- **@typesugar/std** — provides `Eq`, `Hash` and `Ord`, the primitive instances (`eqNumber`, `hashString`, ...) and the builders `makeEq`, `makeHash`, `hashBy`.
- **@typesugar/graph** — Generic algorithms (`topoSortG`, `dijkstraWithG`, `sccG`) use `HashSet` and `HashMap` internally for visited sets and distance maps.

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

| Type           | Constructor                  | Notes                                               |
| -------------- | ---------------------------- | --------------------------------------------------- |
| `HashSet<K>`   | `new HashSet<K>(eq, hash)`   | API mirrors native `Set`.                           |
| `HashMap<K,V>` | `new HashMap<K,V>(eq, hash)` | API mirrors native `Map`. `getOrElse(k, fallback)`. |

### Instance Factories

Instances for the typeclass-based derived operations:

| Factory                        | Produces                             |
| ------------------------------ | ------------------------------------ |
| `arraySeqOf<A>()`              | `Seq<A[], A>`                        |
| `nativeSetLike<K>()`           | `SetLike<Set<K>, K>`                 |
| `nativeMutableSetLike<K>()`    | `MutableSetLike<Set<K>, K>`          |
| `nativeMapLike<K,V>()`         | `MapLike<Map<K,V>, K, V>`            |
| `nativeMutableMapLike<K,V>()`  | `MutableMapLike<Map<K,V>, K, V>`     |
| `hashSetLike(eq, hash)`        | `SetLike<HashSet<K>, K>`             |
| `hashMutableSetLike(eq, hash)` | `MutableSetLike<HashSet<K>, K>`      |
| `hashMapLike(eq, hash)`        | `MapLike<HashMap<K,V>, K, V>`        |
| `hashMutableMapLike(eq, hash)` | `MutableMapLike<HashMap<K,V>, K, V>` |
| `mutableSetFor(eq, hash)`      | `MutableSetLike<HashSet<K>, K>`      |
| `mutableMapFor(eq, hash)`      | `MutableMapLike<HashMap<K,V>, K, V>` |

**Inspired by:** Scala collections, Haskell Data.Set/Data.Map, Rust std::collections

## License

MIT

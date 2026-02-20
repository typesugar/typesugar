import type { MapLike } from "../typeclasses/map-like.js";
import type { Builder } from "../typeclasses/growable.js";
import type { MapF } from "../hkt.js";

export function mapMapLike<K>(): MapLike<MapF<K>, K> {
  return {
    iterator: <V>(fa: Map<K, V>) => fa.values(),
    foldLeft: <V, B>(fa: Map<K, V>, z: B, f: (b: B, a: V) => B) => {
      let acc = z;
      for (const v of fa.values()) acc = f(acc, v);
      return acc;
    },
    get: <V>(fa: Map<K, V>, key: K) => fa.get(key),
    has: <V>(fa: Map<K, V>, key: K) => fa.has(key),
    keys: <V>(fa: Map<K, V>) => fa.keys(),
    values: <V>(fa: Map<K, V>) => fa.values(),
    size: <V>(fa: Map<K, V>) => fa.size,
    updated: <V>(fa: Map<K, V>, key: K, value: V) =>
      new Map(fa).set(key, value),
    removed: <V>(fa: Map<K, V>, key: K) => {
      const r = new Map(fa);
      r.delete(key);
      return r;
    },
    fromEntries: <V>(entries: globalThis.Iterable<[K, V]>) => new Map(entries),
    empty: <V>() => new Map<K, V>(),
  };
}

export const stringMapMapLike: MapLike<
  MapF<string>,
  string
> = mapMapLike<string>();
export const numberMapMapLike: MapLike<
  MapF<number>,
  number
> = mapMapLike<number>();

/**
 * Map cannot soundly implement `Growable<MapF<K>>` because `Growable` assumes
 * the builder accumulates elements of type `A` to produce `F<A>`, but Map's
 * element type for building is `[K, V]` (entries), not `V` (the HKT parameter).
 *
 * Instead, use `mapBuilder` directly when you need to build a Map.
 */
export function mapBuilder<K, V>(): Builder<[K, V], Map<K, V>> {
  const m = new Map<K, V>();
  return {
    addOne: (entry: [K, V]) => {
      m.set(entry[0], entry[1]);
    },
    result: () => m,
  };
}

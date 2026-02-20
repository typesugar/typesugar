import type { MapLike } from "../typeclasses/map-like.js";
import type { RecordF } from "../hkt.js";

export const recordMapLike: MapLike<RecordF, string> = {
  iterator: <V>(fa: Record<string, V>) =>
    (Object.values(fa) as V[])[Symbol.iterator](),
  foldLeft: <V, B>(fa: Record<string, V>, z: B, f: (b: B, a: V) => B) =>
    Object.values(fa).reduce(f, z),
  get: <V>(fa: Record<string, V>, key: string) => fa[key],
  has: <V>(fa: Record<string, V>, key: string) => key in fa,
  keys: <V>(fa: Record<string, V>) =>
    (Object.keys(fa) as string[])[Symbol.iterator](),
  values: <V>(fa: Record<string, V>) =>
    (Object.values(fa) as V[])[Symbol.iterator](),
  size: <V>(fa: Record<string, V>) => Object.keys(fa).length,
  updated: <V>(fa: Record<string, V>, key: string, value: V) => ({
    ...fa,
    [key]: value,
  }),
  removed: <V>(fa: Record<string, V>, key: string) => {
    const { [key]: _, ...rest } = fa;
    return rest as Record<string, V>;
  },
  fromEntries: <V>(entries: globalThis.Iterable<[string, V]>) =>
    Object.fromEntries(entries) as Record<string, V>,
  empty: <V>() => ({}) as Record<string, V>,
};

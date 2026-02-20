import type { $ } from "../hkt.js";
import type { IterableOnce } from "./iterable-once.js";

export interface MapLike<F, K> extends IterableOnce<F> {
  readonly get: <V>(fa: F<V>, key: K) => V | undefined;
  readonly has: <V>(fa: F<V>, key: K) => boolean;
  readonly keys: <V>(fa: F<V>) => IterableIterator<K>;
  readonly values: <V>(fa: F<V>) => IterableIterator<V>;
  readonly size: <V>(fa: F<V>) => number;
  readonly updated: <V>(fa: F<V>, key: K, value: V) => F<V>;
  readonly removed: <V>(fa: F<V>, key: K) => F<V>;
  readonly fromEntries: <V>(entries: globalThis.Iterable<[K, V]>) => F<V>;
  readonly empty: <V>() => F<V>;
}

export function getOrElse<F, K>(
  F: MapLike<F, K>,
): <V>(fa: $<F, V>, key: K, fallback: () => V) => V {
  return <V>(fa: $<F, V>, key: K, fallback: () => V): V =>
    F.has(fa, key) ? F.get(fa, key)! : fallback();
}

export function mapValues<F, K>(
  F: MapLike<F, K>,
): <V, W>(fa: $<F, V>, f: (v: V) => W) => $<F, W> {
  return <V, W>(fa: $<F, V>, f: (v: V) => W): $<F, W> => {
    const entries: [K, W][] = [];
    for (const k of F.keys(fa)) {
      entries.push([k, f(F.get(fa, k)!)]);
    }
    return F.fromEntries(entries);
  };
}

export function filterKeys<F, K>(
  F: MapLike<F, K>,
): <V>(fa: $<F, V>, p: (k: K) => boolean) => $<F, V> {
  return <V>(fa: $<F, V>, p: (k: K) => boolean): $<F, V> => {
    const entries: [K, V][] = [];
    for (const k of F.keys(fa)) {
      if (p(k)) entries.push([k, F.get(fa, k)!]);
    }
    return F.fromEntries(entries);
  };
}

export function filterValues<F, K>(
  F: MapLike<F, K>,
): <V>(fa: $<F, V>, p: (v: V) => boolean) => $<F, V> {
  return <V>(fa: $<F, V>, p: (v: V) => boolean): $<F, V> => {
    const entries: [K, V][] = [];
    for (const k of F.keys(fa)) {
      const v = F.get(fa, k)!;
      if (p(v)) entries.push([k, v]);
    }
    return F.fromEntries(entries);
  };
}

export function merge<F, K>(
  F: MapLike<F, K>,
): <V>(fa: $<F, V>, fb: $<F, V>, resolve?: (a: V, b: V) => V) => $<F, V> {
  return <V>(
    fa: $<F, V>,
    fb: $<F, V>,
    resolve: (a: V, b: V) => V = (_a, b) => b,
  ): $<F, V> => {
    let result = fa;
    for (const k of F.keys(fb)) {
      const vb = F.get(fb, k)!;
      result = F.updated(
        result,
        k,
        F.has(result, k) ? resolve(F.get(result, k)!, vb) : vb,
      );
    }
    return result;
  };
}

export function foldEntries<F, K>(
  F: MapLike<F, K>,
): <V, B>(fa: $<F, V>, z: B, f: (b: B, k: K, v: V) => B) => B {
  return <V, B>(fa: $<F, V>, z: B, f: (b: B, k: K, v: V) => B): B => {
    let acc = z;
    for (const k of F.keys(fa)) {
      acc = f(acc, k, F.get(fa, k)!);
    }
    return acc;
  };
}

export function invert<F, K>(
  F: MapLike<F, K>,
): <V extends string | number | symbol>(fa: $<F, V>) => Map<V, K[]> {
  return <V extends string | number | symbol>(fa: $<F, V>): Map<V, K[]> => {
    const result = new Map<V, K[]>();
    for (const k of F.keys(fa)) {
      const v = F.get(fa, k)!;
      const arr = result.get(v);
      if (arr) arr.push(k);
      else result.set(v, [k]);
    }
    return result;
  };
}

/**
 * Shared get-or-create helper for `WeakMap<K, V>`-backed per-key caches.
 *
 * This exact shape — partition state by some key object (almost always a
 * `ts.Program`, so watch/LSP rebuilds that produce a fresh Program invalidate
 * automatically) with lazy per-key initialization — recurs across the macro
 * packages' resolution caches and registries. Centralizing the get-or-create
 * step means a caller only supplies its own `WeakMap` instance (and, if it
 * needs one, its own separately-held fallback value for callers without a
 * key) rather than re-deriving the same four lines each time.
 */
export function getOrCreateWeak<K extends object, V>(map: WeakMap<K, V>, key: K, create: () => V): V {
  let value = map.get(key);
  if (!value) {
    value = create();
    map.set(key, value);
  }
  return value;
}

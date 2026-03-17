/**
 * Extracts valid dot-notation paths into an object type.
 * Excludes array-valued fields (use `collections` for those).
 * Top-level keys only; for nested paths use string (macro validates at expand time).
 *
 * @example
 * PathOf<{ a: number; b: { c: string } }> = "a" | "b"
 */
export type PathOf<T> = T extends object
  ? T extends unknown[]
    ? never
    : { [K in keyof T]: K extends string ? (T[K] extends unknown[] ? never : K) : never }[keyof T]
  : never;

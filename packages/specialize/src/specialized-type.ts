/**
 * Type utility for representing specialized function signatures.
 *
 * Specialized<F, N> removes the last N parameters from function F's signature.
 * Used for type-level representation of specialize() and .specialize() results.
 *
 * @example
 * ```typescript
 * type Fn = (items: number[], ord: Ord<number>) => number[];
 * type SpecializedFn = Specialized<Fn, 1>;
 * // SpecializedFn = (items: number[]) => number[]
 * ```
 */

type DropLast1<T extends unknown[]> = T extends [...infer R, unknown] ? R : [];
type DropLast2<T extends unknown[]> = DropLast1<DropLast1<T>>;
type DropLast3<T extends unknown[]> = DropLast1<DropLast2<T>>;
type DropLast4<T extends unknown[]> = DropLast1<DropLast3<T>>;
type DropLast5<T extends unknown[]> = DropLast1<DropLast4<T>>;
type DropLast6<T extends unknown[]> = DropLast1<DropLast5<T>>;
type DropLast7<T extends unknown[]> = DropLast1<DropLast6<T>>;
type DropLast8<T extends unknown[]> = DropLast1<DropLast7<T>>;
type DropLast9<T extends unknown[]> = DropLast1<DropLast8<T>>;
type DropLast10<T extends unknown[]> = DropLast1<DropLast9<T>>;

/**
 * Removes the last N parameters from a function type.
 * Supports N from 0 to 10.
 */
export type Specialized<F, N extends number> = F extends (...args: infer A) => infer R
  ? N extends 0
    ? F
    : N extends 1
      ? (...args: DropLast1<A>) => R
      : N extends 2
        ? (...args: DropLast2<A>) => R
        : N extends 3
          ? (...args: DropLast3<A>) => R
          : N extends 4
            ? (...args: DropLast4<A>) => R
            : N extends 5
              ? (...args: DropLast5<A>) => R
              : N extends 6
                ? (...args: DropLast6<A>) => R
                : N extends 7
                  ? (...args: DropLast7<A>) => R
                  : N extends 8
                    ? (...args: DropLast8<A>) => R
                    : N extends 9
                      ? (...args: DropLast9<A>) => R
                      : N extends 10
                        ? (...args: DropLast10<A>) => R
                        : (...args: unknown[]) => R
  : never;

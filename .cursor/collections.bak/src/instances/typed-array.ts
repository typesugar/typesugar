import type { IterableOnce } from "../typeclasses/iterable-once.js";
import type {
  Int8ArrayF,
  Uint8ArrayF,
  Uint8ClampedArrayF,
  Int16ArrayF,
  Uint16ArrayF,
  Int32ArrayF,
  Uint32ArrayF,
  Float32ArrayF,
  Float64ArrayF,
  BigInt64ArrayF,
  BigUint64ArrayF,
} from "../hkt.js";

/**
 * TypedArray HKT brands have a phantom type parameter — `$<Int8ArrayF, A>`
 * resolves to `Int8Array` regardless of `A`. This means the generic `A` in
 * `IterableOnce<F>` methods doesn't actually constrain the element type.
 *
 * At runtime this is harmless (typed arrays always yield their fixed element
 * type), but it means you can't rely on the type parameter for compile-time
 * safety. These instances exist primarily for compatibility with generic
 * algorithms that only need iteration/folding.
 *
 * TypedArrays are intentionally limited to IterableOnce — they don't implement
 * Iterable/Seq because `map`/`flatMap`/`from` would require knowing the
 * concrete TypedArray constructor at runtime.
 */
function typedArrayIterableOnce<F>(): IterableOnce<F> {
  return {
    iterator: <A>(fa: any) => fa[Symbol.iterator]() as IterableIterator<A>,
    foldLeft: <A, B>(fa: any, z: B, f: (b: B, a: A) => B) => {
      let acc = z;
      for (const a of fa) acc = f(acc, a as A);
      return acc;
    },
  };
}

export const int8ArrayIterableOnce: IterableOnce<Int8ArrayF> =
  typedArrayIterableOnce();
export const uint8ArrayIterableOnce: IterableOnce<Uint8ArrayF> =
  typedArrayIterableOnce();
export const uint8ClampedArrayIterableOnce: IterableOnce<Uint8ClampedArrayF> =
  typedArrayIterableOnce();
export const int16ArrayIterableOnce: IterableOnce<Int16ArrayF> =
  typedArrayIterableOnce();
export const uint16ArrayIterableOnce: IterableOnce<Uint16ArrayF> =
  typedArrayIterableOnce();
export const int32ArrayIterableOnce: IterableOnce<Int32ArrayF> =
  typedArrayIterableOnce();
export const uint32ArrayIterableOnce: IterableOnce<Uint32ArrayF> =
  typedArrayIterableOnce();
export const float32ArrayIterableOnce: IterableOnce<Float32ArrayF> =
  typedArrayIterableOnce();
export const float64ArrayIterableOnce: IterableOnce<Float64ArrayF> =
  typedArrayIterableOnce();
export const bigInt64ArrayIterableOnce: IterableOnce<BigInt64ArrayF> =
  typedArrayIterableOnce();
export const bigUint64ArrayIterableOnce: IterableOnce<BigUint64ArrayF> =
  typedArrayIterableOnce();

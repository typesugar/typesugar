/**
 * Entry points for creating lazy pipelines.
 *
 * `lazy()` wraps any iterable; `range()`, `iterate()`, `repeat()`,
 * and `generate()` create common source patterns.
 */

import { LazyPipeline } from "./lazy.js";

/** Create a lazy pipeline from any iterable */
export function lazy<T>(source: Iterable<T>): LazyPipeline<T> {
  return new LazyPipeline(source);
}

/** Create a lazy pipeline over a numeric range [start, end) with optional step */
export function range(
  start: number,
  end: number,
  step: number = 1,
): LazyPipeline<number> {
  return new LazyPipeline(rangeIterable(start, end, step));
}

/** Create an infinite pipeline by repeatedly applying `f` to a seed */
export function iterate<T>(seed: T, f: (value: T) => T): LazyPipeline<T> {
  return new LazyPipeline(iterateIterable(seed, f));
}

/** Create an infinite pipeline that repeats a single value */
export function repeat<T>(value: T): LazyPipeline<T> {
  return new LazyPipeline(repeatIterable(value));
}

/** Create an infinite pipeline from a generator function */
export function generate<T>(f: () => T): LazyPipeline<T> {
  return new LazyPipeline(generateIterable(f));
}

// ---------------------------------------------------------------------------
// Internal iterable factories
// ---------------------------------------------------------------------------

function* rangeIterable(
  start: number,
  end: number,
  step: number,
): Generator<number> {
  if (step === 0) throw new RangeError("range() step must not be zero");
  if (step > 0) {
    for (let i = start; i < end; i += step) yield i;
  } else {
    for (let i = start; i > end; i += step) yield i;
  }
}

function* iterateIterable<T>(seed: T, f: (value: T) => T): Generator<T> {
  let current = seed;
  while (true) {
    yield current;
    current = f(current);
  }
}

function* repeatIterable<T>(value: T): Generator<T> {
  while (true) yield value;
}

function* generateIterable<T>(f: () => T): Generator<T> {
  while (true) yield f();
}

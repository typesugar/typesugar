import type { IterableOnce } from "../typeclasses/iterable-once.js";
import type { $ } from "../hkt.js";

export class LazyView<A> implements globalThis.Iterable<A> {
  constructor(private readonly source: () => IterableIterator<A>) {}

  [Symbol.iterator](): IterableIterator<A> {
    return this.source();
  }

  map<B>(f: (a: A) => B): LazyView<B> {
    const src = this.source;
    return new LazyView(function* () {
      for (const a of src()) yield f(a);
    });
  }

  filter(p: (a: A) => boolean): LazyView<A> {
    const src = this.source;
    return new LazyView(function* () {
      for (const a of src()) if (p(a)) yield a;
    });
  }

  flatMap<B>(f: (a: A) => globalThis.Iterable<B>): LazyView<B> {
    const src = this.source;
    return new LazyView(function* () {
      for (const a of src()) yield* f(a);
    });
  }

  take(n: number): LazyView<A> {
    const src = this.source;
    return new LazyView(function* () {
      let i = 0;
      for (const a of src()) {
        if (i++ >= n) break;
        yield a;
      }
    });
  }

  drop(n: number): LazyView<A> {
    const src = this.source;
    return new LazyView(function* () {
      let i = 0;
      for (const a of src()) {
        if (i++ < n) continue;
        yield a;
      }
    });
  }

  takeWhile(p: (a: A) => boolean): LazyView<A> {
    const src = this.source;
    return new LazyView(function* () {
      for (const a of src()) {
        if (!p(a)) break;
        yield a;
      }
    });
  }

  dropWhile(p: (a: A) => boolean): LazyView<A> {
    const src = this.source;
    return new LazyView(function* () {
      let dropping = true;
      for (const a of src()) {
        if (dropping && p(a)) continue;
        dropping = false;
        yield a;
      }
    });
  }

  concat(other: LazyView<A>): LazyView<A> {
    const src = this.source;
    const otherSrc = other.source;
    return new LazyView(function* () {
      yield* src();
      yield* otherSrc();
    });
  }

  zip<B>(other: LazyView<B>): LazyView<[A, B]> {
    const src = this.source;
    const otherSrc = other.source;
    return new LazyView(function* () {
      const ia = src(),
        ib = otherSrc();
      while (true) {
        const a = ia.next(),
          b = ib.next();
        if (a.done || b.done) break;
        yield [a.value, b.value] as [A, B];
      }
    });
  }

  collect<B>(pf: (a: A) => B | undefined): LazyView<B> {
    const src = this.source;
    return new LazyView(function* () {
      for (const a of src()) {
        const b = pf(a);
        if (b !== undefined) yield b;
      }
    });
  }

  zipWithIndex(): LazyView<[A, number]> {
    const src = this.source;
    return new LazyView(function* () {
      let i = 0;
      for (const a of src()) yield [a, i++] as [A, number];
    });
  }

  foldLeft<B>(z: B, f: (b: B, a: A) => B): B {
    let acc = z;
    for (const a of this.source()) acc = f(acc, a);
    return acc;
  }
  reduce(f: (a: A, b: A) => A): A | undefined {
    let acc: A | undefined;
    let first = true;
    for (const a of this.source()) {
      if (first) {
        acc = a;
        first = false;
      } else {
        acc = f(acc!, a);
      }
    }
    return acc;
  }
  forEach(f: (a: A) => void): void {
    for (const a of this.source()) f(a);
  }
  toArray(): A[] {
    return Array.from(this.source());
  }
  count(p: (a: A) => boolean): number {
    let n = 0;
    for (const a of this.source()) if (p(a)) n++;
    return n;
  }
  exists(p: (a: A) => boolean): boolean {
    for (const a of this.source()) if (p(a)) return true;
    return false;
  }
  forall(p: (a: A) => boolean): boolean {
    for (const a of this.source()) if (!p(a)) return false;
    return true;
  }
  find(p: (a: A) => boolean): A | undefined {
    for (const a of this.source()) if (p(a)) return a;
    return undefined;
  }
  isEmpty(): boolean {
    return this.source().next().done === true;
  }
  size(): number {
    let n = 0;
    for (const _ of this.source()) n++;
    return n;
  }
  head(): A | undefined {
    const r = this.source().next();
    return r.done ? undefined : r.value;
  }
  last(): A | undefined {
    let v: A | undefined;
    for (const a of this.source()) v = a;
    return v;
  }
  sum(): number {
    let s = 0;
    for (const a of this.source()) s += a as unknown as number;
    return s;
  }
  min(): A | undefined {
    let m: A | undefined;
    for (const a of this.source()) {
      if (m === undefined || a < m!) m = a;
    }
    return m;
  }
  max(): A | undefined {
    let m: A | undefined;
    for (const a of this.source()) {
      if (m === undefined || a > m!) m = a;
    }
    return m;
  }
  mkString(sep = "", prefix = "", suffix = ""): string {
    let r = prefix;
    let first = true;
    for (const a of this.source()) {
      if (!first) r += sep;
      r += String(a);
      first = false;
    }
    return r + suffix;
  }
  toSet(): Set<A> {
    return new Set(this.source());
  }
}

export function view<F>(F: IterableOnce<F>): <A>(fa: $<F, A>) => LazyView<A> {
  return <A>(fa: $<F, A>) => new LazyView(() => F.iterator(fa));
}

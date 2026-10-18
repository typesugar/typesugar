/**
 * Data-type regression tests (deep-review findings #4, #13, #22, #25).
 */
import { describe, it, expect } from "vitest";
import { List, toArray, Nil } from "./list.js";
import { NEL, type NonEmptyList } from "./nonempty-list.js";
import { Some, None, isSome } from "./option.js";
import { State, traverse as stateTraverse, whileM, untilM } from "./state.js";
import { Reader, traverse as readerTraverse, replicateA as readerReplicateA } from "./reader.js";
import { Writer, traverse as writerTraverse } from "./writer.js";
import { Valid, traverse as validatedTraverse } from "./validated.js";
import { Success, traverse as rdTraverse } from "./remote-data.js";

describe("List / NEL: Nil inside Option (#4)", () => {
  it("tail of a one-element list is Nil, not 'no tail'", () => {
    const t = List.tail(List.of(1));
    expect(t).toBe(Nil);
    expect(List.tail(Nil)).toBeUndefined();
  });

  it("init of a one-element list is Nil, not 'no init'", () => {
    expect(List.init(List.of(1))).toBe(Nil);
    expect(List.init(Nil)).toBeUndefined();
  });

  it("traverse of the empty list succeeds", () => {
    const r = List.traverse(Nil, (x: number) => Some(x));
    expect(r).not.toBeUndefined();
    expect(r).toBe(Nil);
  });

  it("traverse returns undefined on failure", () => {
    expect(List.traverse(List.of(1, 2), (x) => (x === 2 ? None : Some(x)))).toBeUndefined();
    expect(toArray(List.traverse(List.of(1, 2), (x) => Some(x * 10))!)).toEqual([10, 20]);
  });

  it("NEL.traverse of a singleton succeeds", () => {
    const r = NEL.traverse(NEL.of(1), (x: number) => Some(x + 1));
    expect(isSome(r)).toBe(true);
    expect(NEL.toArray(r as unknown as NonEmptyList<number>)).toEqual([2]);
  });

  it("NEL.traverse still fails when an element fails", () => {
    expect(NEL.traverse(NEL.of(1, 2), (x) => (x === 2 ? None : Some(x)))).toBe(None);
  });
});

describe("NEL with null elements (#25)", () => {
  it("last returns a null last element, not the head", () => {
    expect(NEL.last(NEL.of<number | null>(1, null))).toBeNull();
  });
});

describe("stack safety at 20k (#13)", () => {
  const xs = Array.from({ length: 20000 }, (_, i) => i);

  it("State.traverse", () => {
    const [out, s] = stateTraverse(xs, (x) => new State<number, number>((n) => [x, n + 1])).run(0);
    expect(out.length).toBe(20000);
    expect(s).toBe(20000);
  });

  it("State whileM / untilM", () => {
    const cond = new State<number, boolean>((n) => [n < 20000, n]);
    const body = new State<number, void>((n) => [undefined, n + 1]);
    expect(whileM(cond, body).runS(0)).toBe(20000);
    const done = new State<number, boolean>((n) => [n >= 20000, n]);
    expect(untilM(body, done).runS(0)).toBe(20000);
  });

  it("Reader.traverse / replicateA", () => {
    expect(readerTraverse(xs, (x) => new Reader<number, number>((r) => x + r)).run(1)[19999]).toBe(
      20000
    );
    expect(readerReplicateA(20000, new Reader<number, number>((r) => r)).run(3).length).toBe(20000);
  });

  it("NEL.reduceRight", () => {
    const nel = NEL.unsafeFromArray(xs.map(String));
    expect(NEL.reduceRight(nel, (a, b) => (a.length > b.length ? a : b))).toBe("19999");
  });

  it("NEL.reduceRight order is right-associative", () => {
    expect(NEL.reduceRight(NEL.of("a", "b", "c"), (a, b) => `(${a}${b})`)).toBe("(a(bc))");
  });
});

describe("linear traverse (#22)", () => {
  const xs = Array.from({ length: 50000 }, (_, i) => i);
  const fast = (f: () => unknown) => {
    const t = Date.now();
    f();
    expect(Date.now() - t).toBeLessThan(1500);
  };
  const sumMonoid = { empty: 0, combine: (a: number, b: number) => a + b };
  const strSemi = { combine: (a: string, b: string) => a + b };

  it("Writer.traverse", () =>
    fast(() => {
      const [out, log] = writerTraverse(xs, (x) => new Writer(x, 1), sumMonoid).run();
      expect(out.length).toBe(50000);
      expect(log).toBe(50000);
    }));
  it("Validated.traverse", () =>
    fast(() => {
      const r = validatedTraverse(xs, (x) => Valid(x), strSemi) as { value?: number[] };
      expect(JSON.stringify(r).length).toBeGreaterThan(0);
    }));
  it("RemoteData.traverse", () =>
    fast(() => {
      const r = rdTraverse(xs, (x) => Success(x));
      expect(JSON.stringify(r).length).toBeGreaterThan(0);
    }));
  it("NEL.init", () =>
    fast(() => {
      expect(toArray(NEL.init(NEL.unsafeFromArray(xs))).length).toBe(49999);
    }));
  it("traversing twice gives independent results", () => {
    const a = validatedTraverse([1, 2], (x) => Valid(x), strSemi);
    const b = validatedTraverse([1, 2], (x) => Valid(x), strSemi);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});

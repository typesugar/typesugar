import { describe, it, expect } from "vitest";
import { preprocess } from "../src/preprocess.js";

describe("Mixed extension interactions", () => {
  describe("HKT with operators", () => {
    it("should handle HKT and pipeline in same file", () => {
      const source = `
interface Functor<F<_>> {
  map: <A, B>(fa: F<A>, f: (a: A) => B) => F<B>;
}

const result = value |> transform;`;
      const { code, changed } = preprocess(source);
      expect(changed).toBe(true);
      expect(code).toContain("Functor<F>");
      expect(code).toContain("$<F, A>");
      expect(code).toContain("$<F, B>");
      expect(code).toContain('__binop__(value, "|>", transform)');
    });

    it("should handle HKT and cons in same file", () => {
      const source = `
interface IterableOnce<F<_>> {
  toArray: <A>(fa: F<A>) => A[];
}

const list = 1 :: 2 :: [];`;
      const { code, changed } = preprocess(source);
      expect(changed).toBe(true);
      expect(code).toContain("IterableOnce<F>");
      expect(code).toContain("$<F, A>");
      expect(code).toContain('__binop__(1, "::", __binop__(2, "::", []))');
    });
  });

  describe("pipeline and cons together", () => {
    it("should handle cons then pipeline", () => {
      const source = `1 :: [2, 3] |> sum`;
      const { code } = preprocess(source, {
        extensions: ["pipeline", "cons"],
      });
      expect(code).toBe(`__binop__(__binop__(1, "::", [2, 3]), "|>", sum)`);
    });

    it("should handle pipeline then cons", () => {
      const source = `head |> (x => x :: tail)`;
      const { code } = preprocess(source, {
        extensions: ["pipeline", "cons"],
      });
      expect(code).toContain('__binop__(head, "|>"');
      expect(code).toContain('__binop__(x, "::", tail)');
    });

    it("should handle mixed chains", () => {
      const source = `a :: b |> f |> g :: c`;
      const { code } = preprocess(source, {
        extensions: ["pipeline", "cons"],
      });
      expect(code).toBe(
        `__binop__(__binop__(__binop__(a, "::", b), "|>", f), "|>", __binop__(g, "::", c))`
      );
    });
  });

  describe("all extensions enabled by default", () => {
    it("should enable all extensions when none specified", () => {
      const source = `
interface F<X<_>> { f: <A>(x: X<A>) => X<A>; }
const x = a |> b :: c;`;
      const { code, changed } = preprocess(source);
      expect(changed).toBe(true);
      expect(code).toContain("F<X>");
      expect(code).toContain("$<X, A>");
      expect(code).toContain("__binop__");
    });
  });

  describe("selective extension enabling", () => {
    it("should only apply HKT when specified", () => {
      const source = `
interface F<X<_>> {}
const x = a |> b;`;
      const { code, changed } = preprocess(source, { extensions: ["hkt"] });
      expect(changed).toBe(true);
      expect(code).toContain("F<X>");
      expect(code).toContain("a |> b");
    });

    it("should only apply pipeline when specified", () => {
      const source = `
interface F<X<_>> {}
const x = a |> b;`;
      const { code, changed } = preprocess(source, {
        extensions: ["pipeline"],
      });
      expect(changed).toBe(true);
      expect(code).toContain("F<X<_>>");
      expect(code).toContain("__binop__");
    });
  });

  describe("source map", () => {
    it("should generate source map for HKT changes", () => {
      const source = `interface Functor<F<_>> {}`;
      const { map, changed } = preprocess(source, {
        extensions: ["hkt"],
      });
      expect(changed).toBe(true);
      expect(map).not.toBeNull();
      expect(map?.version).toBe(3);
      expect(map?.mappings).toBeDefined();
      expect(map?.mappings.length).toBeGreaterThan(0);
    });

    it("should generate source map for operator changes", () => {
      const source = `x |> f`;
      const { map, changed } = preprocess(source, {
        extensions: ["pipeline"],
      });
      expect(changed).toBe(true);
      expect(map).not.toBeNull();
      expect(map?.version).toBe(3);
      expect(map?.mappings).toBeDefined();
      expect(map?.mappings.length).toBeGreaterThan(0);
    });

    it("should produce valid source map v3 format", () => {
      const source = `const result = x |> f;`;
      const { map, code } = preprocess(source, {
        extensions: ["pipeline"],
      });
      expect(map).not.toBeNull();
      expect(map?.version).toBe(3);
      expect(map?.sources).toBeInstanceOf(Array);
      expect(map?.names).toBeInstanceOf(Array);
      expect(typeof map?.mappings).toBe("string");
      expect(map?.sourcesContent).toBeInstanceOf(Array);
    });
  });

  describe("real-world examples", () => {
    it("should handle Functor typeclass", () => {
      const source = `
export interface Functor<F<_>> {
  readonly map: <A, B>(fa: F<A>, f: (a: A) => B) => F<B>;
}

export function lift<F<_>>(F: Functor<F>): <A, B>(f: (a: A) => B) => (fa: F<A>) => F<B> {
  return (f) => (fa) => F.map(fa, f);
}`;
      const { code, changed } = preprocess(source, { extensions: ["hkt"] });
      expect(changed).toBe(true);
      expect(code).toContain("Functor<F>");
      expect(code).toContain("$<F, A>");
      expect(code).toContain("$<F, B>");
    });

    it("should handle functional pipeline composition", () => {
      const source = `
const process = (data: number[]) =>
  data
    |> filter(x => x > 0)
    |> map(x => x * 2)
    |> reduce((a, b) => a + b, 0);`;
      const { code, changed } = preprocess(source, {
        extensions: ["pipeline"],
      });
      expect(changed).toBe(true);
      expect(code).toContain("__binop__");
    });

    it("should handle list construction", () => {
      const source = `
const list = 1 :: 2 :: 3 :: 4 :: [];
const withHead = head :: tail;`;
      const { code, changed } = preprocess(source, { extensions: ["cons"] });
      expect(changed).toBe(true);
      expect(code).toContain('__binop__(1, "::"');
      expect(code).toContain('__binop__(head, "::", tail)');
    });
  });
});

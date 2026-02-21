import { describe, it, expect } from "vitest";
import { preprocess } from "../src/preprocess.js";

describe("Pipeline operator extension", () => {
  describe("basic transformation", () => {
    it("should transform simple pipeline", () => {
      const source = `x |> f`;
      const { code, changed } = preprocess(source, {
        extensions: ["pipeline"],
      });
      expect(changed).toBe(true);
      expect(code).toBe(`__binop__(x, "|>", f)`);
    });

    it("should transform chained pipeline", () => {
      const source = `x |> f |> g`;
      const { code } = preprocess(source, { extensions: ["pipeline"] });
      expect(code).toBe(`__binop__(__binop__(x, "|>", f), "|>", g)`);
    });

    it("should transform triple chained pipeline", () => {
      const source = `x |> f |> g |> h`;
      const { code } = preprocess(source, { extensions: ["pipeline"] });
      expect(code).toBe(`__binop__(__binop__(__binop__(x, "|>", f), "|>", g), "|>", h)`);
    });
  });

  describe("precedence", () => {
    it("should bind looser than arithmetic", () => {
      const source = `a + b |> f`;
      const { code } = preprocess(source, { extensions: ["pipeline"] });
      expect(code).toBe(`__binop__(a + b, "|>", f)`);
    });

    it("should bind tighter than assignment", () => {
      const source = `const x = a |> f`;
      const { code } = preprocess(source, { extensions: ["pipeline"] });
      expect(code).toContain(`__binop__(a, "|>", f)`);
    });

    it("should respect parentheses", () => {
      const source = `(a |> f) + b`;
      const { code } = preprocess(source, { extensions: ["pipeline"] });
      expect(code).toContain(`__binop__(a, "|>", f)`);
    });
  });

  describe("associativity", () => {
    it("should be left-associative", () => {
      const source = `a |> b |> c`;
      const { code } = preprocess(source, { extensions: ["pipeline"] });
      expect(code).toBe(`__binop__(__binop__(a, "|>", b), "|>", c)`);
    });
  });

  describe("complex expressions", () => {
    it("should handle function calls as operands", () => {
      const source = `getData() |> transform`;
      const { code } = preprocess(source, { extensions: ["pipeline"] });
      expect(code).toBe(`__binop__(getData(), "|>", transform)`);
    });

    it("should handle method calls as operands", () => {
      const source = `obj.getData() |> transform`;
      const { code } = preprocess(source, { extensions: ["pipeline"] });
      expect(code).toBe(`__binop__(obj.getData(), "|>", transform)`);
    });

    it("should handle arrow functions", () => {
      const source = `x |> (y => y * 2)`;
      const { code } = preprocess(source, { extensions: ["pipeline"] });
      expect(code).toBe(`__binop__(x, "|>", (y => y * 2))`);
    });

    it("should handle array literals", () => {
      const source = `[1, 2, 3] |> sum`;
      const { code } = preprocess(source, { extensions: ["pipeline"] });
      expect(code).toBe(`__binop__([1, 2, 3], "|>", sum)`);
    });
  });

  describe("edge cases", () => {
    it("should not transform inside strings", () => {
      const source = `const s = "a |> b"`;
      const { code, changed } = preprocess(source, {
        extensions: ["pipeline"],
      });
      expect(changed).toBe(false);
      expect(code).toBe(source);
    });

    it("should handle pipeline at start of statement", () => {
      const source = `value |> console.log`;
      const { code } = preprocess(source, { extensions: ["pipeline"] });
      expect(code).toBe(`__binop__(value, "|>", console.log)`);
    });
  });

  describe("type annotation context", () => {
    it("should not transform operators in type alias declarations", () => {
      const source = `type Pipe<A, B> = A |> B;`;
      const { code, changed } = preprocess(source, {
        extensions: ["pipeline"],
      });
      // |> in type context should not be transformed
      expect(changed).toBe(false);
      expect(code).toBe(source);
    });

    it("should not transform operators in interface declarations", () => {
      const source = `interface Foo { bar: A |> B; }`;
      const { code, changed } = preprocess(source, {
        extensions: ["pipeline"],
      });
      expect(changed).toBe(false);
      expect(code).toBe(source);
    });

    it("should transform operators in expression context after type annotation", () => {
      const source = `const x: number = a |> f;`;
      const { code, changed } = preprocess(source, {
        extensions: ["pipeline"],
      });
      expect(changed).toBe(true);
      expect(code).toContain("__binop__");
    });

    it("should not transform operators inside generic type parameters", () => {
      const source = `function foo<T extends A |> B>() {}`;
      const { code, changed } = preprocess(source, {
        extensions: ["pipeline"],
      });
      expect(changed).toBe(false);
      expect(code).toBe(source);
    });
  });

  describe("TSX scanner mode", () => {
    it("should handle pipeline in TSX files", () => {
      const source = `const element = data |> render;`;
      const { code, changed } = preprocess(source, {
        extensions: ["pipeline"],
        fileName: "test.tsx",
      });
      expect(changed).toBe(true);
      expect(code).toContain("__binop__");
    });

    it("should not break on JSX syntax in TSX files", () => {
      const source = `const x = value |> transform;
const el = <div>{x}</div>;`;
      const { code, changed } = preprocess(source, {
        extensions: ["pipeline"],
        fileName: "test.tsx",
      });
      expect(changed).toBe(true);
      expect(code).toContain("__binop__");
      expect(code).toContain("<div>");
    });
  });
});

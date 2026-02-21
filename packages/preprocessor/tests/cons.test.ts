import { describe, it, expect } from "vitest";
import { preprocess } from "../src/preprocess.js";

describe("Cons operator extension", () => {
  describe("basic transformation", () => {
    it("should transform simple cons", () => {
      const source = `head :: tail`;
      const { code, changed } = preprocess(source, { extensions: ["cons"] });
      expect(changed).toBe(true);
      expect(code).toBe(`__binop__(head, "::", tail)`);
    });

    it("should transform cons with array literal", () => {
      const source = `1 :: [2, 3]`;
      const { code } = preprocess(source, { extensions: ["cons"] });
      expect(code).toBe(`__binop__(1, "::", [2, 3])`);
    });

    it("should transform cons with empty array", () => {
      const source = `1 :: []`;
      const { code } = preprocess(source, { extensions: ["cons"] });
      expect(code).toBe(`__binop__(1, "::", [])`);
    });
  });

  describe("associativity", () => {
    it("should be right-associative", () => {
      const source = `1 :: 2 :: []`;
      const { code } = preprocess(source, { extensions: ["cons"] });
      expect(code).toBe(`__binop__(1, "::", __binop__(2, "::", []))`);
    });

    it("should handle triple cons", () => {
      const source = `1 :: 2 :: 3 :: []`;
      const { code } = preprocess(source, { extensions: ["cons"] });
      expect(code).toBe(`__binop__(1, "::", __binop__(2, "::", __binop__(3, "::", [])))`);
    });
  });

  describe("precedence", () => {
    it("should bind looser than arithmetic", () => {
      const source = `a + b :: list`;
      const { code } = preprocess(source, { extensions: ["cons"] });
      expect(code).toBe(`__binop__(a + b, "::", list)`);
    });

    it("should bind tighter than assignment", () => {
      const source = `const x = 1 :: list`;
      const { code } = preprocess(source, { extensions: ["cons"] });
      expect(code).toContain(`__binop__(1, "::", list)`);
    });

    it("should bind tighter than pipeline", () => {
      const source = `a :: b |> f`;
      const { code } = preprocess(source, {
        extensions: ["cons", "pipeline"],
      });
      expect(code).toBe(`__binop__(__binop__(a, "::", b), "|>", f)`);
    });
  });

  describe("complex expressions", () => {
    it("should handle function calls as head", () => {
      const source = `getValue() :: list`;
      const { code } = preprocess(source, { extensions: ["cons"] });
      expect(code).toBe(`__binop__(getValue(), "::", list)`);
    });

    it("should handle property access", () => {
      const source = `obj.value :: obj.list`;
      const { code } = preprocess(source, { extensions: ["cons"] });
      expect(code).toBe(`__binop__(obj.value, "::", obj.list)`);
    });

    it("should handle computed values", () => {
      const source = `(a + b) :: rest`;
      const { code } = preprocess(source, { extensions: ["cons"] });
      expect(code).toBe(`__binop__((a + b), "::", rest)`);
    });
  });

  describe("edge cases", () => {
    it("should not confuse with ternary colon", () => {
      const source = `x ? a : b`;
      const { code, changed } = preprocess(source, { extensions: ["cons"] });
      expect(changed).toBe(false);
      expect(code).toBe(source);
    });

    it("should not confuse with type annotation", () => {
      const source = `const x: number = 1`;
      const { code, changed } = preprocess(source, { extensions: ["cons"] });
      expect(changed).toBe(false);
      expect(code).toBe(source);
    });

    it("should not transform inside strings", () => {
      const source = `const s = "a :: b"`;
      const { code, changed } = preprocess(source, { extensions: ["cons"] });
      expect(changed).toBe(false);
      expect(code).toBe(source);
    });
  });
});

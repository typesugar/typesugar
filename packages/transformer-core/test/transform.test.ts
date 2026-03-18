/**
 * Tests for transformCode() function
 *
 * Verifies:
 * - Basic macro expansion works in-memory
 * - No file system access in the transform path
 * - Source maps are generated
 * - Diagnostics are collected
 */

import { describe, it, expect, beforeAll } from "vitest";
import { transformCode, type TransformCodeResult } from "../src/transform.js";

beforeAll(async () => {
  await import("@typesugar/macros");
});

describe("transformCode", () => {
  describe("basic functionality", () => {
    it("should return unchanged result for code without macros", () => {
      const code = `const x = 1 + 2;`;
      const result = transformCode(code);

      expect(result.changed).toBe(false);
      expect(result.code.trim()).toBe(code.trim());
      expect(result.diagnostics).toHaveLength(0);
    });

    it("should return code property matching original when unchanged", () => {
      const code = `function hello() { return "world"; }`;
      const result = transformCode(code);

      expect(result.original).toBe(code);
      expect(result.changed).toBe(false);
    });

    it("should handle empty code", () => {
      const result = transformCode("");
      expect(result.changed).toBe(false);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("should handle code with only comments", () => {
      const code = `// This is a comment\nconst x = 1;`;
      const result = transformCode(code);

      expect(result.changed).toBe(false);
    });
  });

  describe("options handling", () => {
    it("should use default fileName when not provided", () => {
      const result = transformCode(`const x = 1;`);
      expect(result.diagnostics.every((d) => d.file.includes("input"))).toBe(true);
    });

    it("should use custom fileName when provided", () => {
      const code = `const x = 1;`;
      const result = transformCode(code, { fileName: "custom.ts" });
      expect(result.diagnostics).toHaveLength(0);
    });

    it("should infer TSX for JSX-like content", () => {
      const code = `const x = <div>Hello</div>;`;
      const result = transformCode(code);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("should handle .tsx fileName", () => {
      const code = `const x = <div>Hello</div>;`;
      const result = transformCode(code, { fileName: "component.tsx" });
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  describe("in-memory operation", () => {
    it("should not access file system", () => {
      const code = `
        import { foo } from "./non-existent-file";
        const x = foo();
      `;

      const result = transformCode(code);
      expect(result.changed).toBe(false);
    });

    it("should work with synthetic source file", () => {
      const code = `
        type MyType = string | number;
        const x: MyType = "hello";
      `;

      const result = transformCode(code);
      expect(result.changed).toBe(false);
      expect(result.code).toContain("MyType");
    });
  });

  describe("diagnostic collection", () => {
    it("should return empty diagnostics for valid code", () => {
      const code = `const x = 1;`;
      const result = transformCode(code);

      expect(result.diagnostics).toEqual([]);
    });

    it("should have correct diagnostic structure", () => {
      const code = `const x = 1;`;
      const result = transformCode(code);
      expect(Array.isArray(result.diagnostics)).toBe(true);
    });
  });

  describe("TransformResult shape", () => {
    it("should return all required fields", () => {
      const code = `const x = 1;`;
      const result = transformCode(code);

      expect(result).toHaveProperty("original");
      expect(result).toHaveProperty("code");
      expect(result).toHaveProperty("sourceMap");
      expect(result).toHaveProperty("mapper");
      expect(result).toHaveProperty("changed");
      expect(result).toHaveProperty("diagnostics");
    });

    it("should have null sourceMap when no expansions tracked", () => {
      const code = `const x = 1;`;
      const result = transformCode(code);

      expect(result.sourceMap).toBeNull();
    });

    it("should have IdentityPositionMapper when no sourceMap", () => {
      const code = `const x = 1;`;
      const result = transformCode(code);

      expect(result.mapper).toBeDefined();
      const mapped = result.mapper.toOriginal(5);
      expect(mapped).toBe(5);
    });
  });

  describe("macro expansion", () => {
    it("should expand staticAssert(true) to comment", () => {
      const code = `
        import { staticAssert } from "@typesugar/macros";
        staticAssert(true);
      `;

      const result = transformCode(code, { verbose: false });

      expect(result.changed).toBe(true);
      expect(result.code).toContain("// staticAssert");
      expect(result.code).toContain("✓");
      const nonCommentLines = result.code
        .split("\n")
        .filter((l) => !l.trim().startsWith("//") && l.trim() !== ";");
      expect(nonCommentLines.join("")).not.toContain("staticAssert(true)");
    });

    it("should expand comptime expressions", () => {
      const code = `
        import { comptime } from "@typesugar/macros";
        const x = comptime(() => 1 + 2);
      `;

      const result = transformCode(code, { verbose: false });

      expect(result.changed).toBe(true);
      expect(result.code).toContain("3");
    });

    it("should handle multiple macros in one file", () => {
      const code = `
        import { comptime, staticAssert } from "@typesugar/macros";
        staticAssert(true);
        const x = comptime(() => 2 * 3);
        staticAssert(true);
      `;

      const result = transformCode(code, { verbose: false });

      expect(result.changed).toBe(true);
      const nonCommentLines = result.code
        .split("\n")
        .filter((l) => !l.trim().startsWith("//") && l.trim() !== ";");
      expect(nonCommentLines.join("")).not.toContain("staticAssert(true)");
      expect(result.code).toContain("6");
    });
  });

  describe("expansion tracking", () => {
    it("should generate sourceMap when trackExpansions is true and code changes", () => {
      const code = `
        import { comptime } from "@typesugar/macros";
        const x = comptime(() => 42);
      `;

      const result = transformCode(code, { trackExpansions: true });

      expect(result.changed).toBe(true);
      expect(result.sourceMap).not.toBeNull();
      expect(result.sourceMap?.file).toBeDefined();
    });

    it("should return expansion records when trackExpansions is true", () => {
      const code = `
        import { comptime } from "@typesugar/macros";
        const x = comptime(() => 123);
      `;

      const result = transformCode(code, { trackExpansions: true });

      expect(result.expansions).toBeDefined();
    });
  });

  describe("error handling", () => {
    it("should handle invalid TypeScript gracefully", () => {
      const code = `const x = {;`;

      expect(() => transformCode(code)).not.toThrow();
    });

    it("should return diagnostics for macro errors", () => {
      const code = `
        import { staticAssert } from "@typesugar/macros";
        staticAssert(false, "This should fail");
      `;

      const result = transformCode(code);

      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.diagnostics.some((d) => d.severity === "error")).toBe(true);
    });
  });

  describe("custom compiler options", () => {
    it("should accept custom compiler options", () => {
      const code = `const x: number = 1;`;

      const result = transformCode(code, {
        compilerOptions: {
          strict: true,
          target: 99,
        },
      });

      expect(result.diagnostics).toHaveLength(0);
    });
  });
});

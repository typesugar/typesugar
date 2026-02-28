/**
 * Tests for @typesugar/eslint-plugin full processor
 *
 * Tests the full processor that uses the actual typesugar transformer.
 * Some tests are limited because they require a complete TypeScript program.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createFullProcessor, clearTransformCache } from "../src/full-processor.js";

describe("Full Processor", () => {
  let processor: ReturnType<typeof createFullProcessor>;

  beforeEach(() => {
    clearTransformCache();
    processor = createFullProcessor();
  });

  describe("meta", () => {
    it("should have correct meta information", () => {
      expect(processor.meta).toBeDefined();
      expect(processor.meta?.name).toBe("typesugar-full");
      expect(processor.meta?.version).toBe("0.1.0");
    });

    it("should support autofix", () => {
      expect(processor.supportsAutofix).toBe(true);
    });
  });

  describe("preprocess", () => {
    describe("file type filtering", () => {
      it("should pass through .js files unchanged", () => {
        const source = "@derive(Eq) class Foo {}";
        const result = processor.preprocess(source, "test.js");
        expect(result).toHaveLength(1);
        expect(result[0]).toBe(source);
      });

      it("should pass through .jsx files unchanged", () => {
        const source = "const x = <div>Hello</div>;";
        const result = processor.preprocess(source, "test.jsx");
        expect(result).toHaveLength(1);
        expect(result[0]).toBe(source);
      });

      it("should pass through .mjs files unchanged", () => {
        const source = "export const x = 42;";
        const result = processor.preprocess(source, "test.mjs");
        expect(result).toHaveLength(1);
        expect(result[0]).toBe(source);
      });

      it("should process .ts files", () => {
        const source = "const x: number = 42;";
        const result = processor.preprocess(source, "test.ts");
        expect(result).toHaveLength(1);
        expect(typeof result[0]).toBe("string");
      });

      it("should process .tsx files", () => {
        const source = "const x: number = 42;";
        const result = processor.preprocess(source, "test.tsx");
        expect(result).toHaveLength(1);
        expect(typeof result[0]).toBe("string");
      });
    });

    describe("fallback behavior", () => {
      it("should return original source when pipeline is not available", () => {
        const source = "const x = 42;";
        const result = processor.preprocess(source, "/nonexistent/path/test.ts");
        expect(result).toHaveLength(1);
        expect(typeof result[0]).toBe("string");
      });
    });
  });

  describe("postprocess", () => {
    it("should pass through messages when no state exists", () => {
      const messages = [[{ ruleId: "test", message: "Error", line: 1, column: 1 }]];
      const result = processor.postprocess(messages, "unknown-file.ts");
      expect(result).toHaveLength(1);
      expect(result[0].ruleId).toBe("test");
    });

    it("should flatten nested message arrays", () => {
      processor.preprocess("const x = 1;", "test.ts");
      const messages = [
        [
          { ruleId: "error1", message: "Error 1", line: 1, column: 1 },
          { ruleId: "error2", message: "Error 2", line: 1, column: 5 },
        ],
      ];
      const result = processor.postprocess(messages, "test.ts");
      expect(result).toHaveLength(2);
    });

    it("should handle empty message arrays", () => {
      processor.preprocess("const x = 1;", "test.ts");
      const result = processor.postprocess([[]], "test.ts");
      expect(result).toHaveLength(0);
    });

    describe("typesugar import filtering", () => {
      it("should filter unused import errors for typesugar packages", () => {
        const source = 'import { derive } from "typesugar";';
        processor.preprocess(source, "test.ts");

        const messages = [
          [
            {
              ruleId: "no-unused-vars",
              message: "'derive' is defined but never used",
              line: 1,
              column: 10,
            },
          ],
        ];

        const result = processor.postprocess(messages, "test.ts");
        expect(result).toHaveLength(0);
      });

      it("should filter unused import errors for @typesugar/* packages", () => {
        const source = 'import { Eq } from "@typesugar/std";';
        processor.preprocess(source, "test.ts");

        const messages = [
          [
            {
              ruleId: "@typescript-eslint/no-unused-vars",
              message: "'Eq' is defined but never used",
              line: 1,
              column: 10,
            },
          ],
        ];

        const result = processor.postprocess(messages, "test.ts");
        expect(result).toHaveLength(0);
      });

      it("should filter unused import errors for legacy @ttfx/* packages", () => {
        const source = 'import { derive } from "@ttfx/core";';
        processor.preprocess(source, "test.ts");

        const messages = [
          [
            {
              ruleId: "no-unused-vars",
              message: "'derive' is defined but never used",
              line: 1,
              column: 10,
            },
          ],
        ];

        const result = processor.postprocess(messages, "test.ts");
        expect(result).toHaveLength(0);
      });

      it("should NOT filter unused import errors for non-typesugar packages", () => {
        const source = 'import { foo } from "lodash";';
        processor.preprocess(source, "test.ts");

        const messages = [
          [
            {
              ruleId: "no-unused-vars",
              message: "'foo' is defined but never used",
              line: 1,
              column: 10,
            },
          ],
        ];

        const result = processor.postprocess(messages, "test.ts");
        expect(result).toHaveLength(1);
      });
    });
  });

  describe("clearTransformCache", () => {
    it("should not throw when called", () => {
      expect(() => clearTransformCache()).not.toThrow();
    });

    it("should be callable multiple times", () => {
      clearTransformCache();
      clearTransformCache();
      clearTransformCache();
    });

    it("should clear file states", () => {
      processor.preprocess("const x = 1;", "test.ts");
      clearTransformCache();
      const messages = [[{ ruleId: "test", message: "Error", line: 1, column: 1 }]];
      const result = processor.postprocess(messages, "test.ts");
      expect(result).toHaveLength(1);
    });
  });
});

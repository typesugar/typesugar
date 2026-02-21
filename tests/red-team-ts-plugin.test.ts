/**
 * Red Team Tests for @typesugar/ts-plugin
 *
 * Attack surfaces:
 * - Position mapper edge cases (boundary positions, unmappable regions)
 * - File type filtering (node_modules, declaration files, edge cases)
 * - Cache invalidation (stale data, dependency chains)
 * - Error recovery (malformed input, missing files)
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  IdentityPositionMapper,
  SourceMapPositionMapper,
  createPositionMapper,
  type TextRange,
} from "../packages/transformer/src/position-mapper.js";
import { TransformationPipeline, transformCode } from "../packages/transformer/src/pipeline.js";
import type * as ts from "typescript";

describe("TS Plugin Position Mapper Edge Cases", () => {
  // ==========================================================================
  // Attack 1: Identity Mapper Boundary Conditions
  // ==========================================================================
  describe("IdentityPositionMapper boundary conditions", () => {
    const mapper = new IdentityPositionMapper();

    it("handles zero position", () => {
      expect(mapper.toTransformed(0)).toBe(0);
      expect(mapper.toOriginal(0)).toBe(0);
    });

    it("handles negative positions (malformed input)", () => {
      // Identity mapper passes through without validation
      expect(mapper.toTransformed(-1)).toBe(-1);
      expect(mapper.toOriginal(-100)).toBe(-100);
    });

    it("handles extremely large positions", () => {
      const large = Number.MAX_SAFE_INTEGER;
      expect(mapper.toTransformed(large)).toBe(large);
      expect(mapper.toOriginal(large)).toBe(large);
    });

    it("preserves range exactly for empty ranges", () => {
      const emptyRange: TextRange = { start: 10, length: 0 };
      expect(mapper.mapRange(emptyRange, "toTransformed")).toEqual(emptyRange);
      expect(mapper.mapRange(emptyRange, "toOriginal")).toEqual(emptyRange);
    });

    it("handles diagnostic with undefined start", () => {
      const diag = { messageText: "error" } as ts.Diagnostic;
      expect(mapper.mapDiagnostic(diag)).toBe(diag);
    });
  });

  // ==========================================================================
  // Attack 2: SourceMapPositionMapper Edge Cases
  // ==========================================================================
  describe("SourceMapPositionMapper with minimal source map", () => {
    it("handles empty source map gracefully", () => {
      const sourceMap = {
        version: 3 as const,
        file: "output.ts",
        sources: ["input.ts"],
        names: [],
        mappings: "",
      };
      const mapper = new SourceMapPositionMapper(sourceMap, "const x = 1;", "const x = 1;");
      
      // With empty mappings, positions may not map
      const result = mapper.toOriginal(0);
      // Should handle gracefully without crashing
      expect(result).toBeDefined();
    });

    it("handles position beyond file length", () => {
      const sourceMap = {
        version: 3 as const,
        file: "output.ts",
        sources: ["input.ts"],
        names: [],
        mappings: "AAAA",
      };
      const original = "x";
      const transformed = "x";
      const mapper = new SourceMapPositionMapper(sourceMap, original, transformed);
      
      // Position way beyond file
      const result = mapper.toOriginal(1000);
      // Should return null or handle gracefully
      expect(typeof result === "number" || result === null).toBe(true);
    });

    it("handles multiline content with CR/LF variations", () => {
      const sourceMap = {
        version: 3 as const,
        file: "output.ts",
        sources: ["input.ts"],
        names: [],
        mappings: "AAAA;AACA",
      };
      // Content with Unix line endings
      const original = "line1\nline2";
      const transformed = "line1\nline2";
      const mapper = new SourceMapPositionMapper(sourceMap, original, transformed);
      
      // Position at start of second line
      const pos = mapper.toOriginal(6);
      expect(typeof pos === "number" || pos === null).toBe(true);
    });
  });

  // ==========================================================================
  // Attack 3: createPositionMapper Factory Edge Cases
  // ==========================================================================
  describe("createPositionMapper factory", () => {
    it("returns IdentityPositionMapper when source map is null", () => {
      const mapper = createPositionMapper(null, "code", "code");
      expect(mapper).toBeInstanceOf(IdentityPositionMapper);
    });

    it("returns IdentityPositionMapper when content is identical", () => {
      const sourceMap = {
        version: 3 as const,
        file: "output.ts",
        sources: ["input.ts"],
        names: [],
        mappings: "AAAA",
      };
      const code = "const x = 1;";
      const mapper = createPositionMapper(sourceMap, code, code);
      // When original === transformed, should use identity
      expect(mapper).toBeInstanceOf(IdentityPositionMapper);
    });

    it("returns SourceMapPositionMapper when content differs", () => {
      const sourceMap = {
        version: 3 as const,
        file: "output.ts",
        sources: ["input.ts"],
        names: [],
        mappings: "AAAA",
      };
      const mapper = createPositionMapper(sourceMap, "original", "transformed");
      expect(mapper).toBeInstanceOf(SourceMapPositionMapper);
    });
  });
});

describe("TS Plugin File Type Handling", () => {
  // ==========================================================================
  // Attack 4: shouldTransform File Filtering
  // ==========================================================================
  describe("shouldTransform edge cases", () => {
    let pipeline: TransformationPipeline;

    beforeEach(() => {
      pipeline = new TransformationPipeline({}, [], {
        readFile: () => undefined,
        fileExists: () => false,
      });
    });

    it("rejects node_modules files", () => {
      expect(pipeline.shouldTransform("/project/node_modules/lodash/index.ts")).toBe(false);
      expect(pipeline.shouldTransform("node_modules/pkg/file.ts")).toBe(false);
    });

    it("rejects declaration files", () => {
      expect(pipeline.shouldTransform("/project/src/types.d.ts")).toBe(false);
      expect(pipeline.shouldTransform("global.d.ts")).toBe(false);
    });

    it("rejects non-TypeScript/JavaScript files", () => {
      expect(pipeline.shouldTransform("/project/src/style.css")).toBe(false);
      expect(pipeline.shouldTransform("/project/data.json")).toBe(false);
      expect(pipeline.shouldTransform("/project/readme.md")).toBe(false);
    });

    it("accepts TypeScript files", () => {
      expect(pipeline.shouldTransform("/project/src/app.ts")).toBe(true);
      expect(pipeline.shouldTransform("/project/src/component.tsx")).toBe(true);
    });

    it("accepts JavaScript files", () => {
      expect(pipeline.shouldTransform("/project/src/legacy.js")).toBe(true);
      expect(pipeline.shouldTransform("/project/src/component.jsx")).toBe(true);
    });

    it("handles files with multiple dots in name", () => {
      expect(pipeline.shouldTransform("/project/src/app.test.ts")).toBe(true);
      expect(pipeline.shouldTransform("/project/src/app.spec.tsx")).toBe(true);
    });

    it("handles files with .d.ts in the middle of path", () => {
      // This is a directory named "d.ts", not a declaration file
      expect(pipeline.shouldTransform("/project/d.ts/file.ts")).toBe(true);
    });

    it("rejects node_modules nested anywhere in path", () => {
      expect(pipeline.shouldTransform("/project/vendor/node_modules/pkg/index.ts")).toBe(false);
      expect(pipeline.shouldTransform("/a/b/node_modules/c/d.ts")).toBe(false);
    });
  });
});

describe("TS Plugin Cache Behavior", () => {
  // ==========================================================================
  // Attack 5: Cache Invalidation Edge Cases
  // ==========================================================================
  describe("cache invalidation scenarios", () => {
    it("invalidates on content change", () => {
      let content = "const x = 1;";
      const pipeline = new TransformationPipeline({}, ["file.ts"], {
        readFile: () => content,
        fileExists: (f) => f === "file.ts",
      });

      const result1 = pipeline.transform("file.ts");
      expect(result1.original).toBe("const x = 1;");

      // Change content
      content = "const x = 2;";
      pipeline.invalidate("file.ts");

      const result2 = pipeline.transform("file.ts");
      expect(result2.original).toBe("const x = 2;");
    });

    it("handles invalidateAll correctly", () => {
      let callCount = 0;
      const pipeline = new TransformationPipeline({}, ["file.ts"], {
        readFile: () => {
          callCount++;
          return "const x = 1;";
        },
        fileExists: (f) => f === "file.ts",
      });

      pipeline.transform("file.ts");
      const countAfterFirst = callCount;

      pipeline.invalidateAll();
      pipeline.transform("file.ts");
      
      // Should have re-read the file after invalidateAll
      expect(callCount).toBeGreaterThan(countAfterFirst);
    });

    it("getCacheStats returns valid statistics", () => {
      const pipeline = new TransformationPipeline({}, [], {
        readFile: () => undefined,
        fileExists: () => false,
      });

      const stats = pipeline.getCacheStats();
      expect(stats).toHaveProperty("preprocessedCount");
      expect(stats).toHaveProperty("transformedCount");
      expect(stats).toHaveProperty("accessOrderLength");
      expect(typeof stats.preprocessedCount).toBe("number");
    });
  });

  // ==========================================================================
  // Attack 6: Cache with Missing Files
  // ==========================================================================
  describe("cache with missing or invalid files", () => {
    it("handles missing file gracefully", () => {
      const pipeline = new TransformationPipeline({}, ["missing.ts"], {
        readFile: () => undefined,
        fileExists: () => false,
      });

      const result = pipeline.transform("missing.ts");
      expect(result.code).toBe("");
      expect(result.changed).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.diagnostics[0].severity).toBe("error");
    });

    it("handles file that becomes missing after cache", () => {
      let fileExists = true;
      const pipeline = new TransformationPipeline({}, ["file.ts"], {
        readFile: () => (fileExists ? "const x = 1;" : undefined),
        fileExists: () => fileExists,
      });

      const result1 = pipeline.transform("file.ts");
      expect(result1.original).toBe("const x = 1;");

      // File disappears
      fileExists = false;
      pipeline.invalidate("file.ts");

      const result2 = pipeline.transform("file.ts");
      expect(result2.code).toBe("");
    });
  });
});

describe("TS Plugin Error Recovery", () => {
  // ==========================================================================
  // Attack 7: Malformed Input Handling
  // ==========================================================================
  describe("malformed TypeScript input", () => {
    it("handles syntactically invalid code", () => {
      const result = transformCode("const x = {{{{{", { fileName: "bad.ts" });
      // Should not crash, may have diagnostics
      expect(result).toBeDefined();
      expect(typeof result.code).toBe("string");
    });

    it("handles empty file", () => {
      const result = transformCode("", { fileName: "empty.ts" });
      expect(result.code).toBe("");
      expect(result.changed).toBe(false);
    });

    it("handles file with only whitespace", () => {
      const result = transformCode("   \n\t\n   ", { fileName: "whitespace.ts" });
      expect(result).toBeDefined();
      // Whitespace-only files may be normalized by the printer, so we only check
      // that the output is still valid (may be changed or unchanged)
      expect(typeof result.code).toBe("string");
    });

    it("handles file with only comments", () => {
      const result = transformCode("// just a comment\n/* block */", { fileName: "comments.ts" });
      expect(result).toBeDefined();
    });

    it("handles extremely long single line", () => {
      const longLine = "const x = " + "1 + ".repeat(10000) + "1;";
      const result = transformCode(longLine, { fileName: "long.ts" });
      expect(result).toBeDefined();
    });
  });

  // ==========================================================================
  // Attack 8: Unicode and Special Characters
  // ==========================================================================
  describe("unicode and special character handling", () => {
    it("handles unicode identifiers", () => {
      const result = transformCode("const 日本語 = 1; const émojis = '🎉';", {
        fileName: "unicode.ts",
      });
      expect(result).toBeDefined();
      expect(result.code).toContain("日本語");
    });

    it("handles BOM at start of file", () => {
      const withBom = "\uFEFFconst x = 1;";
      const result = transformCode(withBom, { fileName: "bom.ts" });
      expect(result).toBeDefined();
    });

    it("handles null characters in strings", () => {
      const result = transformCode('const x = "hello\\0world";', { fileName: "null.ts" });
      expect(result).toBeDefined();
    });

    it("handles mixed line endings", () => {
      const mixed = "const x = 1;\r\nconst y = 2;\nconst z = 3;\rconst w = 4;";
      const result = transformCode(mixed, { fileName: "mixed.ts" });
      expect(result).toBeDefined();
    });
  });
});

describe("TS Plugin Range Mapping Edge Cases", () => {
  // ==========================================================================
  // Attack 9: TextRange Edge Cases
  // ==========================================================================
  describe("TextRange mapping edge cases", () => {
    const mapper = new IdentityPositionMapper();

    it("handles zero-length range at position zero", () => {
      const range: TextRange = { start: 0, length: 0 };
      expect(mapper.mapRange(range, "toTransformed")).toEqual(range);
    });

    it("handles range spanning entire file", () => {
      const range: TextRange = { start: 0, length: 1000000 };
      expect(mapper.mapRange(range, "toOriginal")).toEqual(range);
    });

    it("handles negative length (malformed)", () => {
      // TypeScript TextSpan shouldn't have negative length, but test graceful handling
      const range: TextRange = { start: 10, length: -5 };
      const result = mapper.mapRange(range, "toTransformed");
      expect(result).toEqual(range); // Identity preserves exactly
    });
  });

  // ==========================================================================
  // Attack 10: Diagnostic Mapping
  // ==========================================================================
  describe("diagnostic mapping edge cases", () => {
    const mapper = new IdentityPositionMapper();

    it("handles diagnostic with zero length", () => {
      const diag: ts.Diagnostic = {
        file: undefined,
        start: 10,
        length: 0,
        messageText: "warning",
        category: 1,
        code: 1000,
      };
      const mapped = mapper.mapDiagnostic(diag);
      expect(mapped.start).toBe(10);
      expect(mapped.length).toBe(0);
    });

    it("handles diagnostic with no file", () => {
      const diag: ts.Diagnostic = {
        file: undefined,
        start: undefined,
        length: undefined,
        messageText: "global error",
        category: 0,
        code: 2000,
      };
      const mapped = mapper.mapDiagnostic(diag);
      expect(mapped).toBe(diag);
    });

    it("handles diagnostic with nested message text", () => {
      const diag: ts.Diagnostic = {
        file: undefined,
        start: 5,
        length: 10,
        messageText: {
          messageText: "outer",
          category: 1,
          code: 3000,
          next: [{ messageText: "inner", category: 1, code: 3001 }],
        },
        category: 1,
        code: 3000,
      };
      const mapped = mapper.mapDiagnostic(diag);
      expect(mapped.start).toBe(5);
    });
  });
});

/**
 * Tests for PositionMapper
 */

import { describe, it, expect } from "vitest";
import {
  createPositionMapper,
  SourceMapPositionMapper,
  IdentityPositionMapper,
} from "../src/position-mapper.js";
import type { RawSourceMap } from "@typesugar/preprocessor";

describe("PositionMapper", () => {
  describe("IdentityPositionMapper", () => {
    it("maps positions to themselves", () => {
      const mapper = new IdentityPositionMapper();

      expect(mapper.toOriginal(0)).toBe(0);
      expect(mapper.toOriginal(100)).toBe(100);
      expect(mapper.toTransformed(0)).toBe(0);
      expect(mapper.toTransformed(100)).toBe(100);
    });

    it("maps ranges unchanged", () => {
      const mapper = new IdentityPositionMapper();

      const range = { pos: 10, end: 50 };
      expect(mapper.mapRange(range, "toOriginal")).toEqual(range);
      expect(mapper.mapRange(range, "toTransformed")).toEqual(range);
    });

    it("maps diagnostics unchanged", () => {
      const mapper = new IdentityPositionMapper();

      const diag = {
        start: 10,
        length: 5,
        file: undefined,
        category: 1,
        code: 1234,
        messageText: "test",
      } as any;

      const mapped = mapper.mapDiagnostic(diag);
      expect(mapped.start).toBe(10);
      expect(mapped.length).toBe(5);
    });
  });

  describe("SourceMapPositionMapper", () => {
    it("maps positions using source map", () => {
      // Simple source map: original line 1 maps to generated line 1
      const sourceMap: RawSourceMap = {
        version: 3,
        sources: ["original.ts"],
        names: [],
        mappings: "AAAA", // Single segment: col 0 → source 0, line 0, col 0
      };

      const original = "const x = 1;";
      const transformed = "const x = 1;";

      const mapper = new SourceMapPositionMapper(sourceMap, original, transformed);

      // Position 0 should map to position 0
      expect(mapper.toOriginal(0)).toBe(0);
    });

    it("handles multi-line source maps", () => {
      // Source map with multiple lines
      const sourceMap: RawSourceMap = {
        version: 3,
        sources: ["original.ts"],
        names: [],
        // Two lines: both map back to source
        mappings: "AAAA;AACA",
      };

      const original = "const x = 1;\nconst y = 2;";
      const transformed = "const x = 1;\nconst y = 2;";

      const mapper = new SourceMapPositionMapper(sourceMap, original, transformed);

      // Both lines should be mappable
      expect(mapper.toOriginal(0)).toBe(0);
    });

    it("returns null for unmapped positions", () => {
      const sourceMap: RawSourceMap = {
        version: 3,
        sources: [],
        names: [],
        mappings: "",
      };

      const mapper = new SourceMapPositionMapper(sourceMap, "", "");

      // No mappings, should return null
      expect(mapper.toOriginal(100)).toBeNull();
    });
  });

  describe("createPositionMapper", () => {
    it("returns IdentityPositionMapper when source map is null", () => {
      const mapper = createPositionMapper(null, "code", "code");

      expect(mapper).toBeInstanceOf(IdentityPositionMapper);
    });

    it("returns SourceMapPositionMapper when source map exists and content changed", () => {
      const sourceMap: RawSourceMap = {
        version: 3,
        sources: ["test.ts"],
        names: [],
        mappings: "AAAA",
      };

      // Different content to trigger SourceMapPositionMapper
      const mapper = createPositionMapper(sourceMap, "const x = 1;", "const y = 2;");

      expect(mapper).toBeInstanceOf(SourceMapPositionMapper);
    });

    it("returns IdentityPositionMapper when content is unchanged", () => {
      const sourceMap: RawSourceMap = {
        version: 3,
        sources: ["test.ts"],
        names: [],
        mappings: "AAAA",
      };

      // Same content - should use identity mapper
      const mapper = createPositionMapper(sourceMap, "const x = 1;", "const x = 1;");

      expect(mapper).toBeInstanceOf(IdentityPositionMapper);
    });

    it("returns IdentityPositionMapper for empty source map", () => {
      const sourceMap: RawSourceMap = {
        version: 3,
        sources: [],
        names: [],
        mappings: "",
      };

      const mapper = createPositionMapper(sourceMap, "", "");

      // With empty mappings, should fall back to identity
      expect(mapper.toOriginal(0)).toBe(0);
    });
  });

  describe("mapRange", () => {
    it("maps ranges in both directions", () => {
      const sourceMap: RawSourceMap = {
        version: 3,
        sources: ["test.ts"],
        names: [],
        mappings: "AAAA",
      };

      const mapper = new SourceMapPositionMapper(
        sourceMap,
        "const x = 1;",
        "const x = 1;"
      );

      const range = { pos: 0, end: 5 };

      // Should map the range
      const toOrig = mapper.mapRange(range, "toOriginal");
      const toTrans = mapper.mapRange(range, "toTransformed");

      expect(toOrig).toBeDefined();
      expect(toTrans).toBeDefined();
    });

    it("returns null when start position is unmapped", () => {
      const sourceMap: RawSourceMap = {
        version: 3,
        sources: [],
        names: [],
        mappings: "",
      };

      const mapper = new SourceMapPositionMapper(sourceMap, "", "");

      const range = { pos: 100, end: 200 };
      const result = mapper.mapRange(range, "toOriginal");

      expect(result).toBeNull();
    });
  });

  describe("mapDiagnostic", () => {
    it("maps diagnostic positions", () => {
      const sourceMap: RawSourceMap = {
        version: 3,
        sources: ["test.ts"],
        names: [],
        mappings: "AAAA",
      };

      const mapper = new SourceMapPositionMapper(
        sourceMap,
        "const x = 1;",
        "const x = 1;"
      );

      const diag = {
        start: 0,
        length: 5,
        file: undefined,
        category: 1,
        code: 1234,
        messageText: "test error",
      } as any;

      const mapped = mapper.mapDiagnostic(diag);

      expect(mapped).toBeDefined();
      expect(mapped.messageText).toBe("test error");
    });

    it("handles diagnostic with no start position", () => {
      const mapper = new IdentityPositionMapper();

      const diag = {
        start: undefined,
        length: undefined,
        file: undefined,
        category: 1,
        code: 1234,
        messageText: "global error",
      } as any;

      const mapped = mapper.mapDiagnostic(diag);

      expect(mapped.start).toBeUndefined();
      expect(mapped.length).toBeUndefined();
    });
  });
});

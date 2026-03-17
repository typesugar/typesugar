/**
 * Tests for PositionMapper
 */

import { describe, it, expect } from "vitest";
import {
  createPositionMapper,
  SourceMapPositionMapper,
  IdentityPositionMapper,
} from "../src/position-mapper.js";
import type { RawSourceMap } from "@typesugar/core";

describe("IdentityPositionMapper", () => {
  it("returns same position for both directions", () => {
    const mapper = new IdentityPositionMapper();

    expect(mapper.toOriginal(0)).toBe(0);
    expect(mapper.toOriginal(100)).toBe(100);
    expect(mapper.toTransformed(0)).toBe(0);
    expect(mapper.toTransformed(100)).toBe(100);
  });

  it("maps ranges unchanged", () => {
    const mapper = new IdentityPositionMapper();

    const range = { start: 10, length: 40 };
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
    } as import("typescript").Diagnostic;

    const mapped = mapper.mapDiagnostic(diag);
    expect(mapped.start).toBe(10);
    expect(mapped.length).toBe(5);
  });
});

describe("SourceMapPositionMapper", () => {
  it("maps positions using source map", () => {
    const sourceMap: RawSourceMap = {
      version: 3,
      sources: ["original.ts"],
      names: [],
      mappings: "AAAA",
    };

    const original = "const x = 1;";
    const transformed = "const x = 1;";

    const mapper = new SourceMapPositionMapper(sourceMap, original, transformed);

    expect(mapper.toOriginal(0)).toBe(0);
    expect(mapper.toTransformed(0)).toBe(0);
  });

  it("handles multi-line source maps", () => {
    const sourceMap: RawSourceMap = {
      version: 3,
      sources: ["original.ts"],
      names: [],
      mappings: "AAAA;AACA",
    };

    const original = "const x = 1;\nconst y = 2;";
    const transformed = "const x = 1;\nconst y = 2;";

    const mapper = new SourceMapPositionMapper(sourceMap, original, transformed);

    expect(mapper.toOriginal(0)).toBe(0);
    expect(mapper.toOriginal(13)).toBe(13);
  });

  it("returns null for unmapped positions", () => {
    const sourceMap: RawSourceMap = {
      version: 3,
      sources: [],
      names: [],
      mappings: "",
    };

    const mapper = new SourceMapPositionMapper(sourceMap, "", "");

    expect(mapper.toOriginal(100)).toBeNull();
    expect(mapper.toTransformed(100)).toBeNull();
  });

  it("maps ranges in both directions", () => {
    const sourceMap: RawSourceMap = {
      version: 3,
      sources: ["test.ts"],
      names: [],
      mappings: "AAAA",
    };

    const mapper = new SourceMapPositionMapper(sourceMap, "const x = 1;", "const x = 1;");

    const range = { start: 0, length: 5 };
    const toOrig = mapper.mapRange(range, "toOriginal");
    const toTrans = mapper.mapRange(range, "toTransformed");

    expect(toOrig).toBeDefined();
    expect(toTrans).toBeDefined();
  });

  it("maps diagnostic positions", () => {
    const sourceMap: RawSourceMap = {
      version: 3,
      sources: ["test.ts"],
      names: [],
      mappings: "AAAA",
    };

    const mapper = new SourceMapPositionMapper(sourceMap, "const x = 1;", "const x = 1;");

    const diag = {
      start: 0,
      length: 5,
      file: undefined,
      category: 1,
      code: 1234,
      messageText: "test error",
    } as import("typescript").Diagnostic;

    const mapped = mapper.mapDiagnostic(diag);

    expect(mapped).toBeDefined();
    expect(mapped.messageText).toBe("test error");
  });

  it("returns null when mapRange start position is unmapped", () => {
    const sourceMap: RawSourceMap = {
      version: 3,
      sources: [],
      names: [],
      mappings: "",
    };

    const mapper = new SourceMapPositionMapper(sourceMap, "", "");

    const range = { start: 100, length: 50 };
    const result = mapper.mapRange(range, "toOriginal");

    expect(result).toBeNull();
  });

  it("handles diagnostic with no start position", () => {
    const sourceMap: RawSourceMap = {
      version: 3,
      sources: ["test.ts"],
      names: [],
      mappings: "AAAA",
    };

    const mapper = new SourceMapPositionMapper(sourceMap, "x", "x");

    const diag = {
      start: undefined,
      length: undefined,
      file: undefined,
      category: 1,
      code: 1234,
      messageText: "global error",
    } as import("typescript").Diagnostic;

    const mapped = mapper.mapDiagnostic(diag);

    expect(mapped.start).toBeUndefined();
    expect(mapped.length).toBeUndefined();
  });
});

describe("createPositionMapper", () => {
  it("returns IdentityPositionMapper when no source map", () => {
    const mapper = createPositionMapper(null, "code", "code");

    expect(mapper).toBeInstanceOf(IdentityPositionMapper);
  });

  it("returns IdentityPositionMapper when content is unchanged", () => {
    const sourceMap: RawSourceMap = {
      version: 3,
      sources: ["test.ts"],
      names: [],
      mappings: "AAAA",
    };

    const mapper = createPositionMapper(sourceMap, "const x = 1;", "const x = 1;");

    expect(mapper).toBeInstanceOf(IdentityPositionMapper);
  });

  it("returns SourceMapPositionMapper when source map provided and content changed", () => {
    const sourceMap: RawSourceMap = {
      version: 3,
      sources: ["test.ts"],
      names: [],
      mappings: "AAAA",
    };

    const mapper = createPositionMapper(sourceMap, "const x = 1;", "const y = 2;");

    expect(mapper).toBeInstanceOf(SourceMapPositionMapper);
  });
});

/**
 * Tests for source map utilities
 */

import { describe, it, expect } from "vitest";
import {
  composeSourceMaps,
  decodeMappings,
  decodeSourceMap,
  findOriginalPosition,
  findGeneratedPosition,
} from "../src/source-map-utils.js";
import type { RawSourceMap } from "@typesugar/core";

describe("decodeMappings", () => {
  it("decodes simple single-segment mapping", () => {
    // AAAA = [0, 0, 0, 0] (generated col, source index, source line, source col)
    const decoded = decodeMappings("AAAA");

    expect(decoded).toHaveLength(1);
    expect(decoded[0]).toHaveLength(1);
    expect(decoded[0][0]).toEqual({
      generatedColumn: 0,
      sourceIndex: 0,
      sourceLine: 0,
      sourceColumn: 0,
    });
  });

  it("decodes multi-segment, multi-line mapping", () => {
    // Two lines with one segment each: AAAA;AACA
    const decoded = decodeMappings("AAAA;AACA");

    expect(decoded).toHaveLength(2);
    expect(decoded[0]).toHaveLength(1);
    expect(decoded[0][0].generatedColumn).toBe(0);
    expect(decoded[1]).toHaveLength(1);
    expect(decoded[1][0].generatedColumn).toBe(0);
  });

  it("decodes empty mappings string", () => {
    const decoded = decodeMappings("");

    expect(decoded).toHaveLength(0);
  });

  it("decodes multiple segments on same line", () => {
    // AAAA = col 0, UAAU = col 10 (relative)
    const decoded = decodeMappings("AAAA,UAAU");

    expect(decoded).toHaveLength(1);
    expect(decoded[0]).toHaveLength(2);
    expect(decoded[0][0].generatedColumn).toBe(0);
    expect(decoded[0][1].generatedColumn).toBe(10);
  });

  it("throws on invalid VLQ characters", () => {
    expect(() => decodeMappings("!!!")).toThrow("Invalid VLQ character");
  });
});

describe("findOriginalPosition", () => {
  it("finds exact match on a segment", () => {
    const map: RawSourceMap = {
      version: 3,
      sources: ["test.ts"],
      names: [],
      mappings: "AAAA",
    };

    const decoded = decodeSourceMap(map);
    const result = findOriginalPosition(decoded, 0, 0);

    expect(result).toEqual({ line: 0, column: 0 });
  });

  it("finds nearest segment for position between segments", () => {
    // Two segments: col 0 and col 10
    const map: RawSourceMap = {
      version: 3,
      sources: ["test.ts"],
      names: [],
      mappings: "AAAA,UAAU",
    };

    const decoded = decodeSourceMap(map);
    // Column 5 is between 0 and 10 - should find segment at 0
    const result = findOriginalPosition(decoded, 0, 5);

    expect(result).toBeDefined();
    expect(result?.line).toBe(0);
    expect(result?.column).toBe(5); // 0 + offset 5
  });

  it("returns null for out of range line", () => {
    const map: RawSourceMap = {
      version: 3,
      sources: ["test.ts"],
      names: [],
      mappings: "AAAA",
    };

    const decoded = decodeSourceMap(map);
    expect(findOriginalPosition(decoded, -1, 0)).toBeNull();
    expect(findOriginalPosition(decoded, 10, 0)).toBeNull();
  });

  it("returns null for empty mappings", () => {
    const map: RawSourceMap = {
      version: 3,
      sources: [],
      names: [],
      mappings: "",
    };

    const decoded = decodeSourceMap(map);
    expect(findOriginalPosition(decoded, 0, 0)).toBeNull();
  });
});

describe("findGeneratedPosition", () => {
  it("finds exact match", () => {
    const map: RawSourceMap = {
      version: 3,
      sources: ["test.ts"],
      names: [],
      mappings: "AAAA",
    };

    const decoded = decodeSourceMap(map);
    const result = findGeneratedPosition(decoded, 0, 0, 0);

    expect(result).toEqual({ line: 0, column: 0 });
  });

  it("finds nearest match with column offset", () => {
    const map: RawSourceMap = {
      version: 3,
      sources: ["test.ts"],
      names: [],
      mappings: "AAAA",
    };

    const decoded = decodeSourceMap(map);
    const result = findGeneratedPosition(decoded, 0, 10, 0);

    expect(result).toBeDefined();
    expect(result?.line).toBe(0);
    expect(result?.column).toBe(10);
  });

  it("returns null when source not found", () => {
    const map: RawSourceMap = {
      version: 3,
      sources: ["test.ts"],
      names: [],
      mappings: "AAAA",
    };

    const decoded = decodeSourceMap(map);
    expect(findGeneratedPosition(decoded, 10, 0, 0)).toBeNull();
  });
});

describe("decodeSourceMap", () => {
  it("decodes from object", () => {
    const map: RawSourceMap = {
      version: 3,
      sources: ["test.ts"],
      sourceRoot: "/src",
      names: [],
      mappings: "AAAA;AACA",
    };

    const decoded = decodeSourceMap(map);

    expect(decoded.version).toBe(3);
    expect(decoded.sources).toEqual(["test.ts"]);
    expect(decoded.sourceRoot).toBe("/src");
    expect(decoded.mappings).toHaveLength(2);
  });

  it("decodes from object parsed from JSON string", () => {
    const json = JSON.stringify({
      version: 3,
      sources: ["input.ts"],
      names: [],
      mappings: "AAAA",
    });

    const map = JSON.parse(json) as RawSourceMap;
    const decoded = decodeSourceMap(map);

    expect(decoded.version).toBe(3);
    expect(decoded.sources).toEqual(["input.ts"]);
    expect(decoded.mappings).toHaveLength(1);
  });
});

describe("composeSourceMaps", () => {
  it("returns null when both maps are null", () => {
    const result = composeSourceMaps(null, null);
    expect(result).toBeNull();
  });

  it("returns transform map when preprocess map is null", () => {
    const map: RawSourceMap = {
      version: 3,
      sources: ["b.ts"],
      names: [],
      mappings: "AAAA",
    };

    const result = composeSourceMaps(null, map);
    expect(result).toEqual(map);
  });

  it("returns preprocess map when transform map is null", () => {
    const map: RawSourceMap = {
      version: 3,
      sources: ["a.ts"],
      names: [],
      mappings: "AAAA",
    };

    const result = composeSourceMaps(map, null);
    expect(result).toEqual(map);
  });

  it("composes two valid maps", () => {
    const map1: RawSourceMap = {
      version: 3,
      sources: ["original.ts"],
      names: [],
      mappings: "AAAA",
    };

    const map2: RawSourceMap = {
      version: 3,
      sources: ["intermediate.ts"],
      names: [],
      sourcesContent: ["content"],
      mappings: "AAAA",
    };

    const result = composeSourceMaps(map1, map2);

    expect(result).toBeDefined();
    expect(result?.version).toBe(3);
    expect(result?.sources).toBeDefined();
  });
});

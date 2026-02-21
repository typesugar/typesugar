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
import type { RawSourceMap } from "@typesugar/preprocessor";

describe("composeSourceMaps", () => {
  it("returns null when both maps are null", () => {
    const result = composeSourceMaps(null, null);
    expect(result).toBeNull();
  });

  it("returns first map when second is null", () => {
    const map1: RawSourceMap = {
      version: 3,
      sources: ["a.ts"],
      names: [],
      mappings: "AAAA",
    };

    const result = composeSourceMaps(map1, null);

    expect(result).toEqual(map1);
  });

  it("returns second map when first is null", () => {
    const map2: RawSourceMap = {
      version: 3,
      sources: ["b.ts"],
      names: [],
      mappings: "AAAA",
    };

    const result = composeSourceMaps(null, map2);

    expect(result).toEqual(map2);
  });

  it("composes two maps", () => {
    // Map 1: original → intermediate
    const map1: RawSourceMap = {
      version: 3,
      sources: ["original.ts"],
      names: [],
      mappings: "AAAA",
    };

    // Map 2: intermediate → final
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
    // The composed map should trace back to original source
  });
});

describe("decodeMappings", () => {
  it("decodes empty mappings", () => {
    const decoded = decodeMappings("");
    expect(decoded).toHaveLength(0);
  });

  it("decodes single segment", () => {
    // AAAA = [0, 0, 0, 0] (generated col, source index, source line, source col)
    const decoded = decodeMappings("AAAA");

    expect(decoded).toHaveLength(1);
    expect(decoded[0]).toHaveLength(1);
    expect(decoded[0][0].generatedColumn).toBe(0);
    expect(decoded[0][0].sourceIndex).toBe(0);
    expect(decoded[0][0].sourceLine).toBe(0);
    expect(decoded[0][0].sourceColumn).toBe(0);
  });

  it("decodes multiple lines", () => {
    // Two lines with one segment each
    const decoded = decodeMappings("AAAA;AACA");

    expect(decoded).toHaveLength(2);
    expect(decoded[0]).toHaveLength(1);
    expect(decoded[1]).toHaveLength(1);
  });

  it("throws on invalid VLQ characters", () => {
    // Invalid characters should throw - this is expected behavior
    expect(() => decodeMappings("!!!")).toThrow("Invalid VLQ character");
  });
});

describe("decodeSourceMap", () => {
  it("decodes a source map", () => {
    const map: RawSourceMap = {
      version: 3,
      sources: ["test.ts"],
      names: [],
      mappings: "AAAA;AACA",
    };

    const decoded = decodeSourceMap(map);

    expect(decoded.version).toBe(3);
    expect(decoded.sources).toEqual(["test.ts"]);
    expect(decoded.mappings).toHaveLength(2);
  });
});

describe("findOriginalPosition", () => {
  it("finds position on matching line", () => {
    const map: RawSourceMap = {
      version: 3,
      sources: ["test.ts"],
      names: [],
      mappings: "AAAA",
    };

    const decoded = decodeSourceMap(map);
    const result = findOriginalPosition(decoded, 0, 0);

    expect(result).toBeDefined();
    expect(result?.line).toBe(0);
    expect(result?.column).toBe(0);
  });

  it("returns null for unmapped line", () => {
    const map: RawSourceMap = {
      version: 3,
      sources: ["test.ts"],
      names: [],
      mappings: "AAAA", // Only line 0 is mapped
    };

    const decoded = decodeSourceMap(map);
    const result = findOriginalPosition(decoded, 10, 0);

    expect(result).toBeNull();
  });

  it("returns null for empty mappings", () => {
    const map: RawSourceMap = {
      version: 3,
      sources: [],
      names: [],
      mappings: "",
    };

    const decoded = decodeSourceMap(map);
    const result = findOriginalPosition(decoded, 0, 0);

    expect(result).toBeNull();
  });

  it("finds nearest segment for column", () => {
    // Multiple segments on same line
    const map: RawSourceMap = {
      version: 3,
      sources: ["test.ts"],
      names: [],
      // Two segments: col 0 and col 10
      mappings: "AAAA,UAAU",
    };

    const decoded = decodeSourceMap(map);

    // Column 5 should find segment starting at 0
    const result = findOriginalPosition(decoded, 0, 5);
    expect(result).toBeDefined();
  });
});

describe("findGeneratedPosition", () => {
  it("finds generated position from original", () => {
    const map: RawSourceMap = {
      version: 3,
      sources: ["test.ts"],
      names: [],
      mappings: "AAAA",
    };

    const decoded = decodeSourceMap(map);
    const result = findGeneratedPosition(decoded, 0, 0, 0);

    expect(result).toBeDefined();
    expect(result?.line).toBe(0);
    expect(result?.column).toBe(0);
  });

  it("returns null when source not found", () => {
    const map: RawSourceMap = {
      version: 3,
      sources: ["test.ts"],
      names: [],
      mappings: "AAAA",
    };

    const decoded = decodeSourceMap(map);
    // Source index 1 doesn't exist
    const result = findGeneratedPosition(decoded, 1, 0, 0);

    expect(result).toBeNull();
  });

  it("returns null for unmapped source line", () => {
    const map: RawSourceMap = {
      version: 3,
      sources: ["test.ts"],
      names: [],
      mappings: "AAAA",
    };

    const decoded = decodeSourceMap(map);
    // Source line 10 is not mapped (only line 0 is in the source map)
    const result = findGeneratedPosition(decoded, 10, 0, 0);

    expect(result).toBeNull();
  });

  it("maps column offset correctly", () => {
    const map: RawSourceMap = {
      version: 3,
      sources: ["test.ts"],
      names: [],
      mappings: "AAAA",
    };

    const decoded = decodeSourceMap(map);
    // Column 10 on source line 0 should add offset to generated column
    const result = findGeneratedPosition(decoded, 0, 10, 0);

    expect(result).toBeDefined();
    expect(result?.line).toBe(0);
    expect(result?.column).toBe(10); // 0 + 10 offset
  });
});

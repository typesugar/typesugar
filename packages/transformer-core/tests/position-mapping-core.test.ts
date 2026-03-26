/**
 * Tests for PositionMapperCore — the TS-free position mapping interface.
 *
 * These tests verify that the core position mapping works correctly
 * without any TypeScript dependency, making it usable in browser contexts
 * (playground web worker, Monaco adapter).
 */

import { describe, it, expect } from "vitest";
import {
  createPositionMapperCore,
  SourceMapPositionMapperCore,
  IdentityPositionMapperCore,
  type PositionMapperCore,
} from "../src/position-mapping-core.js";
import { decodeMappings } from "../src/source-map-utils.js";
import type { RawSourceMap } from "@typesugar/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal source map from line mappings (origLine → genLine, 1:1 column) */
function buildSimpleSourceMap(
  original: string,
  transformed: string,
  lineMapping: Array<[number, number]> // [origLine, genLine] pairs (0-based)
): RawSourceMap {
  // Build VLQ mappings manually
  // Each entry: genCol=0, sourceIdx=0, sourceLine=origLine, sourceCol=0
  const genLines = transformed.split("\n").length;
  const mappingLines: string[] = new Array(genLines).fill("");

  // Sort by generated line
  const sorted = [...lineMapping].sort((a, b) => a[1] - b[1]);

  let prevSourceLine = 0;
  for (const [origLine, genLine] of sorted) {
    // VLQ encode: genCol=0, sourceIdx=0, sourceLine=delta, sourceCol=0
    const srcLineDelta = origLine - prevSourceLine;
    prevSourceLine = origLine;
    // Simple VLQ: AAXA where X encodes the source line delta
    mappingLines[genLine] = encodeVLQSegment(0, 0, srcLineDelta, 0);
  }

  return {
    version: 3,
    sources: ["input.ts"],
    names: [],
    mappings: mappingLines.join(";"),
  };
}

/** Encode a single VLQ segment (genCol, srcIdx, srcLine, srcCol) */
function encodeVLQSegment(genCol: number, srcIdx: number, srcLine: number, srcCol: number): string {
  return [genCol, srcIdx, srcLine, srcCol].map(encodeVLQ).join("");
}

function encodeVLQ(value: number): string {
  const VLQ_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let vlq = value < 0 ? (-value << 1) | 1 : value << 1;
  let result = "";
  do {
    let digit = vlq & 0x1f;
    vlq >>= 5;
    if (vlq > 0) digit |= 0x20;
    result += VLQ_CHARS[digit];
  } while (vlq > 0);
  return result;
}

// ---------------------------------------------------------------------------
// IdentityPositionMapperCore
// ---------------------------------------------------------------------------

describe("IdentityPositionMapperCore", () => {
  it("returns the same position for toOriginal", () => {
    const mapper = new IdentityPositionMapperCore();
    expect(mapper.toOriginal(0)).toBe(0);
    expect(mapper.toOriginal(42)).toBe(42);
    expect(mapper.toOriginal(999)).toBe(999);
  });

  it("returns the same position for toTransformed", () => {
    const mapper = new IdentityPositionMapperCore();
    expect(mapper.toTransformed(0)).toBe(0);
    expect(mapper.toTransformed(42)).toBe(42);
  });

  it("returns the same range for mapRange", () => {
    const mapper = new IdentityPositionMapperCore();
    const range = { start: 10, length: 5 };
    expect(mapper.mapRange(range, "toOriginal")).toEqual(range);
    expect(mapper.mapRange(range, "toTransformed")).toEqual(range);
  });
});

// ---------------------------------------------------------------------------
// createPositionMapperCore
// ---------------------------------------------------------------------------

describe("createPositionMapperCore", () => {
  it("returns IdentityPositionMapperCore when sourceMap is null", () => {
    const mapper = createPositionMapperCore(null, "const x = 1;", "const x = 1;");
    expect(mapper).toBeInstanceOf(IdentityPositionMapperCore);
  });

  it("returns IdentityPositionMapperCore when content is identical", () => {
    const code = "const x = 1;\n";
    const map: RawSourceMap = { version: 3, sources: [], names: [], mappings: "" };
    const mapper = createPositionMapperCore(map, code, code);
    expect(mapper).toBeInstanceOf(IdentityPositionMapperCore);
  });

  it("returns SourceMapPositionMapperCore when content differs", () => {
    const original = "const x = comptime(() => 1);\n";
    const transformed = "const x = 1;\n";
    const map = buildSimpleSourceMap(original, transformed, [[0, 0]]);
    const mapper = createPositionMapperCore(map, original, transformed);
    expect(mapper).toBeInstanceOf(SourceMapPositionMapperCore);
  });
});

// ---------------------------------------------------------------------------
// SourceMapPositionMapperCore — basic mapping
// ---------------------------------------------------------------------------

describe("SourceMapPositionMapperCore", () => {
  it("maps offset on a 1:1 mapped line correctly", () => {
    const original = "line0\nline1\nline2\n";
    const transformed = "LINE0\nLINE1\nLINE2\n";
    // All three lines map 1:1
    const map = buildSimpleSourceMap(original, transformed, [
      [0, 0],
      [1, 1],
      [2, 2],
    ]);

    const mapper = new SourceMapPositionMapperCore(map, original, transformed);

    // Offset 0 (start of line 0) → start of line 0
    expect(mapper.toOriginal(0)).toBe(0);

    // Offset 6 (start of line 1 in transformed) → start of line 1 in original
    expect(mapper.toOriginal(6)).toBe(6);
  });

  it("maps with line shifts (expansion adds lines)", () => {
    // Original: 3 lines
    const original = "line0\nline1\nline2\n";
    // Transformed: 5 lines (2 expansion lines inserted before line1)
    const transformed = "line0\nEXP_A\nEXP_B\nline1\nline2\n";

    // line0→line0, line1→line3, line2→line4
    const map = buildSimpleSourceMap(original, transformed, [
      [0, 0],
      [1, 3],
      [2, 4],
    ]);

    const mapper = new SourceMapPositionMapperCore(map, original, transformed);

    // Transformed line 3 (offset 18 = "line0\nEXP_A\nEXP_B\n".length) → original line 1 (offset 6)
    expect(mapper.toOriginal(18)).toBe(6);
  });

  it("returns null for positions in generated code (no mapping)", () => {
    const original = "line0\nline1\n";
    const transformed = "line0\nGENERATED\nline1\n";

    // Only line0→line0 and line1→line2 are mapped
    const map = buildSimpleSourceMap(original, transformed, [
      [0, 0],
      [1, 2],
    ]);

    const mapper = new SourceMapPositionMapperCore(map, original, transformed);

    // Transformed line 1 (offset 6, "GENERATED") has no mapping
    expect(mapper.toOriginal(6)).toBeNull();
  });

  it("toTransformed maps original to transformed position", () => {
    const original = "line0\nline1\nline2\n";
    const transformed = "line0\nEXPANDED\nline1\nline2\n";

    const map = buildSimpleSourceMap(original, transformed, [
      [0, 0],
      [1, 2],
      [2, 3],
    ]);

    const mapper = new SourceMapPositionMapperCore(map, original, transformed);

    // Original line 1 (offset 6) → transformed line 2 (offset 15 = "line0\nEXPANDED\n".length)
    const result = mapper.toTransformed(6);
    expect(result).toBe(15);
  });

  it("round-trips correctly for mapped positions", () => {
    const original = "aaa\nbbb\nccc\n";
    const transformed = "aaa\nXXX\nbbb\nccc\n";

    const map = buildSimpleSourceMap(original, transformed, [
      [0, 0],
      [1, 2],
      [2, 3],
    ]);

    const mapper = new SourceMapPositionMapperCore(map, original, transformed);

    // Round-trip: original → transformed → original
    for (const origOffset of [0, 4, 8]) {
      const xform = mapper.toTransformed(origOffset);
      expect(xform).not.toBeNull();
      const back = mapper.toOriginal(xform!);
      expect(back).toBe(origOffset);
    }
  });

  it("mapRange maps both endpoints", () => {
    const original = "const x = 1;\nconst y = 2;\n";
    const transformed = "const x = 1;\nEXPANDED;\nconst y = 2;\n";

    const map = buildSimpleSourceMap(original, transformed, [
      [0, 0],
      [1, 2],
    ]);

    const mapper = new SourceMapPositionMapperCore(map, original, transformed);

    // Map a range on transformed line 2 back to original line 1
    const range = mapper.mapRange({ start: 24, length: 5 }, "toOriginal");
    expect(range).not.toBeNull();
    expect(range!.start).toBe(14); // original line 1 start
  });

  it("mapRange returns null for unmappable positions", () => {
    const original = "line0\n";
    const transformed = "line0\nGENERATED\n";

    const map = buildSimpleSourceMap(original, transformed, [[0, 0]]);
    const mapper = new SourceMapPositionMapperCore(map, original, transformed);

    // Range starting in generated code
    const range = mapper.mapRange({ start: 6, length: 9 }, "toOriginal");
    expect(range).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// VLQ decoding integration (real source map format)
// ---------------------------------------------------------------------------

describe("integration with real VLQ source maps", () => {
  it("decodes a hand-built VLQ mapping correctly", () => {
    // Verify our test helper produces valid VLQ
    const mappings = encodeVLQSegment(0, 0, 0, 0) + ";" + encodeVLQSegment(0, 0, 1, 0);
    const decoded = decodeMappings(mappings);
    expect(decoded.length).toBe(2);
    expect(decoded[0][0].sourceLine).toBe(0);
    expect(decoded[1][0].sourceLine).toBe(1);
  });
});

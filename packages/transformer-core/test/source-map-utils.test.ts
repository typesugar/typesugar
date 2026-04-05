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

// ============================================================================
// PEP-036 Wave 1: Roundtrip & Composition Accuracy
// ============================================================================

describe("findOriginalPosition — boundary precision", () => {
  it("returns correct position at exact segment boundary", () => {
    // Two segments: col 0 → (0,0) and col 10 → (0,10)
    const map: RawSourceMap = {
      version: 3,
      sources: ["test.ts"],
      names: [],
      mappings: "AAAA,UAAU",
    };
    const decoded = decodeSourceMap(map);

    // Exact boundary at col 10
    const atBoundary = findOriginalPosition(decoded, 0, 10);
    expect(atBoundary).toEqual({ line: 0, column: 10 });
  });

  it("returns correct position one column before segment boundary", () => {
    const map: RawSourceMap = {
      version: 3,
      sources: ["test.ts"],
      names: [],
      mappings: "AAAA,UAAU",
    };
    const decoded = decodeSourceMap(map);

    // Col 9 is between segment at 0 and segment at 10 — maps via first segment + offset
    const beforeBoundary = findOriginalPosition(decoded, 0, 9);
    expect(beforeBoundary).toEqual({ line: 0, column: 9 });
  });

  it("returns correct position one column after segment boundary", () => {
    const map: RawSourceMap = {
      version: 3,
      sources: ["test.ts"],
      names: [],
      mappings: "AAAA,UAAU",
    };
    const decoded = decodeSourceMap(map);

    // Col 11 is past segment at 10 — maps via second segment + offset 1
    const afterBoundary = findOriginalPosition(decoded, 0, 11);
    expect(afterBoundary).toEqual({ line: 0, column: 11 });
  });
});

describe("forward → reverse roundtrip", () => {
  it("findGeneratedPosition → findOriginalPosition roundtrips to same position", () => {
    const map: RawSourceMap = {
      version: 3,
      sources: ["test.ts"],
      names: [],
      mappings: "AAAA;AACA;AACA",
    };
    const decoded = decodeSourceMap(map);

    // Forward: original (1, 5) → generated position
    const generated = findGeneratedPosition(decoded, 1, 5, 0);
    expect(generated).not.toBeNull();

    // Reverse: generated → original should return (1, 5)
    const original = findOriginalPosition(decoded, generated!.line, generated!.column);
    expect(original).toEqual({ line: 1, column: 5 });
  });

  it("roundtrips across multiple lines", () => {
    // 3 lines each mapping line N → line N
    const map: RawSourceMap = {
      version: 3,
      sources: ["test.ts"],
      names: [],
      mappings: "AAAA;AACA;AACA",
    };
    const decoded = decodeSourceMap(map);

    for (let line = 0; line < 3; line++) {
      const gen = findGeneratedPosition(decoded, line, 0, 0);
      expect(gen, `forward lookup for line ${line}`).not.toBeNull();
      const orig = findOriginalPosition(decoded, gen!.line, gen!.column);
      expect(orig, `reverse lookup for line ${line}`).toEqual({ line, column: 0 });
    }
  });
});

describe("source map roundtrip via ExpansionTracker", () => {
  // These tests generate a real source map, decode it, and verify lookups

  it("single expansion: every decoded segment resolves to correct original offset", async () => {
    const { ExpansionTracker } = await import("@typesugar/core");
    const ts = await import("typescript");

    const sourceCode = "const x = comptime(() => 5 * 5);";
    const sourceFile = ts.createSourceFile("test.ts", sourceCode, ts.ScriptTarget.Latest, true);

    // Find the call expression
    let callNode: ts.CallExpression | undefined;
    ts.forEachChild(sourceFile, (node) => {
      if (ts.isVariableStatement(node)) {
        const decl = node.declarationList.declarations[0];
        if (decl.initializer && ts.isCallExpression(decl.initializer)) {
          callNode = decl.initializer;
        }
      }
    });
    expect(callNode).toBeDefined();

    const tracker = new ExpansionTracker();
    tracker.recordExpansion("comptime", callNode!, sourceFile, "25");

    const map = tracker.generateSourceMap(sourceCode, "test.ts");
    expect(map).not.toBeNull();

    // Decode and verify every segment
    const decoded = decodeSourceMap(map!);
    for (let lineIdx = 0; lineIdx < decoded.mappings.length; lineIdx++) {
      for (const segment of decoded.mappings[lineIdx]) {
        if (segment.sourceLine === undefined || segment.sourceColumn === undefined) continue;

        // Forward: original position → generated
        const gen = findGeneratedPosition(decoded, segment.sourceLine, segment.sourceColumn, 0);
        expect(
          gen,
          `segment at gen col ${segment.generatedColumn} should forward-map`
        ).not.toBeNull();

        // Reverse: generated → original should match the segment's source position
        const orig = findOriginalPosition(decoded, lineIdx, segment.generatedColumn);
        expect(
          orig,
          `segment at gen col ${segment.generatedColumn} should reverse-map`
        ).not.toBeNull();
        expect(orig!.line).toBe(segment.sourceLine);
        expect(orig!.column).toBe(segment.sourceColumn);
      }
    }
  });

  it("expansion that grows: short original → long replacement", async () => {
    const { ExpansionTracker } = await import("@typesugar/core");
    const ts = await import("typescript");

    const sourceCode = "const x = m(); const y = 2;";
    const sourceFile = ts.createSourceFile("test.ts", sourceCode, ts.ScriptTarget.Latest, true);

    // Find m() call
    let callNode: ts.CallExpression | undefined;
    ts.forEachChild(sourceFile, (node) => {
      if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (decl.initializer && ts.isCallExpression(decl.initializer)) {
            if (!callNode) callNode = decl.initializer;
          }
        }
      }
    });
    expect(callNode).toBeDefined();

    // Replace m() (3 chars) with a long string (200 chars)
    const longReplacement = "a".repeat(200);
    const tracker = new ExpansionTracker();
    tracker.recordExpansion("m", callNode!, sourceFile, longReplacement);

    const expandedCode = tracker.generateExpandedCode(sourceCode, "test.ts");
    expect(expandedCode).not.toBeNull();
    expect(expandedCode).toContain(longReplacement);
    expect(expandedCode).toContain("const y = 2;");

    const map = tracker.generateSourceMap(sourceCode, "test.ts");
    expect(map).not.toBeNull();

    // "const y" in the expanded code should map back to "const y" in the original
    const origYOffset = sourceCode.indexOf("const y");
    const expandedYOffset = expandedCode!.indexOf("const y");
    expect(expandedYOffset).toBeGreaterThan(-1);

    // Use position mapper for offset-based verification
    const { SourceMapPositionMapperCore } = await import("../src/position-mapping-core.js");
    const mapper = new SourceMapPositionMapperCore(map!, sourceCode, expandedCode!);
    const mappedBack = mapper.toOriginal(expandedYOffset);
    expect(mappedBack, "code after grown expansion should map back correctly").toBe(origYOffset);
  });

  it("expansion that shrinks: long original → short replacement", async () => {
    const { ExpansionTracker } = await import("@typesugar/core");
    const ts = await import("typescript");

    const sourceCode = "const x = veryLongFunctionName(arg1, arg2, arg3, arg4); const y = 2;";
    const sourceFile = ts.createSourceFile("test.ts", sourceCode, ts.ScriptTarget.Latest, true);

    let callNode: ts.CallExpression | undefined;
    ts.forEachChild(sourceFile, (node) => {
      if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (decl.initializer && ts.isCallExpression(decl.initializer)) {
            if (!callNode) callNode = decl.initializer;
          }
        }
      }
    });
    expect(callNode).toBeDefined();

    // Replace long call with short "1"
    const tracker = new ExpansionTracker();
    tracker.recordExpansion("veryLongFunctionName", callNode!, sourceFile, "1");

    const expandedCode = tracker.generateExpandedCode(sourceCode, "test.ts");
    expect(expandedCode).not.toBeNull();
    expect(expandedCode).toContain("const x = 1;");
    expect(expandedCode).toContain("const y = 2;");

    const map = tracker.generateSourceMap(sourceCode, "test.ts");
    expect(map).not.toBeNull();

    const { SourceMapPositionMapperCore } = await import("../src/position-mapping-core.js");
    const mapper = new SourceMapPositionMapperCore(map!, sourceCode, expandedCode!);

    const origYOffset = sourceCode.indexOf("const y");
    const expandedYOffset = expandedCode!.indexOf("const y");
    const mappedBack = mapper.toOriginal(expandedYOffset);
    expect(mappedBack, "code after shrunk expansion should map back correctly").toBe(origYOffset);
  });

  it("identity-like expansion: same-length replacement", async () => {
    const { ExpansionTracker } = await import("@typesugar/core");
    const ts = await import("typescript");

    const sourceCode = "const x = abcd(); const y = 2;";
    const sourceFile = ts.createSourceFile("test.ts", sourceCode, ts.ScriptTarget.Latest, true);

    let callNode: ts.CallExpression | undefined;
    ts.forEachChild(sourceFile, (node) => {
      if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (decl.initializer && ts.isCallExpression(decl.initializer)) {
            if (!callNode) callNode = decl.initializer;
          }
        }
      }
    });
    expect(callNode).toBeDefined();

    // Replace "abcd()" (6 chars) with "wxyz()" (6 chars) — same length
    const tracker = new ExpansionTracker();
    tracker.recordExpansion("abcd", callNode!, sourceFile, "wxyz()");

    const expandedCode = tracker.generateExpandedCode(sourceCode, "test.ts");
    expect(expandedCode).not.toBeNull();

    const map = tracker.generateSourceMap(sourceCode, "test.ts");
    expect(map).not.toBeNull();

    const { SourceMapPositionMapperCore } = await import("../src/position-mapping-core.js");
    const mapper = new SourceMapPositionMapperCore(map!, sourceCode, expandedCode!);

    // "const y" should be at the same offset in both
    const origYOffset = sourceCode.indexOf("const y");
    const expandedYOffset = expandedCode!.indexOf("const y");
    expect(expandedYOffset).toBe(origYOffset); // same position since same length

    const mappedBack = mapper.toOriginal(expandedYOffset);
    expect(mappedBack).toBe(origYOffset);
  });
});

describe("composition roundtrip", () => {
  it("positions through composed map match direct lookup in innermost map", async () => {
    const { ExpansionTracker } = await import("@typesugar/core");
    const ts = await import("typescript");

    // Simulate a two-stage pipeline:
    // Stage 1 (preprocess): replace "MACRO1()" with "expanded1"
    // Stage 2 (transform): replace another call in the already-preprocessed code
    const originalCode = "const a = MACRO1(); const b = 2;";
    const sourceFile1 = ts.createSourceFile("test.ts", originalCode, ts.ScriptTarget.Latest, true);

    let call1: ts.CallExpression | undefined;
    ts.forEachChild(sourceFile1, (node) => {
      if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (decl.initializer && ts.isCallExpression(decl.initializer)) {
            if (!call1) call1 = decl.initializer;
          }
        }
      }
    });
    expect(call1).toBeDefined();

    const tracker1 = new ExpansionTracker();
    tracker1.recordExpansion("MACRO1", call1!, sourceFile1, "expanded1");

    const map1 = tracker1.generateSourceMap(originalCode, "test.ts");
    expect(map1).not.toBeNull();

    const intermediateCode = tracker1.generateExpandedCode(originalCode, "test.ts");
    expect(intermediateCode).not.toBeNull();

    // Compose: we only have one map here, but we test the composition with identity
    const { composeSourceMapChain } = await import("../src/source-map-utils.js");
    const composed = composeSourceMapChain([map1]);
    expect(composed).not.toBeNull();

    // Verify "const b" maps back through composed map
    const { SourceMapPositionMapperCore } = await import("../src/position-mapping-core.js");
    const mapper = new SourceMapPositionMapperCore(composed!, originalCode, intermediateCode!);

    const origBOffset = originalCode.indexOf("const b");
    const intermediateBOffset = intermediateCode!.indexOf("const b");
    const mappedBack = mapper.toOriginal(intermediateBOffset);
    expect(mappedBack).toBe(origBOffset);
  });
});

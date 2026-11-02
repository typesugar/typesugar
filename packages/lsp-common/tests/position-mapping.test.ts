/**
 * Span translation between a file's source and the expanded code TypeScript
 * sees (PEP-060 item 5): spans that must be the user's own text, and request
 * spans mapped as ranges.
 */

import { describe, it, expect } from "vitest";
import {
  mapSourceSpanToOriginal,
  mapTextSpanToTransformed,
  type PositionMapper,
} from "../src/position-mapping.js";

/**
 * A mapper over explicit [original, transformed, length] segments; anything
 * outside a segment is unmapped (a comment, or code a macro generated).
 */
function segmentMapper(segments: Array<[number, number, number]>): PositionMapper {
  return {
    toOriginal(t) {
      for (const [o, tr, len] of segments) if (t >= tr && t <= tr + len) return o + (t - tr);
      return null;
    },
    toTransformed(o) {
      for (const [orig, tr, len] of segments)
        if (o >= orig && o <= orig + len) return tr + (o - orig);
      return null;
    },
  };
}

describe("mapSourceSpanToOriginal", () => {
  // `@derive(Eq)` keeps the interface and adds a companion that names it again.
  const original = "/** @derive(Eq) */\ninterface Vec { x: number }\n";
  const transformed =
    "interface Vec { x: number }\n" +
    "export const VecEq = { equals: (a: Vec, b: Vec) => a === b };\n";
  const vecInOriginal = original.indexOf("Vec");
  const companionVec = transformed.indexOf("a: Vec") + 3;
  // The interface maps 1:1; the companion is attributed to the `@derive` tag.
  const mapper = segmentMapper([
    [vecInOriginal - "interface ".length, 0, "interface Vec { x: number }".length],
  ]);
  const attributed: PositionMapper = {
    toOriginal: (t) =>
      t >= 28 ? original.indexOf("@derive") + (t - companionVec) : mapper.toOriginal(t),
    toTransformed: mapper.toTransformed,
  };
  const texts = { original, transformed };

  it("maps a span that is the same text in the source", () => {
    const span = { start: transformed.indexOf("Vec"), length: 3 };
    expect(mapSourceSpanToOriginal(span, attributed, texts)).toEqual({
      start: vecInOriginal,
      length: 3,
    });
  });

  it("drops a span in generated code that the source map attributes to the macro", () => {
    const span = { start: companionVec, length: 3 };
    // The attributed mapping lands on "@de" of the tag: not the user's `Vec`.
    expect(attributed.toOriginal(companionVec)).toBe(original.indexOf("@derive"));
    expect(mapSourceSpanToOriginal(span, attributed, texts)).toBeNull();
  });

  it("drops a span whose start doesn't map at all", () => {
    expect(mapSourceSpanToOriginal({ start: 30, length: 3 }, mapper, texts)).toBeNull();
  });

  it("drops an insertion point in generated code", () => {
    const span = { start: companionVec, length: 0 };
    expect(mapSourceSpanToOriginal(span, attributed, texts)).toBeNull();
  });

  it("keeps an insertion point in the user's code", () => {
    const span = { start: transformed.indexOf("{"), length: 0 };
    expect(mapSourceSpanToOriginal(span, attributed, texts)).toEqual({
      start: original.indexOf("{"),
      length: 0,
    });
  });

  it("maps a multi-line span of user code the printer re-indented", () => {
    const src = "function f() {\n  return 1;\n}\n";
    const out = "function f() {\n    return 1;\n}\n";
    // Line 1 is shifted by two columns; lines 0 and 2 are identical.
    const lineMapper: PositionMapper = {
      toOriginal: (t) => (t < 15 ? t : t < 30 ? Math.max(15, t - 2) : t - 2),
      toTransformed: (o) => (o < 15 ? o : o < 28 ? o + 2 : o + 2),
    };
    const span = {
      start: out.indexOf("return"),
      length: out.indexOf("}") + 1 - out.indexOf("return"),
    };
    expect(mapSourceSpanToOriginal(span, lineMapper, { original: src, transformed: out })).toEqual({
      start: src.indexOf("return"),
      length: src.indexOf("}") + 1 - src.indexOf("return"),
    });
  });
});

describe("mapTextSpanToTransformed", () => {
  // original:    "// header\nconst a = 1;\n// trailer\n"
  // transformed: "const a = 1;\nconst gen = 2;\n"
  const original = "// header\nconst a = 1;\n// trailer\n";
  const transformed = "const a = 1;\nconst gen = 2;\n";
  const code = original.indexOf("const");
  const mapper = segmentMapper([[code, 0, "const a = 1;".length]]);
  const lengths = { original: original.length, transformed: transformed.length };

  it("maps a span whose ends are both in comments by clamping to the mapped code", () => {
    const span = { start: 0, length: original.length };
    expect(mapper.toTransformed(0)).toBeNull();
    const mapped = mapTextSpanToTransformed(span, mapper, lengths);
    // From the first mapped position to the end of the transformed code.
    expect(mapped).toEqual({ start: 0, length: transformed.length });
  });

  it("maps a span inside the code exactly", () => {
    const span = { start: code + 6, length: 1 };
    expect(mapTextSpanToTransformed(span, mapper, lengths)).toEqual({ start: 6, length: 1 });
  });

  it("returns null when nothing in the span maps", () => {
    const span = { start: 0, length: "// header".length };
    expect(mapTextSpanToTransformed(span, mapper, lengths)).toBeNull();
  });
});

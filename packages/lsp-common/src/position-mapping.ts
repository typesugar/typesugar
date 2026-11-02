/**
 * Shared position mapping utilities for IDE integration.
 *
 * Both the LSP server and the TS plugin language service need to map
 * positions between original and transformed source. These utilities
 * extract the identical logic from both paths.
 *
 * @see PEP-034 Wave 2
 */

import type * as ts from "typescript";

/**
 * Minimal interface for bidirectional position mapping.
 * Compatible with @typesugar/transformer-core's PositionMapper.
 */
export interface PositionMapper {
  toOriginal(transformedPos: number): number | null;
  toTransformed(originalPos: number): number | null;
}

/**
 * Identity mapper that returns positions unchanged.
 * Used when no transformation has been applied.
 */
export class IdentityPositionMapper implements PositionMapper {
  toOriginal(pos: number): number {
    return pos;
  }
  toTransformed(pos: number): number {
    return pos;
  }
}

/**
 * Map a TypeScript TextSpan from transformed coordinates back to original coordinates.
 *
 * Returns null if the span's start position cannot be mapped (e.g., it falls
 * in macro-generated code with no original source correspondence).
 *
 * The result may be ATTRIBUTED rather than literal: code a macro generated
 * maps back onto the macro's call site (a `@derive` companion onto its tag),
 * which is right for a diagnostic or a hover range. A span that has to be the
 * user's own text (an edit, a rename location, a reference) needs
 * `mapSourceSpanToOriginal` instead.
 */
export function mapTextSpanToOriginal(
  span: ts.TextSpan,
  mapper: PositionMapper
): ts.TextSpan | null {
  const originalStart = mapper.toOriginal(span.start);
  if (originalStart === null) return null;

  const originalEnd = mapper.toOriginal(span.start + span.length);
  const originalLength =
    originalEnd !== null ? Math.max(1, originalEnd - originalStart) : span.length;

  return { start: originalStart, length: originalLength };
}

/** Both sides of a transformed file, for checking what a span covers. */
export interface MappedTexts {
  /** The file as the user wrote it. */
  original: string;
  /** The expanded code TypeScript sees. */
  transformed: string;
}

/**
 * Map a span that must be the user's own source text back to original
 * coordinates: a rename location, a reference, or the range of an edit.
 *
 * Returns null when the span is in macro-generated code: an end doesn't map,
 * or the text there is different. The second case matters because the source
 * map attributes generated code to the macro that produced it (a `@derive`
 * companion's references to the type map onto the `@derive` tag), and
 * applying an edit there would corrupt the user's file.
 *
 * Whitespace is ignored in the comparison, because the expanded code is a
 * reprint (its indentation and line breaks are the printer's). An empty span
 * (an insertion point) is checked by the next non-whitespace character on
 * each side.
 */
export function mapSourceSpanToOriginal(
  span: ts.TextSpan,
  mapper: PositionMapper,
  texts: MappedTexts
): ts.TextSpan | null {
  const start = mapper.toOriginal(span.start);
  if (start === null) return null;
  const spanEnd = span.start + span.length;
  const end = span.length === 0 ? start : mapper.toOriginal(spanEnd);
  if (end === null || end < start) return null;

  const same =
    span.length === 0
      ? nextNonWhitespace(texts.original, start) === nextNonWhitespace(texts.transformed, spanEnd)
      : withoutWhitespace(texts.original.slice(start, end)) ===
        withoutWhitespace(texts.transformed.slice(span.start, spanEnd));
  return same ? { start, length: end - start } : null;
}

function withoutWhitespace(text: string): string {
  return text.replace(/\s+/g, "");
}

function nextNonWhitespace(text: string, from: number): string {
  const match = /\S/.exec(text.slice(from, from + 200));
  return match ? match[0] : "";
}

/**
 * Map a span of the original source to the transformed code as a RANGE: the
 * result covers every transformed position that comes from inside the span,
 * even when an end of the span has no mapping of its own (it falls in a
 * comment, or in text a macro replaced).
 *
 * - The start moves forward to the first mapped position in the span.
 * - The end moves forward to the next mapped position after the span (or the
 *   end of the transformed code), so the range can include a little more than
 *   the span: callers that need exactness filter what they get back by
 *   mapping it to the original.
 *
 * Returns null when nothing in the span maps (it is all comment or all
 * replaced text).
 */
export function mapTextSpanToTransformed(
  span: ts.TextSpan,
  mapper: PositionMapper,
  lengths: { original: number; transformed: number }
): ts.TextSpan | null {
  const spanEnd = Math.min(span.start + span.length, lengths.original);
  const first = firstMapped(mapper, span.start, spanEnd);
  if (first === null) return null;
  const end =
    mapper.toTransformed(spanEnd) ??
    firstMapped(mapper, spanEnd + 1, lengths.original)?.transformed ??
    lengths.transformed;
  const lo = Math.min(first.transformed, end);
  const hi = Math.max(first.transformed, end);
  return { start: lo, length: hi - lo };
}

/** The first original position in [from, to] that maps, with its image. */
function firstMapped(
  mapper: PositionMapper,
  from: number,
  to: number
): { original: number; transformed: number } | null {
  for (let pos = from; pos <= to; pos++) {
    const transformed = mapper.toTransformed(pos);
    if (transformed !== null) return { original: pos, transformed };
  }
  return null;
}

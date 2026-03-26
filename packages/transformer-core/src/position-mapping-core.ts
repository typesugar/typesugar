/**
 * PositionMapperCore — TypeScript-free bidirectional position mapping.
 *
 * This module provides position mapping between original and transformed code
 * WITHOUT any dependency on the `typescript` package. It can be used in:
 * - Browser web workers (playground)
 * - Monaco editor adapters
 * - Any environment where importing `typescript` is not feasible
 *
 * The full `PositionMapper` in `position-mapper.ts` extends these interfaces
 * to add `mapDiagnostic(diag: ts.Diagnostic)` for VS Code plugin use.
 */

import type { RawSourceMap } from "@typesugar/core";
import {
  decodeSourceMap,
  findOriginalPosition,
  findGeneratedPosition,
  type DecodedSourceMap,
  type SourcePosition,
} from "./source-map-utils.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Text range (offset-based)
 */
export interface TextRange {
  start: number;
  length: number;
}

/**
 * Core interface for bidirectional position mapping.
 * No TypeScript dependency — safe for browser use.
 */
export interface PositionMapperCore {
  /** Map original position to transformed position */
  toTransformed(originalPos: number): number | null;
  /** Map transformed position back to original */
  toOriginal(transformedPos: number): number | null;
  /** Map a text range */
  mapRange(range: TextRange, direction: "toTransformed" | "toOriginal"): TextRange | null;
}

// ---------------------------------------------------------------------------
// Line index utilities
// ---------------------------------------------------------------------------

/**
 * Line/column index for position conversion
 */
export interface LineIndex {
  lineStarts: number[];
}

/**
 * Build a line index from content
 */
export function buildLineIndex(content: string): LineIndex {
  const lineStarts: number[] = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "\n") {
      lineStarts.push(i + 1);
    }
  }
  return { lineStarts };
}

/**
 * Convert offset to line/column (0-based)
 */
export function offsetToLineColumn(offset: number, index: LineIndex): SourcePosition {
  const { lineStarts } = index;
  let line = 0;
  for (let i = 1; i < lineStarts.length; i++) {
    if (lineStarts[i] > offset) break;
    line = i;
  }
  return { line, column: offset - lineStarts[line] };
}

/**
 * Convert line/column to offset
 */
export function lineColumnToOffset(pos: SourcePosition, index: LineIndex): number {
  const { lineStarts } = index;
  if (pos.line < 0 || pos.line >= lineStarts.length) {
    return -1;
  }
  return lineStarts[pos.line] + pos.column;
}

// ---------------------------------------------------------------------------
// SourceMapPositionMapperCore
// ---------------------------------------------------------------------------

/**
 * Position mapper using decoded source maps.
 * No TypeScript dependency.
 */
export class SourceMapPositionMapperCore implements PositionMapperCore {
  private decoded: DecodedSourceMap;
  private originalIndex: LineIndex;
  private transformedIndex: LineIndex;

  constructor(sourceMap: RawSourceMap, originalContent: string, transformedContent: string) {
    this.decoded = decodeSourceMap(sourceMap);
    this.originalIndex = buildLineIndex(originalContent);
    this.transformedIndex = buildLineIndex(transformedContent);
  }

  toOriginal(transformedPos: number): number | null {
    const transformedLC = offsetToLineColumn(transformedPos, this.transformedIndex);
    const originalLC = findOriginalPosition(this.decoded, transformedLC.line, transformedLC.column);
    if (!originalLC) return null;
    const offset = lineColumnToOffset(originalLC, this.originalIndex);
    return offset >= 0 ? offset : null;
  }

  toTransformed(originalPos: number): number | null {
    const originalLC = offsetToLineColumn(originalPos, this.originalIndex);
    const transformedLC = findGeneratedPosition(this.decoded, originalLC.line, originalLC.column);
    if (!transformedLC) return null;
    const offset = lineColumnToOffset(transformedLC, this.transformedIndex);
    return offset >= 0 ? offset : null;
  }

  mapRange(range: TextRange, direction: "toTransformed" | "toOriginal"): TextRange | null {
    const mapFn =
      direction === "toTransformed" ? this.toTransformed.bind(this) : this.toOriginal.bind(this);

    const mappedStart = mapFn(range.start);
    if (mappedStart === null) return null;

    const mappedEnd = mapFn(range.start + range.length);
    if (mappedEnd === null) {
      // Best effort: keep the same length
      return { start: mappedStart, length: range.length };
    }

    return { start: mappedStart, length: mappedEnd - mappedStart };
  }
}

// ---------------------------------------------------------------------------
// IdentityPositionMapperCore
// ---------------------------------------------------------------------------

/**
 * Identity mapper for files that weren't transformed.
 */
export class IdentityPositionMapperCore implements PositionMapperCore {
  toTransformed(originalPos: number): number {
    return originalPos;
  }

  toOriginal(transformedPos: number): number {
    return transformedPos;
  }

  mapRange(range: TextRange): TextRange {
    return range;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a position mapper for a file.
 * Returns an IdentityPositionMapperCore if no source map is available
 * or if the content is unchanged.
 */
export function createPositionMapperCore(
  sourceMap: RawSourceMap | null,
  originalContent: string,
  transformedContent: string
): PositionMapperCore {
  if (!sourceMap || originalContent === transformedContent) {
    return new IdentityPositionMapperCore();
  }
  return new SourceMapPositionMapperCore(sourceMap, originalContent, transformedContent);
}

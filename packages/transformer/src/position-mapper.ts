/**
 * PositionMapper - Bidirectional position translation using source maps
 *
 * Maps positions between original source and transformed output for IDE features.
 */

import * as ts from "typescript";
import {
  type RawSourceMap,
  decodeSourceMap,
  findOriginalPosition,
  findGeneratedPosition,
  type DecodedSourceMap,
  type SourcePosition,
} from "./source-map-utils.js";

/**
 * Text range (offset-based)
 */
export interface TextRange {
  start: number;
  length: number;
}

/**
 * Interface for position mapping between original and transformed code
 */
export interface PositionMapper {
  /** Map original position to transformed position */
  toTransformed(originalPos: number): number | null;
  /** Map transformed position back to original */
  toOriginal(transformedPos: number): number | null;
  /** Map a text range */
  mapRange(range: TextRange, direction: "toTransformed" | "toOriginal"): TextRange | null;
  /** Map a diagnostic's position back to original */
  mapDiagnostic(diag: ts.Diagnostic): ts.Diagnostic;
}

/**
 * Line/column index for position conversion
 */
interface LineIndex {
  /** Offset of the start of each line */
  lineStarts: number[];
}

/**
 * Build a line index from content
 */
function buildLineIndex(content: string): LineIndex {
  const lineStarts: number[] = [0];

  for (let i = 0; i < content.length; i++) {
    if (content[i] === "\n") {
      lineStarts.push(i + 1);
    }
  }

  return { lineStarts };
}

/**
 * Convert offset to line/column
 */
function offsetToLineColumn(offset: number, index: LineIndex): SourcePosition {
  // Binary search for the line
  const { lineStarts } = index;
  let line = 0;

  for (let i = 1; i < lineStarts.length; i++) {
    if (lineStarts[i] > offset) break;
    line = i;
  }

  const column = offset - lineStarts[line];
  return { line, column };
}

/**
 * Convert line/column to offset
 */
function lineColumnToOffset(pos: SourcePosition, index: LineIndex): number {
  const { lineStarts } = index;

  if (pos.line < 0 || pos.line >= lineStarts.length) {
    return -1;
  }

  return lineStarts[pos.line] + pos.column;
}

/**
 * Implementation of PositionMapper using decoded source maps
 */
export class SourceMapPositionMapper implements PositionMapper {
  private decoded: DecodedSourceMap;
  private originalIndex: LineIndex;
  private transformedIndex: LineIndex;

  constructor(
    sourceMap: RawSourceMap,
    private originalContent: string,
    private transformedContent: string
  ) {
    this.decoded = decodeSourceMap(sourceMap);
    this.originalIndex = buildLineIndex(originalContent);
    this.transformedIndex = buildLineIndex(transformedContent);
  }

  toOriginal(transformedPos: number): number | null {
    const transformedLC = offsetToLineColumn(transformedPos, this.transformedIndex);
    const originalLC = findOriginalPosition(
      this.decoded,
      transformedLC.line,
      transformedLC.column
    );

    if (!originalLC) return null;

    return lineColumnToOffset(originalLC, this.originalIndex);
  }

  toTransformed(originalPos: number): number | null {
    const originalLC = offsetToLineColumn(originalPos, this.originalIndex);
    const transformedLC = findGeneratedPosition(
      this.decoded,
      originalLC.line,
      originalLC.column
    );

    if (!transformedLC) return null;

    return lineColumnToOffset(transformedLC, this.transformedIndex);
  }

  mapRange(range: TextRange, direction: "toTransformed" | "toOriginal"): TextRange | null {
    const mapFn = direction === "toTransformed" ? this.toTransformed.bind(this) : this.toOriginal.bind(this);

    const mappedStart = mapFn(range.start);
    if (mappedStart === null) return null;

    const mappedEnd = mapFn(range.start + range.length);
    if (mappedEnd === null) {
      // Best effort: keep the same length
      return { start: mappedStart, length: range.length };
    }

    return { start: mappedStart, length: mappedEnd - mappedStart };
  }

  mapDiagnostic(diag: ts.Diagnostic): ts.Diagnostic {
    if (diag.start === undefined) return diag;

    const originalStart = this.toOriginal(diag.start);
    if (originalStart === null) return diag;

    // Also map the end position for accurate spans
    let originalLength = diag.length;
    if (diag.length !== undefined) {
      const originalEnd = this.toOriginal(diag.start + diag.length);
      if (originalEnd !== null) {
        originalLength = originalEnd - originalStart;
      }
    }

    return {
      ...diag,
      start: originalStart,
      length: originalLength,
    };
  }
}

/**
 * Identity mapper for files that weren't transformed
 */
export class IdentityPositionMapper implements PositionMapper {
  toTransformed(originalPos: number): number {
    return originalPos;
  }

  toOriginal(transformedPos: number): number {
    return transformedPos;
  }

  mapRange(range: TextRange, _direction: "toTransformed" | "toOriginal"): TextRange {
    return range;
  }

  mapDiagnostic(diag: ts.Diagnostic): ts.Diagnostic {
    return diag;
  }
}

/**
 * Create a position mapper for a file
 *
 * Returns an IdentityPositionMapper if no source map is available.
 */
export function createPositionMapper(
  sourceMap: RawSourceMap | null,
  originalContent: string,
  transformedContent: string
): PositionMapper {
  if (!sourceMap || originalContent === transformedContent) {
    return new IdentityPositionMapper();
  }

  return new SourceMapPositionMapper(sourceMap, originalContent, transformedContent);
}

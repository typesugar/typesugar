/**
 * Position conversion helpers shared between LSP server and TS plugin.
 *
 * These convert between byte offsets and line/character positions,
 * and between TypeScript TextSpans and line/character ranges.
 *
 * The Position and Range types here are plain objects matching the LSP
 * protocol spec ({ line, character } and { start, end }).
 */

import type * as ts from "typescript";

/** LSP-compatible position (zero-based line and character). */
export interface Position {
  line: number;
  character: number;
}

/** LSP-compatible range. */
export interface Range {
  start: Position;
  end: Position;
}

/**
 * Convert a byte offset to a line/character position.
 * Offset is clamped to [0, text.length].
 */
export function offsetToPosition(text: string, offset: number): Position {
  const clamped = Math.max(0, Math.min(offset, text.length));
  let line = 0;
  let lastLineStart = 0;
  for (let i = 0; i < clamped; i++) {
    if (text[i] === "\n") {
      line++;
      lastLineStart = i + 1;
    }
  }
  return { line, character: clamped - lastLineStart };
}

/**
 * Convert a line/character position to a byte offset.
 * Character is clamped to the actual line length.
 */
export function positionToOffset(text: string, position: Position): number {
  let line = 0;
  for (let i = 0; i < text.length; i++) {
    if (line === position.line) {
      let lineEnd = text.indexOf("\n", i);
      if (lineEnd === -1) lineEnd = text.length;
      return Math.min(i + position.character, lineEnd);
    }
    if (text[i] === "\n") {
      line++;
    }
  }
  return text.length;
}

/**
 * Convert a TypeScript TextSpan to a line/character Range.
 */
export function textSpanToRange(span: ts.TextSpan, text: string): Range {
  return {
    start: offsetToPosition(text, span.start),
    end: offsetToPosition(text, span.start + span.length),
  };
}

/**
 * Pure helper functions for the LSP server.
 * Extracted so they can be unit-tested without triggering the connection setup.
 */

import { URI } from "vscode-uri";
import type { Position, Range } from "vscode-languageserver/node.js";
import * as ts from "typescript";

// ---------------------------------------------------------------------------
// URI helpers (fix #1 and #2: use vscode-uri for correct URI handling)
// ---------------------------------------------------------------------------

export function uriToFileName(uri: string): string {
  return URI.parse(uri).fsPath;
}

export function fileNameToUri(fileName: string): string {
  return URI.file(fileName).toString();
}

// ---------------------------------------------------------------------------
// Position conversion helpers (fix #12: clamp offsets to valid range)
// ---------------------------------------------------------------------------

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

export function positionToOffset(text: string, position: Position): number {
  let line = 0;
  for (let i = 0; i < text.length; i++) {
    if (line === position.line) {
      // Clamp character to the actual line length
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

export function getDecoratorName(decorator: ts.Decorator): string | undefined {
  const expr = decorator.expression;
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
    return expr.expression.text;
  }
  return undefined;
}

export function textSpanToRange(span: ts.TextSpan, text: string): Range {
  return {
    start: offsetToPosition(text, span.start),
    end: offsetToPosition(text, span.start + span.length),
  };
}

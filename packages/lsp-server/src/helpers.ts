/**
 * Pure helper functions for the LSP server.
 * Extracted so they can be unit-tested without triggering the connection setup.
 */

import { URI } from "vscode-uri";
import type { Position, Range } from "vscode-languageserver/node.js";
import * as ts from "typescript";
import * as path from "path";

// ---------------------------------------------------------------------------
// URI helpers (fix #1 and #2: use vscode-uri for correct URI handling)
// ---------------------------------------------------------------------------

export function uriToFileName(uri: string): string {
  return URI.parse(uri).fsPath;
}

export function fileNameToUri(fileName: string): string {
  return URI.file(fileName).toString();
}

/**
 * The ONE file-name normalisation the server uses for every cache key,
 * project-file list entry and pipeline call (deep-review tooling #15).
 *
 * tsconfig parsing yields `C:/proj/a.ts` on Windows while an editor URI
 * decodes to `c:\proj\a.ts`; comparing those raw made every opened file
 * look "outside the project" (recreating the pipeline on every open) and made
 * the pre-transform cache keys never match. `path.normalize` fixes the
 * separators; the drive letter is lower-cased to match what vscode-uri
 * produces. POSIX paths are only `path.normalize`d (they are case-sensitive).
 *
 * `p` is injectable so the Windows behaviour can be tested on any OS.
 */
export function normalizeFileName(fileName: string, p: path.PlatformPath = path): string {
  const normalized = p.normalize(fileName);
  if (p.sep === "\\" && /^[A-Za-z]:/.test(normalized)) {
    return normalized[0].toLowerCase() + normalized.slice(1);
  }
  return normalized;
}

// ---------------------------------------------------------------------------
// Position conversion helpers (fix #12: clamp offsets to valid range)
// ---------------------------------------------------------------------------

export function offsetToPosition(text: string, offset: number): Position {
  const clamped = Math.max(0, Math.min(offset, text.length));
  let line = 0;
  let lastLineStart = 0;
  for (let i = 0; i < clamped; i++) {
    if (text[i] === "\r" && text[i + 1] === "\n") {
      // Skip \r in \r\n — the \n on the next iteration will count the line
      continue;
    }
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
      // Exclude \r before \n from the line content
      if (lineEnd > 0 && text[lineEnd - 1] === "\r") lineEnd--;
      return Math.min(i + position.character, lineEnd);
    }
    if (text[i] === "\r" && text[i + 1] === "\n") {
      // Skip \r in \r\n — the \n on the next iteration will count the line
      continue;
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

// ---------------------------------------------------------------------------
// Diagnostic position mapping (deep-review tooling #24)
// ---------------------------------------------------------------------------

/** The part of a PositionMapper that diagnostic mapping needs. */
export interface ToOriginalMapper {
  toOriginal(transformedPos: number): number | null;
}

/** Minimum trimmed length for a line to be trusted as a content-match anchor. */
const MIN_ANCHOR_LINE_LENGTH = 8;

/**
 * Map a TypeScript diagnostic computed on transformed code back to the
 * original source, or return `null` when its position cannot be trusted
 * (macro-generated code) — the caller drops it.
 *
 * When the source map has no entry for the position, fall back to matching
 * the diagnostic's transformed line against the original source by content,
 * but ONLY when that line is non-trivial (has an identifier/literal character
 * and at least MIN_ANCHOR_LINE_LENGTH characters) and occurs exactly once in
 * the original. Lines like `}` or `return x;` repeat everywhere, and the old
 * nearest-match search pinned errors to unrelated lines. The column is carried
 * over relative to the line's indentation and the span is clamped to the line.
 */
export function mapTsDiagnosticToOriginal<D extends { start?: number; length?: number }>(
  diag: D,
  mapper: ToOriginalMapper,
  transformedCode: string,
  originalText: string
): D | null {
  if (diag.start === undefined) return diag;

  const originalStart = mapper.toOriginal(diag.start);
  if (originalStart !== null) {
    let originalLength = diag.length;
    if (diag.length !== undefined) {
      const originalEnd = mapper.toOriginal(diag.start + diag.length);
      if (originalEnd !== null) {
        originalLength = Math.max(1, originalEnd - originalStart);
      }
    }
    return { ...diag, start: originalStart, length: originalLength };
  }

  // Locate the transformed line containing diag.start.
  const transformedLineStart = transformedCode.lastIndexOf("\n", diag.start - 1) + 1;
  let transformedLineEnd = transformedCode.indexOf("\n", diag.start);
  if (transformedLineEnd === -1) transformedLineEnd = transformedCode.length;
  const transformedLine = transformedCode
    .slice(transformedLineStart, transformedLineEnd)
    .replace(/\r$/, "");
  const lineText = transformedLine.trim();
  if (lineText.length < MIN_ANCHOR_LINE_LENGTH || !/[A-Za-z0-9_$"'`]/.test(lineText)) {
    return null;
  }

  // The line must occur exactly once in the original.
  const originalLines = originalText.split("\n");
  let matchIdx = -1;
  for (let i = 0; i < originalLines.length; i++) {
    if (originalLines[i].replace(/\r$/, "").trim() === lineText) {
      if (matchIdx !== -1) return null; // ambiguous
      matchIdx = i;
    }
  }
  if (matchIdx === -1) return null; // truly macro-generated

  let origLineStart = 0;
  for (let i = 0; i < matchIdx; i++) origLineStart += originalLines[i].length + 1;
  const origLine = originalLines[matchIdx].replace(/\r$/, "");
  const origIndent = origLine.length - origLine.trimStart().length;
  const transIndent = transformedLine.length - transformedLine.trimStart().length;
  const column = Math.max(0, diag.start - transformedLineStart - transIndent);
  const origContentEnd = origLineStart + origIndent + lineText.length;
  const start = Math.min(origLineStart + origIndent + column, origContentEnd);
  const length =
    diag.length === undefined
      ? undefined
      : Math.max(1, Math.min(diag.length, origContentEnd - start));
  return { ...diag, start, length };
}

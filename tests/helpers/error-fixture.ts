/**
 * PEP-036 Wave 2: Error fixture helper for high-density diagnostic positioning tests.
 *
 * Supports annotated source strings with /*ERR:label* / markers.
 * The helper strips markers before transformation, then verifies that every
 * diagnostic's mapped position lands on the correct line (matching the marker).
 */

import { transformCode, type TransformResult } from "@typesugar/transformer";
import { AMBIENT_DECLARATIONS } from "../../api/playground-declarations.js";
import * as path from "path";
import * as ts from "typescript";
import { expect } from "vitest";

const AMBIENT_FILE = path.resolve(__dirname, "../../__playground_ambient__.d.ts");

/** Parsed marker: label + its 0-based byte offset in the cleaned source. */
export interface ErrorMarker {
  label: string;
  offset: number;
  line: number; // 1-based
  column: number; // 0-based
}

const MARKER_RE = /\/\*ERR:([^*]+)\*\//g;

/**
 * Parse `/*ERR:label*​/` markers from annotated source.
 * Returns the cleaned source (markers removed) and the marker positions.
 */
export function parseMarkers(annotated: string): { source: string; markers: ErrorMarker[] } {
  const markers: ErrorMarker[] = [];
  let cleaned = "";
  let lastIndex = 0;

  for (const match of annotated.matchAll(MARKER_RE)) {
    const markerStart = match.index!;
    cleaned += annotated.slice(lastIndex, markerStart);
    markers.push({
      label: match[1],
      offset: cleaned.length,
      line: cleaned.split("\n").length,
      column: cleaned.length - cleaned.lastIndexOf("\n") - 1,
    });
    lastIndex = markerStart + match[0].length;
  }
  cleaned += annotated.slice(lastIndex);

  return { source: cleaned, markers };
}

/** Get 1-based line number for a byte offset. */
export function lineAt(source: string, offset: number): number {
  return source.substring(0, offset).split("\n").length;
}

/** Get 0-based column for a byte offset. */
export function colAt(source: string, offset: number): number {
  const before = source.substring(0, offset);
  return offset - before.lastIndexOf("\n") - 1;
}

export interface AssertErrorsAtOptions {
  /** File extension, defaults to ".ts". Use ".sts" for HKT/pipe/cons syntax. */
  ext?: string;
  /** Enable strictOutput to get TS type errors mapped back. */
  strictOutput?: boolean;
  /** Tolerance in lines (default 0 = exact match). */
  lineTolerance?: number;
}

/**
 * Transform annotated source and verify that for each `/*ERR:label*​/` marker,
 * at least one diagnostic lands on the same line.
 *
 * Returns the TransformResult for further assertions if needed.
 */
export function assertErrorsAt(
  annotated: string,
  opts: AssertErrorsAtOptions = {}
): { result: TransformResult; markers: ErrorMarker[]; source: string } {
  const { source, markers } = parseMarkers(annotated);
  const ext = opts.ext ?? ".ts";
  const tolerance = opts.lineTolerance ?? 0;

  const result = transformCode(source, {
    fileName: path.resolve(`test-fixture${ext}`),
    extraRootFiles: [AMBIENT_FILE],
    strictOutput: opts.strictOutput ?? false,
    readFile: (f: string) => {
      if (f === AMBIENT_FILE) return AMBIENT_DECLARATIONS;
      return ts.sys.readFile(f);
    },
    fileExists: (f: string) => f === AMBIENT_FILE || ts.sys.fileExists(f),
  });

  for (const marker of markers) {
    const matchingDiag = result.diagnostics.find((d) => {
      const diagLine = lineAt(source, d.start);
      return Math.abs(diagLine - marker.line) <= tolerance;
    });

    expect(
      matchingDiag,
      `Expected a diagnostic near line ${marker.line} for marker /*ERR:${marker.label}*/, ` +
        `but found diagnostics at lines: [${result.diagnostics.map((d) => lineAt(source, d.start)).join(", ")}]`
    ).toBeDefined();
  }

  return { result, markers, source };
}

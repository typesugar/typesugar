/**
 * Where in the source to report a diagnostic TypeScript found in
 * macro-generated code: a position in the expanded text that no source-map
 * segment covers (an `@impl` instance's generated `satisfies`, a helper call
 * a macro wrapped around the user's expression).
 *
 * Shared by the editor (language-service.ts) and the CLI's expanded check
 * (strict-check.ts), so both put such a diagnostic at the same place instead
 * of dropping it: the nearest node around it that came from the source.
 *
 * Takes the TypeScript module as a parameter: the language-service plugin
 * runs against the editor's own TypeScript, not the one this package imports.
 */

import type * as ts from "typescript";
import { decodeSourceMap, type RawSourceMap } from "@typesugar/transformer-core";

/** The nodes of `sf` whose span contains `pos`, outermost (`sf`) first. */
function nodesAt(tsm: typeof ts, sf: ts.SourceFile, pos: number): ts.Node[] {
  // A top-down walk by position, not `node.parent`: the editor's syntactic
  // diagnostics come from a file that may not be bound yet.
  const nodes: ts.Node[] = [sf];
  let node: ts.Node = sf;
  for (;;) {
    const child = tsm.forEachChild(node, (c) => (c.pos <= pos && pos < c.end ? c : undefined));
    if (!child) return nodes;
    nodes.push(child);
    node = child;
  }
}

/**
 * A node whose span is a list of statements: a source token inside one
 * belongs to some other statement, not to the generated code at hand, so the
 * walk goes past it to the construct that owns it (the function, the `if`).
 */
function isStatementList(tsm: typeof ts, n: ts.Node): boolean {
  return (
    tsm.isSourceFile(n) ||
    tsm.isBlock(n) ||
    tsm.isModuleBlock(n) ||
    tsm.isCaseBlock(n) ||
    tsm.isCaseClause(n) ||
    tsm.isDefaultClause(n)
  );
}

/**
 * For a diagnostic at `pos` in the generated text `sf`: walking out from the
 * innermost node containing `pos`, the first node (not a statement list, nor
 * the file) for which `site(start, end)` (the node's span in `sf`, leading
 * trivia excluded) finds a source position; that result, or `undefined` when
 * no enclosing node came from the source (the whole statement is generated).
 */
export function enclosingSourceSite<T>(
  tsm: typeof ts,
  sf: ts.SourceFile,
  pos: number,
  site: (start: number, end: number) => T | undefined
): T | undefined {
  const nodes = nodesAt(tsm, sf, pos);
  for (let k = nodes.length - 1; k >= 1; k--) {
    const n = nodes[k];
    if (isStatementList(tsm, n)) continue;
    const found = site(n.getStart(sf), n.end);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** The length to mark at `start` of the source `text`: the word there, else one character. */
export function sourceTokenLength(text: string, start: number): number {
  const word = /^[\w$]+/.exec(text.slice(start, start + 256));
  return word ? word[0].length : 1;
}

/** Generated → source offsets of one expanded file's mapped tokens, sorted by generated offset. */
export interface ExpandedFileMap {
  generated: number[];
  original: number[];
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

/** The mapped tokens of `expandedText`, from its source map to `originalText`. */
export function buildFileMap(
  map: RawSourceMap,
  expandedText: string,
  originalText: string
): ExpandedFileMap {
  const decoded = decodeSourceMap(map);
  const genStarts = lineStarts(expandedText);
  const origStarts = lineStarts(originalText);
  const pairs: Array<[number, number]> = [];
  decoded.mappings.forEach((segments, line) => {
    if (line >= genStarts.length) return;
    for (const s of segments) {
      if (s.sourceLine === undefined || s.sourceColumn === undefined) continue;
      if (s.sourceLine >= origStarts.length) continue;
      pairs.push([genStarts[line] + s.generatedColumn, origStarts[s.sourceLine] + s.sourceColumn]);
    }
  });
  pairs.sort((a, b) => a[0] - b[0]);
  const fileMap: ExpandedFileMap = { generated: [], original: [] };
  for (const [g, o] of pairs) {
    if (fileMap.generated[fileMap.generated.length - 1] === g) continue;
    fileMap.generated.push(g);
    fileMap.original.push(o);
  }
  return fileMap;
}

/** Index of the first entry of the sorted `xs` that is >= `x`. */
export function lowerBound(xs: readonly number[], x: number): number {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Does a token that came from the source start in the generated span
 * `[start, start + length)` (at least one character)? When none does, a
 * diagnostic there is in generated code, though a position mapper that
 * interpolates along the line still finds a source offset for it (the
 * `satisfies` an `@impl` adds after the user's initializer, on its line).
 */
export function hasSourceTokenIn(
  fm: ExpandedFileMap,
  start: number,
  length: number | undefined
): boolean {
  const i = lowerBound(fm.generated, start);
  return i < fm.generated.length && fm.generated[i] < start + Math.max(length ?? 0, 1);
}

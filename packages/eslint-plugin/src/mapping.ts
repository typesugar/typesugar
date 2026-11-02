/**
 * Mapping ESLint results from the text a processor handed to ESLint (the
 * "transformed" text) back onto the file the user actually has on disk.
 *
 * Locations (line/column) are mapped through an offset mapper. AUTOFIXES are
 * held to a stricter standard, because ESLint applies `fix.range` /
 * suggestion ranges directly to the ORIGINAL text: a range that is off by a
 * few characters corrupts the file (deep review tooling #2). A fix is kept
 * only when it can be proven to edit the same text in the original:
 *
 *   - every transformed line the fix touches, taken whole, is byte-identical
 *     to the original text at ONE constant offset `d`, where `d` is anchored
 *     by the mapper at the start of the first touched line and lands on an
 *     original line start; and
 *   - the mapper agrees with `d` at the fix's start.
 *
 * Under those conditions applying `[start + d, end + d]` to the original
 * performs exactly the edit ESLint computed on the transformed text, on the
 * same characters. Fixes on (or spanning) any line the transform changed —
 * a macro decorator, a `requires:` block, an HKT rewrite, macro-expanded
 * code — fail the check and are DROPPED (the problem is still reported,
 * just not auto-fixed). Dropping is always safe; mis-applying never is.
 */

import type { Linter, Rule } from "eslint";

/** transformed offset -> original offset (null when unmappable) */
export type ToOriginal = (transformedOffset: number) => number | null;

/** Everything postprocess needs to map one file's messages. */
export interface MappingState {
  originalSource: string;
  transformedSource: string;
  toOriginal: ToOriginal;
}

// ---------------------------------------------------------------------------
// Line/column <-> offset (ESLint: 1-based line, 1-based column)
// ---------------------------------------------------------------------------

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

class LineIndex {
  private readonly starts: number[];
  constructor(private readonly text: string) {
    this.starts = lineStarts(text);
  }

  toOffset(line: number, column: number): number {
    const l = Math.min(Math.max(line, 1), this.starts.length);
    return Math.min(this.starts[l - 1] + Math.max(column, 1) - 1, this.text.length);
  }

  toLineCol(offset: number): { line: number; column: number } {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - this.starts[lo] + 1 };
  }

  lineStartAt(offset: number): number {
    return this.starts[this.toLineCol(offset).line - 1];
  }

  /** offset of the "\n" ending the line containing `offset`, or text length */
  lineEndAt(offset: number): number {
    const nl = this.text.indexOf("\n", offset);
    return nl === -1 ? this.text.length : nl;
  }
}

// ---------------------------------------------------------------------------
// Fix verification
// ---------------------------------------------------------------------------

/**
 * Map one fix range from transformed to original coordinates, or return null
 * when it cannot be proven to touch identical text (see module comment).
 */
function mapFixRange(
  range: readonly [number, number],
  state: MappingState,
  tIndex: LineIndex,
  oIndex: LineIndex
): [number, number] | null {
  const t = state.transformedSource;
  const o = state.originalSource;
  const [start, end] = range;
  if (!(start >= 0 && end >= start && end <= t.length)) return null;

  const lineStart = tIndex.lineStartAt(start);
  const lineEnd = tIndex.lineEndAt(end);

  const anchored = state.toOriginal(lineStart);
  if (anchored === null) return null;
  const d = anchored - lineStart;
  if (oIndex.lineStartAt(anchored) !== anchored) return null;

  const oEnd = lineEnd + d;
  if (oEnd > o.length) return null;
  if (o.slice(anchored, oEnd) !== t.slice(lineStart, lineEnd)) return null;
  // Whole lines on both sides: the original line must end where the
  // transformed one does.
  if (oEnd !== o.length && o.charCodeAt(oEnd) !== 10) return null;

  const mappedStart = state.toOriginal(start);
  if (mappedStart !== null && mappedStart !== start + d) return null;

  return [start + d, end + d];
}

function mapFix(
  fix: Rule.Fix,
  state: MappingState,
  tIndex: LineIndex,
  oIndex: LineIndex
): Rule.Fix | null {
  const range = mapFixRange(fix.range, state, tIndex, oIndex);
  return range ? { range, text: fix.text } : null;
}

// ---------------------------------------------------------------------------
// Message mapping
// ---------------------------------------------------------------------------

/**
 * Map ESLint messages produced on `state.transformedSource` back to
 * `state.originalSource`: locations through the mapper, fixes and
 * suggestions only when provably safe (unsafe ones are removed).
 */
export function mapMessages(
  messages: Linter.LintMessage[],
  state: MappingState
): Linter.LintMessage[] {
  const tIndex = new LineIndex(state.transformedSource);
  const oIndex = new LineIndex(state.originalSource);
  const identity = state.transformedSource === state.originalSource;

  return messages.map((message) => {
    if (identity) return message;
    const result: Linter.LintMessage = { ...message };

    if (message.line !== undefined && message.column !== undefined) {
      const mapped = state.toOriginal(tIndex.toOffset(message.line, message.column));
      if (mapped !== null) {
        const lc = oIndex.toLineCol(mapped);
        result.line = lc.line;
        result.column = lc.column;
        if (message.endLine !== undefined && message.endColumn !== undefined) {
          const mappedEnd = state.toOriginal(tIndex.toOffset(message.endLine, message.endColumn));
          if (mappedEnd !== null && mappedEnd >= mapped) {
            const elc = oIndex.toLineCol(mappedEnd);
            result.endLine = elc.line;
            result.endColumn = elc.column;
          } else {
            delete result.endLine;
            delete result.endColumn;
          }
        }
      }
    }

    if (message.fix) {
      const fix = mapFix(message.fix, state, tIndex, oIndex);
      if (fix) result.fix = fix;
      else delete result.fix;
    }

    if (message.suggestions) {
      const suggestions = message.suggestions.flatMap((s) => {
        const fix = mapFix(s.fix, state, tIndex, oIndex);
        return fix ? [{ ...s, fix }] : [];
      });
      if (suggestions.length > 0) result.suggestions = suggestions;
      else delete result.suggestions;
    }

    return result;
  });
}

// ---------------------------------------------------------------------------
// Edit-list mapper (exact, for edits the processor makes itself)
// ---------------------------------------------------------------------------

/** Replace `[start, end)` of the input with `text`. */
export interface TextEdit {
  start: number;
  end: number;
  text: string;
}

/**
 * Apply non-overlapping edits and return the output plus an EXACT
 * output-offset -> input-offset mapper. A position inside replacement text
 * maps to the start of the replaced input range.
 */
export function applyEdits(
  input: string,
  edits: readonly TextEdit[]
): { output: string; toInput: (outputOffset: number) => number } {
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  const segments: Array<{ outStart: number; outEnd: number; inStart: number; edit: boolean }> = [];
  let out = "";
  let cursor = 0;
  for (const e of sorted) {
    if (e.start < cursor || e.end < e.start || e.end > input.length) {
      throw new Error("overlapping or out-of-range edit");
    }
    if (e.start > cursor) {
      segments.push({
        outStart: out.length,
        outEnd: out.length + (e.start - cursor),
        inStart: cursor,
        edit: false,
      });
      out += input.slice(cursor, e.start);
    }
    segments.push({
      outStart: out.length,
      outEnd: out.length + e.text.length,
      inStart: e.start,
      edit: true,
    });
    out += e.text;
    cursor = e.end;
  }
  segments.push({
    outStart: out.length,
    outEnd: out.length + (input.length - cursor),
    inStart: cursor,
    edit: false,
  });
  out += input.slice(cursor);

  const toInput = (p: number): number => {
    for (const s of segments) {
      if (p < s.outEnd || (p === s.outEnd && s === segments[segments.length - 1])) {
        return s.edit ? s.inStart : s.inStart + (p - s.outStart);
      }
    }
    return input.length;
  };
  return { output: out, toInput };
}

// ---------------------------------------------------------------------------
// Shared: typesugar unused-import filtering
// ---------------------------------------------------------------------------

/** typesugar package prefixes for import detection */
const TYPESUGAR_PACKAGE_PREFIXES = [
  "typesugar",
  "@typesugar/",
  "typemacro", // legacy name
  "@typemacro/", // legacy name
  "ttfx", // legacy name
  "@ttfx/", // legacy name
];

const UNUSED_IMPORT_RULES = [
  "no-unused-vars",
  "@typescript-eslint/no-unused-vars",
  "import/no-unused-modules",
  "unused-imports/no-unused-imports",
  "unused-imports/no-unused-vars",
];

/**
 * Whether a lint message (already mapped to ORIGINAL coordinates) is about an
 * unused import from a typesugar package — macro imports are consumed by the
 * transformer, so "unused" is expected.
 */
export function isTypesugarUnusedImportError(
  message: Linter.LintMessage,
  originalSource: string
): boolean {
  if (!UNUSED_IMPORT_RULES.includes(message.ruleId ?? "")) return false;
  if (message.line === undefined) return false;

  const errorLine = originalSource.split("\n")[message.line - 1] ?? "";
  const importMatch = errorLine.match(/from\s+["']([^"']+)["']/);
  if (!importMatch) return false;

  const modulePath = importMatch[1];
  return TYPESUGAR_PACKAGE_PREFIXES.some(
    (prefix) => modulePath === prefix.replace(/\/$/, "") || modulePath.startsWith(prefix)
  );
}

/** Strip a UTF-8 BOM: ESLint applies fixes to the BOM-less text. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

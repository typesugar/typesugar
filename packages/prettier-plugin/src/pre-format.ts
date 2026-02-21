/**
 * Pre-format transformation: custom syntax → valid TypeScript
 *
 * Wraps @typesugar/preprocessor with `mode: "format"` to produce
 * output that can be reversed by postFormat after Prettier runs.
 */

import { preprocess, type PreprocessResult } from "@typesugar/preprocessor";

/**
 * Metadata about HKT parameters found during pre-format.
 * Used by postFormat to know which $<F, A> references to reverse.
 */
export interface HKTParamInfo {
  /** The HKT parameter name (e.g., "F") */
  name: string;
  /** The scope in which this parameter is active (character positions in preprocessed output) */
  scope: { start: number; end: number };
}

/**
 * Metadata extracted during pre-format, needed by postFormat to reverse transformations.
 */
export interface FormatMetadata {
  /** Whether any transformations were applied */
  changed: boolean;
  /** HKT parameter declarations found (used for $<F, A> reversal) */
  hktParams: HKTParamInfo[];
}

/**
 * Result of pre-format transformation
 */
export interface PreFormatResult {
  /** Preprocessed code (valid TypeScript) */
  code: string;
  /** Whether any transformations were applied */
  changed: boolean;
  /** Metadata needed by postFormat to reverse the transformation */
  metadata: FormatMetadata;
}

/**
 * Pre-format options
 */
export interface PreFormatOptions {
  /** File name (used for JSX detection) */
  fileName?: string;
}

/**
 * Transform custom syntax into valid TypeScript that Prettier can format.
 *
 * Transformations:
 * - `a |> b` becomes `__binop__(a, "|>", b)`
 * - `a :: b` becomes `__binop__(a, "::", b)`
 * - `F\<_\>` (HKT decl) becomes `F` followed by the marker comment
 * - `F\<A\>` (HKT usage) becomes `$\<F, A\>`
 *
 * @param source - Source code with custom syntax
 * @param options - Pre-format options
 * @returns Preprocessed result with metadata for reversal
 */
export function preFormat(source: string, options?: PreFormatOptions): PreFormatResult {
  const result = preprocess(source, {
    fileName: options?.fileName,
    mode: "format",
  });

  // Extract HKT param metadata from the result
  // In format mode, HKT declarations leave /*@ts:hkt*/ markers
  // We scan for these to build the metadata
  const hktParams = extractHKTParams(result.code);

  return {
    code: result.code,
    changed: result.changed,
    metadata: {
      changed: result.changed,
      hktParams,
    },
  };
}

/**
 * Extract HKT parameter info from preprocessed code.
 * Finds /*@ts:hkt*\/ markers and determines the identifier name and scope.
 */
function extractHKTParams(code: string): HKTParamInfo[] {
  const params: HKTParamInfo[] = [];
  const marker = "/*@ts:hkt*/";
  let searchStart = 0;

  while (true) {
    const markerIdx = code.indexOf(marker, searchStart);
    if (markerIdx === -1) break;

    // Find the identifier before the marker (skip whitespace)
    let identEnd = markerIdx;
    while (identEnd > 0 && /\s/.test(code[identEnd - 1])) {
      identEnd--;
    }

    let identStart = identEnd;
    while (identStart > 0 && /[a-zA-Z0-9_$]/.test(code[identStart - 1])) {
      identStart--;
    }

    if (identStart < identEnd) {
      const name = code.slice(identStart, identEnd);

      // Find the scope - look for the enclosing construct
      // For simplicity, we'll use a heuristic: scan for { } or ; that bounds this declaration
      const scope = findScope(code, markerIdx);

      params.push({ name, scope });
    }

    searchStart = markerIdx + marker.length;
  }

  return params;
}

/**
 * Find the scope for an HKT parameter declaration.
 * Returns character positions in the code.
 */
function findScope(code: string, position: number): { start: number; end: number } {
  // Scan backwards for scope start (opening brace or start of file)
  let braceDepth = 0;
  let scopeStart = 0;

  for (let i = position - 1; i >= 0; i--) {
    const ch = code[i];
    if (ch === "}") braceDepth++;
    else if (ch === "{") {
      if (braceDepth > 0) braceDepth--;
      else {
        scopeStart = i;
        break;
      }
    }
  }

  // Scan forwards for scope end (closing brace, semicolon at depth 0, or end of file)
  braceDepth = 0;
  let parenDepth = 0;
  let scopeEnd = code.length;
  let foundOpenBrace = false;

  for (let i = position; i < code.length; i++) {
    const ch = code[i];

    if (ch === "{") {
      braceDepth++;
      foundOpenBrace = true;
    } else if (ch === "}") {
      if (braceDepth > 0) {
        braceDepth--;
        if (braceDepth === 0) {
          scopeEnd = i + 1;
          break;
        }
      } else {
        scopeEnd = i + 1;
        break;
      }
    } else if (ch === "(") {
      parenDepth++;
    } else if (ch === ")") {
      if (parenDepth > 0) parenDepth--;
    } else if (ch === ";" && !foundOpenBrace && braceDepth === 0 && parenDepth === 0) {
      scopeEnd = i + 1;
      break;
    }
  }

  return { start: scopeStart, end: scopeEnd };
}

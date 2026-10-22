/**
 * Expression-position comprehension preprocessing (`const f = (id) => let:
 * {...} yield: ...`, `const r = let: {...}`), shared by every way typesugar
 * builds a program: the pipeline (unplugin, `transformCode`), and the CLI's
 * `build`, `check`, `watch` and `expand`, which build their own ts.Program
 * and used to run only the HKT preprocessing -- so `typesugar check`
 * reported syntax errors there and `typesugar build` emitted broken JS
 * (`export const f = (id) => let, { user }; ...`).
 *
 * The rewrite is a text rewrite that has to happen before the program is
 * parsed (arrow-comprehension-preprocess.ts). ts-patch's `tsc` hands
 * typesugar a program that is already parsed, so it cannot do this: those
 * forms need `typesugar build` (or a bundler plugin) there.
 */

import * as ts from "typescript";
import { globalRegistry, globalResolutionScope, scanImportsForScope } from "@typesugar/core";
import { loadMacroPackagesFromFile } from "./macro-loader.js";
import {
  preprocessExpressionComprehensions,
  type PreprocessDiagnostic,
} from "./arrow-comprehension-preprocess.js";
import { createPositionMapper, type PositionMapper } from "./position-mapper.js";

/** Can `code` contain a comprehension label at all (a cheap text pre-filter)? */
export function mayContainComprehension(code: string): boolean {
  return /\b(?:let|seq|par|all)\s*:/.test(code);
}

/**
 * Does `scanFile` activate a comprehension macro (`let:` / `par:`)? PEP-052
 * gate: the text rewrite commits to do-notation before the AST gate can run,
 * and in a file that never activates the comprehension macros the gated
 * merge would refuse to repair it, so the rewrite runs only when one is
 * activated. Loads the file's macro packages first (the macros live in
 * @typesugar/std, normally loaded lazily); both calls are idempotent.
 */
export function isComprehensionSyntaxActivatedIn(
  scanFile: ts.SourceFile,
  program: ts.Program | undefined,
  verbose?: boolean
): boolean {
  if (!mayContainComprehension(scanFile.text)) return false;
  loadMacroPackagesFromFile(scanFile, verbose, program);
  const letMacro = globalRegistry.getLabeledBlock("let")?.name;
  const parMacro = globalRegistry.getLabeledBlock("par")?.name;
  if (!letMacro && !parMacro) return false;
  scanImportsForScope(scanFile, globalResolutionScope, program);
  return [letMacro, parMacro].some(
    (name) => name && globalResolutionScope.isLabelSyntaxActivated(scanFile.fileName, name)
  );
}

/** One file's comprehension rewrite, for a CLI program. */
export interface ProgramComprehensionRewrite {
  /** The text before the rewrite (the program's, already HKT-preprocessed). */
  original: string;
  /** The rewritten text to serve to the next program. */
  source: string;
  /** Rewritten → original positions, for the diagnostics of the next program. */
  mapper: PositionMapper;
  /** The preprocessor's own diagnostics (TS9223), in `original`'s positions. */
  diagnostics: PreprocessDiagnostic[];
}

/**
 * The comprehension rewrite of every source file of `program` that
 * activates the comprehension macros, keyed by resolved file name. The CLI
 * serves `source` through its host and rebuilds the program once (as the
 * pipeline does through its host), and maps the new program's diagnostics
 * back with `mapper`.
 */
export function rewriteProgramComprehensions(
  program: ts.Program,
  resolve: (fileName: string) => string,
  verbose?: boolean
): Map<string, ProgramComprehensionRewrite> {
  const rewrites = new Map<string, ProgramComprehensionRewrite>();
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile || program.isSourceFileFromExternalLibrary(sf)) continue;
    if (!isComprehensionSyntaxActivatedIn(sf, program, verbose)) continue;
    const rw = rewriteComprehensions(sf.text, sf.fileName);
    if (rw) rewrites.set(resolve(sf.fileName), rw);
  }
  return rewrites;
}

/**
 * One file's comprehension rewrite (the caller has run the activation gate),
 * or undefined when the rewrite changes nothing and reports nothing. `watch`
 * calls this per file read, as it serves the text.
 */
export function rewriteComprehensions(
  text: string,
  fileName: string
): ProgramComprehensionRewrite | undefined {
  const result = preprocessExpressionComprehensions(text, fileName);
  if (!result.changed && result.diagnostics.length === 0) return undefined;
  return {
    original: text,
    source: result.source,
    mapper: createPositionMapper(result.sourceMap ?? null, text, result.source),
    diagnostics: result.diagnostics,
  };
}

/**
 * A diagnostic of a program built from rewritten text, moved to the position
 * it has in the text before the rewrite (and that text's SourceFile, so its
 * line and column are the user's); undefined for one on the preprocessor's
 * own `__letyield_N` tag, which the user didn't write.
 */
export function mapRewrittenDiagnostic(
  d: ts.Diagnostic,
  rewrites: ReadonlyMap<string, ProgramComprehensionRewrite>,
  resolve: (fileName: string) => string,
  originalFile: (fileName: string, text: string) => ts.SourceFile
): ts.Diagnostic | undefined {
  if (!d.file || d.start === undefined) return d;
  const rw = rewrites.get(resolve(d.file.fileName));
  if (!rw) return d;
  // The preprocessor's own tag (`__letyield_N`, which the macro replaces):
  // text the user didn't write, so not an error in their code.
  if (rw.source.startsWith("__letyield_", d.start)) return undefined;
  const start = rw.mapper.toOriginal(d.start);
  if (start === null) return { ...d, file: originalFile(d.file.fileName, rw.original), start: 0 };
  const end = d.length !== undefined ? rw.mapper.toOriginal(d.start + d.length) : null;
  return {
    ...d,
    file: originalFile(d.file.fileName, rw.original),
    start,
    length: end !== null && end >= start ? end - start : d.length,
  };
}

/** The preprocessor's own diagnostics (TS9223) as ts.Diagnostics in the original text. */
export function preprocessorDiagnostics(
  rewrites: ReadonlyMap<string, ProgramComprehensionRewrite>,
  fileNameOf: (resolved: string) => string,
  originalFile: (fileName: string, text: string) => ts.SourceFile
): ts.Diagnostic[] {
  const out: ts.Diagnostic[] = [];
  for (const [resolved, rw] of rewrites) {
    const fileName = fileNameOf(resolved);
    for (const d of rw.diagnostics) {
      out.push({
        file: originalFile(fileName, rw.original),
        start: d.start,
        length: d.length,
        messageText: d.message,
        category:
          d.severity === "error" ? ts.DiagnosticCategory.Error : ts.DiagnosticCategory.Warning,
        code: d.code,
      });
    }
  }
  return out;
}

/**
 * `typesugar build --strict` / `check --strict`: type-check the EXPANDED
 * program.
 *
 * The expansion checked is the one the build itself produced (the emit's
 * `captureExpandedSource`, or `expandProgramSources` under `check`), the
 * same text the declarations are emitted from. It used to be a separate
 * expansion of detached re-parsed copies, made before anything else: the
 * macros then asked the checker about nodes of a tree it never bound, which
 * expanded some calls wrongly or not at all (fp's `case Some(v)`), and left
 * errors such as "Cannot find name 's'" for a parameter in the checker's
 * diagnostics for that file name, which the unexpanded program's diagnostics
 * then included. Its diagnostics were also suppression-filtered against the
 * unexpanded program, whose text their positions don't refer to.
 *
 * The expanded text is printed and re-parsed as whole files (as the
 * declaration emit does): this is a second Program over generated source,
 * not macro codegen.
 */

import * as ts from "typescript";
import {
  filterDiagnostics,
  getDiagnosticSuppressionRules,
  opaqueTypesAsUnderlying,
} from "@typesugar/core";
import { createExpandedHost } from "./declarations.js";

/**
 * Type-check `rootNames` with `expanded` (absolute path → expanded text of
 * each file the macros changed) in place of the source, every file served in
 * the runtime view of `@opaque` types (`opaqueTypesAsUnderlying`), the view
 * the expanded code is written against. Returns the diagnostics,
 * suppression-filtered against THAT program: its checker and its source
 * files, the ones the diagnostics' positions refer to.
 */
export function typecheckExpandedProgram(params: {
  rootNames: readonly string[];
  options: ts.CompilerOptions;
  host: ts.CompilerHost;
  expanded: ReadonlyMap<string, string>;
}): ts.Diagnostic[] {
  const base = createExpandedHost(params.host, params.expanded);
  const readFile = (fileName: string): string | undefined => {
    const text = base.readFile(fileName);
    return text === undefined ? undefined : opaqueTypesAsUnderlying(fileName, text);
  };
  const host: ts.CompilerHost = {
    ...base,
    readFile,
    getSourceFile: (fileName, languageVersionOrOptions, onError) => {
      const text = readFile(fileName);
      if (text === undefined) {
        onError?.(`Cannot read file '${fileName}'.`);
        return undefined;
      }
      return ts.createSourceFile(fileName, text, languageVersionOrOptions, true);
    },
  };
  const program = ts.createProgram(params.rootNames, { ...params.options, noEmit: true }, host);
  const diagnostics = [...ts.getPreEmitDiagnostics(program)];

  if (getDiagnosticSuppressionRules().length === 0) return diagnostics;
  try {
    return filterDiagnostics(
      diagnostics,
      program.getTypeChecker(),
      (fn) => program.getSourceFile(fn),
      { program }
    );
  } catch (e: unknown) {
    console.error(
      `🧊 Warning: diagnostic suppression filtering of the --strict diagnostics skipped — ${
        e instanceof Error ? e.message : String(e)
      }`
    );
    return diagnostics;
  }
}

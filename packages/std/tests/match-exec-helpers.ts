/**
 * Shared helpers for tests that transform a snippet through the REAL
 * transformer pipeline and then EXECUTE the generated JavaScript.
 *
 * The PEP-019 match tests only grepped the output for "switch", which is how
 * several silently-wrong fast paths shipped (deep review 1.0, findings #1-#6).
 * Every assertion built on these helpers runs the emitted code.
 */
import * as ts from "typescript";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as std from "@typesugar/std";
import * as stdDo from "@typesugar/std/syntax/do";

import "@typesugar/macros";
import "@typesugar/std/macros";

import { TransformationPipeline } from "@typesugar/transformer";

export interface ExecResult {
  code: string;
  js: string;
  errors: string[];
  warnings: string[];
  /** Exports of the executed module (undefined when the output failed to run). */
  exports: Record<string, unknown>;
  /** Error thrown while compiling/running the emitted JS, if any. */
  runError?: unknown;
}

let counter = 0;
const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Transform `code` with strict type checking (so `| null` survives in
 * unions), transpile to CommonJS and run it. `@typesugar/std` and its do
 * marker resolve to the real built package.
 */
export function transformAndRun(code: string, opts: { strict?: boolean } = {}): ExecResult {
  const fileName = path.resolve(here, `__match_exec_${counter++}.ts`);
  const pipeline = new TransformationPipeline(
    {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: opts.strict ?? true,
      skipLibCheck: true,
      lib: ["lib.es2023.d.ts"],
    },
    [fileName],
    {
      readFile: (f) => (f === fileName ? code : ts.sys.readFile(f)),
      fileExists: (f) => f === fileName || ts.sys.fileExists(f),
    }
  );
  const result = pipeline.transform(fileName);
  const diags = result.diagnostics ?? [];
  const msg = (d: { message?: string; messageText?: unknown }) =>
    String(d.message ?? d.messageText ?? "");
  const errors = diags.filter((d: { severity?: string }) => d.severity === "error").map(msg);
  const warnings = diags.filter((d: { severity?: string }) => d.severity === "warning").map(msg);

  const js = ts.transpileModule(result.code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;

  const mod = { exports: {} as Record<string, unknown> };
  const req = (spec: string) => {
    if (spec === "@typesugar/std") return std;
    if (spec === "@typesugar/std/syntax/do") return stdDo;
    throw new Error(`unexpected require(${spec}) in emitted code`);
  };
  let runError: unknown;
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function("require", "exports", "module", js)(req, mod.exports, mod);
  } catch (e) {
    runError = e;
  }
  return { code: result.code, js, errors, warnings, exports: mod.exports, runError };
}

/**
 * Test helpers: run the REAL typesugar transformer over a source snippet and
 * execute / typecheck the result.
 */
import * as path from "path";
import * as ts from "typescript";
import "../src/macros.js";
import * as runtime from "../src/index.js";
// @ts-ignore -- the transformer is not a dependency of this package; load its built pipeline directly
import { transformCode } from "../../transformer/dist/pipeline.js";

const PKG_DIR = path.resolve(__dirname, "..");
let counter = 0;

export interface Expanded {
  code: string;
  errors: string[];
  warnings: string[];
}

export function expand(src: string): Expanded {
  // Each call uses a fresh file name so per-file transformer caches don't leak between tests.
  const fileName = path.join(PKG_DIR, `__ts_macro_input_${counter++}.ts`);
  const r = transformCode(src, { fileName });
  const diags = (r.diagnostics ?? []) as Array<{ message: string; severity: string }>;
  return {
    code: r.code,
    errors: diags.filter((d) => d.severity === "error").map((d) => d.message),
    warnings: diags.filter((d) => d.severity !== "error").map((d) => d.message),
  };
}

/** Transpile transformed TS to CJS and run it; `@typesugar/type-system` maps to the src runtime. */
export function run(code: string, extra: Record<string, unknown> = {}): Record<string, any> {
  const js = ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      experimentalDecorators: true,
    },
  }).outputText;
  const mod = { exports: {} as Record<string, any> };
  const req = (id: string) => {
    if (id === "@typesugar/type-system") return runtime;
    if (id in extra) return extra[id];
    throw new Error("unexpected require: " + id);
  };
  new Function("require", "module", "exports", js)(req, mod, mod.exports);
  return mod.exports;
}

/**
 * Type-check a snippet that imports from `@typesugar/type-system` (resolved to
 * this package's src via `paths`). Returns the semantic error messages.
 */
export function typeErrors(src: string): string[] {
  const fileName = path.join(PKG_DIR, `__ts_typecheck_input_${counter++}.ts`);
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    baseUrl: PKG_DIR,
    paths: { "@typesugar/type-system": ["src/index.ts"] },
  };
  const host = ts.createCompilerHost(options);
  const orig = host.getSourceFile.bind(host);
  host.getSourceFile = (f, lang, ...rest) =>
    path.resolve(f) === fileName ? ts.createSourceFile(f, src, lang, true) : orig(f, lang, ...rest);
  const origExists = host.fileExists.bind(host);
  host.fileExists = (f) => path.resolve(f) === fileName || origExists(f);
  const program = ts.createProgram([fileName], options, host);
  return ts
    .getPreEmitDiagnostics(program, program.getSourceFile(fileName))
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
}

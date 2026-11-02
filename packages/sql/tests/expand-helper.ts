/**
 * Test helper: run source through the REAL typesugar transformer (built dist,
 * with the @typesugar/sql macros auto-loaded from the user's import), then
 * transpile and EXECUTE the output. `@typesugar/sql` imports in the output are
 * bound to this package's src runtime.
 */
import * as path from "path";
import { fileURLToPath } from "url";
import * as ts from "typescript";
import { TransformationPipeline } from "@typesugar/transformer";
import * as runtime from "../src/index.js";

export interface Expanded {
  code: string;
  errors: string[];
  warnings: string[];
}

/** A file path under this package so `@typesugar/sql` resolves to the workspace package. */
const VIRTUAL_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "__virtual_input__.ts"
);

export function expand(code: string, opts: { strict?: boolean } = {}): Expanded {
  const pipeline = new TransformationPipeline(
    {
      target: ts.ScriptTarget.Latest,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      esModuleInterop: true,
      strict: opts.strict ?? false,
      noImplicitAny: false,
      skipLibCheck: true,
      skipDefaultLibCheck: true,
    },
    [VIRTUAL_FILE],
    {
      readFile: (f) => (f === VIRTUAL_FILE ? code : ts.sys.readFile(f)),
      fileExists: (f) => f === VIRTUAL_FILE || ts.sys.fileExists(f),
    }
  );
  const result = pipeline.transform(VIRTUAL_FILE);
  const diags = result.diagnostics ?? [];
  return {
    code: result.code,
    errors: diags.filter((d) => d.severity === "error").map((d) => d.message),
    warnings: diags.filter((d) => d.severity === "warning").map((d) => d.message),
  };
}

/**
 * Transpile expanded TS to CommonJS and evaluate it (as an async function body,
 * so top-level `await` works). `globals` are injected as free variables.
 * Resolves to the module's exports.
 */
export async function execute(
  tsCode: string,
  globals: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const js = ts.transpileModule(tsCode, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Record<string, unknown> = {};
  const req = (id: string): unknown => {
    if (id === "@typesugar/sql") return runtime;
    throw new Error(`unexpected import in expanded output: ${id}`);
  };
  const names = Object.keys(globals);
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
    ...args: string[]
  ) => (...args: unknown[]) => Promise<void>;
  const fn = new AsyncFunction("exports", "require", ...names, js);
  await fn(exports, req, ...names.map((n) => globals[n]));
  return exports;
}

/** expand + assert no errors + execute. */
export async function expandAndRun(
  code: string,
  opts: { strict?: boolean; globals?: Record<string, unknown> } = {}
): Promise<{ exports: Record<string, unknown>; expanded: Expanded }> {
  const expanded = expand(code, opts);
  if (expanded.errors.length > 0) {
    throw new Error(`transform errors: ${expanded.errors.join("; ")}\n${expanded.code}`);
  }
  return { exports: await execute(expanded.code, opts.globals), expanded };
}

/**
 * Docs review r3 (guides-c #6, start #7): the code `validator<T>()` emits must
 * type-check. It reads `value.name` after narrowing `value: unknown` only to
 * `object`, so strictOutput reports TS2339 "Property 'name' does not exist on
 * type 'object'" for every field.
 *
 * The macro lives in @typesugar/macros (packages/macros/src/reflect.ts,
 * `fieldAccess` in validatorMacro), not in this package. Until that is fixed
 * (cast `value` to `Record<string, unknown>` in `fieldAccess`, as AST), the
 * type-check test is `it.fails`: when it starts failing, the fix has landed;
 * change it to `it`.
 */
import { describe, it, expect } from "vitest";
import * as path from "path";
import * as ts from "typescript";
import "../src/index";
// @ts-ignore -- load the transformer's built pipeline directly
import { TransformationPipeline } from "../../transformer/dist/pipeline.js";

const FILE = path.resolve(__dirname, "../__reflect_validator_input.ts");

function expand(body: string): { code: string; errors: string[] } {
  const src = `import { validator } from "@typesugar/reflect";\n${body}`;
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.Latest,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
  };
  const pipeline = new TransformationPipeline(options, [FILE], {
    readFile: (f: string) => (f === FILE ? src : ts.sys.readFile(f)),
    fileExists: (f: string) => f === FILE || ts.sys.fileExists(f),
  });
  const r = pipeline.transform(FILE);
  const diags: any[] = r.diagnostics ?? [];
  return {
    code: r.code,
    errors: diags
      .filter((d) => d.severity === "error")
      .map((d) => String(d.message ?? d.messageText)),
  };
}

function typecheck(code: string): string[] {
  const file = path.resolve(__dirname, "../__reflect_validator_typecheck.ts");
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const origGet = host.getSourceFile.bind(host);
  host.getSourceFile = (f, lang, ...rest) =>
    f === file ? ts.createSourceFile(f, code, lang, true) : origGet(f, lang, ...rest);
  const origExists = host.fileExists.bind(host);
  host.fileExists = (f) => f === file || origExists(f);
  const program = ts.createProgram([file], options, host);
  const sf = program.getSourceFile(file)!;
  return [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)].map(
    (d) => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`
  );
}

const BODY = `
  interface User { name: string; age: number; "first-name"?: string }
  export const v = validator<User>();
`;

describe("validator<T>() output", () => {
  it("expands and runs", () => {
    const { code, errors } = expand(BODY);
    expect(errors).toEqual([]);
    const js = ts.transpileModule(code, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const mod = { exports: {} as Record<string, any> };
    new Function("require", "module", "exports", js)(() => ({}), mod, mod.exports);
    expect(mod.exports.v({ name: "a", age: 1 })).toEqual({
      success: true,
      value: { name: "a", age: 1 },
    });
    expect(mod.exports.v({ name: 1, age: 1 }).success).toBe(false);
  });

  // Known bug, owned by @typesugar/macros (see the header comment).
  it("type-checks (no TS2339 on `value.name`)", () => {
    const { code } = expand(BODY);
    expect(typecheck(code)).toEqual([]);
  });
});

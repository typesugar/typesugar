/**
 * docs review C#25: `nativeSchema` must be a recognised typeclass instance so
 * that passing it to a generic `Schema<F>` function auto-specializes the call
 * (validate.md "Library-Agnostic Validation"). Runs the REAL transformer, then
 * executes the output.
 */
import { describe, it, expect } from "vitest";
import * as path from "path";
import * as ts from "typescript";
import "../macros.js";
import * as schemaModule from "../schema.js";
// @ts-ignore -- load the transformer's built pipeline directly
import { TransformationPipeline } from "../../../transformer/dist/pipeline.js";

const FILE = path.resolve(__dirname, "../../__validate_spec_input.ts");

function expand(src: string): { code: string; errors: string[]; warnings: string[] } {
  const pipeline = new TransformationPipeline(
    {
      target: ts.ScriptTarget.Latest,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      skipLibCheck: true,
    },
    [FILE],
    {
      readFile: (f: string) => (f === FILE ? src : ts.sys.readFile(f)),
      fileExists: (f: string) => f === FILE || ts.sys.fileExists(f),
    }
  );
  const r = pipeline.transform(FILE);
  const diags: any[] = r.diagnostics ?? [];
  const msg = (d: any) => String(d.message ?? d.messageText);
  return {
    code: r.code,
    errors: diags.filter((d) => d.severity === "error").map(msg),
    warnings: diags.filter((d) => d.severity === "warning").map(msg),
  };
}

function run(code: string): Record<string, any> {
  const js = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} as Record<string, any> };
  const req = (id: string) => {
    if (id === "./src/schema.js") return schemaModule;
    throw new Error("unexpected require: " + id);
  };
  new Function("require", "module", "exports", js)(req, mod, mod.exports);
  return mod.exports;
}

const SRC = `import { nativeSchema, type NativeSchema } from "./src/schema.js";
interface User { name: string }
const isUser = (value: unknown): value is User =>
  typeof value === "object" && value !== null && typeof (value as any).name === "string";
function processBody<A>(S: NativeSchema, schema: (v: unknown) => v is A, data: unknown): A {
  return S.parse(schema, data);
}
export const ok = processBody(nativeSchema, isUser, { name: "x" });
export const bad = () => processBody(nativeSchema, isUser, 42);
`;

describe("docs C#25: nativeSchema auto-specializes", () => {
  it("processBody(nativeSchema, isUser, data) is specialized and still validates", () => {
    const r = expand(SRC);
    expect(r.errors).toEqual([]);
    // The dictionary argument is gone: the call was specialized.
    expect(r.code).not.toMatch(/processBody\(nativeSchema/);
    const m = run(r.code);
    expect(m.ok).toEqual({ name: "x" });
    expect(() => m.bad()).toThrow("Validation failed");
  });

  it("the guide's generic Schema<F> form specializes too", () => {
    const r = expand(`import { nativeSchema, type Schema } from "./src/schema.js";
import type { Kind } from "@typesugar/type-system";
interface User { name: string }
const isUser = (value: unknown): value is User =>
  typeof value === "object" && value !== null && typeof (value as any).name === "string";
function processBody<F, A>(S: Schema<F>, schema: Kind<F, A>, data: unknown): A {
  return S.parse(schema, data);
}
export const ok = processBody(nativeSchema, isUser, { name: "x" });
`);
    expect(r.errors).toEqual([]);
    expect(r.code).not.toMatch(/processBody\(nativeSchema/);
    expect(run(r.code).ok).toEqual({ name: "x" });
  });
});

/**
 * @typesugar/validate and @typesugar/testing in one process (PEP-060 item 8).
 *
 * Both packages register an expression macro named `assert`: validate's
 * `assert<T>()` builds an assertion function, testing's `assert(cond)` is a
 * power assert. Macro identity is (module, export name), so both stay loaded
 * and the import decides which expands — whichever package loads first.
 * Before the fix, loading the second package threw "Expression macro 'assert'
 * is already registered" (or, between two @typesugar/* modules, silently kept
 * the first) and every later macro of that package never expanded.
 *
 * Each test transforms with the REAL pipeline and EXECUTES the output.
 */
import { describe, it, expect } from "vitest";
import * as path from "path";
import * as ts from "typescript";
import { globalRegistry, type MacroDefinition } from "@typesugar/core";
import * as validateMacros from "../macros.js";
// @typesugar/testing's built package (resolved from the workspace root).
import * as testingMacros from "@typesugar/testing/macros";
import * as testingRuntime from "@typesugar/testing";
// @ts-ignore -- load the transformer's built pipeline directly
import { TransformationPipeline } from "../../../transformer/dist/pipeline.js";

const DIR = path.resolve(__dirname, "../..");
const A = path.join(DIR, "__with_testing_a.ts");
const B = path.join(DIR, "__with_testing_b.ts");

const VALIDATE: MacroDefinition[] = [
  validateMacros.validateMacro,
  validateMacros.isMacro,
  validateMacros.assertMacro,
  validateMacros.assertTypeMacro,
];
const TESTING: MacroDefinition[] = [testingMacros.assertMacro, testingMacros.assertTypeMacro];

/** Reset the registry and register the two packages' macros in `order`. */
function registerInOrder(order: "validate-first" | "testing-first"): void {
  (globalRegistry as unknown as { clear(): void }).clear();
  const seq = order === "validate-first" ? [...VALIDATE, ...TESTING] : [...TESTING, ...VALIDATE];
  for (const m of seq) globalRegistry.register(m);
}

function transform(
  files: Record<string, string>
): Record<string, { code: string; errors: string[] }> {
  const pipeline = new TransformationPipeline(
    {
      target: ts.ScriptTarget.Latest,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      skipLibCheck: true,
    },
    Object.keys(files),
    {
      readFile: (f: string) => files[f] ?? ts.sys.readFile(f),
      fileExists: (f: string) => f in files || ts.sys.fileExists(f),
    }
  );
  const out: Record<string, { code: string; errors: string[] }> = {};
  for (const f of Object.keys(files)) {
    const r = pipeline.transform(f);
    out[f] = {
      code: r.code,
      errors: (r.diagnostics ?? [])
        .filter((d: any) => d.severity === "error")
        .map((d: any) => String(d.message ?? d.messageText)),
    };
  }
  return out;
}

function run(code: string): Record<string, any> {
  const js = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} as Record<string, any> };
  const req = (id: string) => {
    if (id === "@typesugar/testing") return testingRuntime;
    if (id === "@typesugar/validate") return {};
    throw new Error("unexpected require: " + id);
  };
  new Function("require", "module", "exports", js)(req, mod, mod.exports);
  return mod.exports;
}

const SAME_FILE = [
  `import { assert } from "@typesugar/testing";`,
  `import { assert as check, is } from "@typesugar/validate";`,
  `import * as v from "@typesugar/validate";`,
  `interface User { id: number; name: string }`,
  `export const checkUser = check<User>();`,
  `export const nsCheckUser = v.assert<User>();`,
  `export const isUser = is<User>();`,
  `export function powerFails(): void { const x = 1; assert(x + 1 === 3); }`,
  `export function powerPasses(): void { assert(1 + 1 === 2); }`,
].join("\n");

const FILE_A = [
  `import { assert } from "@typesugar/testing";`,
  `export function powerFails(): void { const x = 1; assert(x + 1 === 3); }`,
].join("\n");
const FILE_B = [
  `import { assert } from "@typesugar/validate";`,
  `interface User { id: number; name: string }`,
  `export const checkUser = assert<User>();`,
].join("\n");

const SIDE_BY_SIDE = [
  `import { assert } from "@typesugar/testing";`,
  `import { assertType } from "@typesugar/validate";`,
  `interface User { id: number; name: string }`,
  `export const checkUser = assertType<User>();`,
  `export function powerFails(): void { const x = 1; assert(x + 1 === 3); }`,
].join("\n");

function expectValidateAssert(fn: (v: unknown) => unknown): void {
  expect(typeof fn).toBe("function");
  const ok = { id: 1, name: "a" };
  expect(fn(ok)).toBe(ok);
  expect(() => fn({ id: "1", name: "a" })).toThrow(/Validation failed/);
}

function expectPowerAssertFails(fn: () => void): void {
  let message = "";
  try {
    fn();
  } catch (e) {
    message = String((e as Error).message);
  }
  // testing's power assert reports the sub-expression values, not just "false".
  expect(message).toMatch(/x \+ 1 === 3/);
  expect(message).toMatch(/\b2\b/);
}

for (const order of ["validate-first", "testing-first"] as const) {
  describe(`validate + testing loaded together (${order})`, () => {
    it("one file: testing's assert, validate's assert (aliased and via namespace) all expand", () => {
      registerInOrder(order);
      const { [A]: r } = transform({ [A]: SAME_FILE });
      expect(r.errors).toEqual([]);
      const m = run(r.code);
      expectValidateAssert(m.checkUser);
      expectValidateAssert(m.nsCheckUser);
      expect(m.isUser({ id: 1, name: "a" })).toBe(true);
      expect(m.isUser({ id: 1 })).toBe(false);
      expectPowerAssertFails(m.powerFails);
      expect(() => m.powerPasses()).not.toThrow();
    });

    it("two files: one imports testing's assert, the other validate's", () => {
      registerInOrder(order);
      const out = transform({ [A]: FILE_A, [B]: FILE_B });
      expect(out[A].errors).toEqual([]);
      expect(out[B].errors).toEqual([]);
      expectPowerAssertFails(run(out[A].code).powerFails);
      expectValidateAssert(run(out[B].code).checkUser);
    });

    it("validate's assertType<T>() next to testing's assert in one file", () => {
      registerInOrder(order);
      const { [A]: r } = transform({ [A]: SIDE_BY_SIDE });
      expect(r.errors).toEqual([]);
      const m = run(r.code);
      expectValidateAssert(m.checkUser);
      expectPowerAssertFails(m.powerFails);
    });
  });
}

describe("load order does not change the output", () => {
  it("validate-first and testing-first produce identical code", () => {
    const outputs = (["validate-first", "testing-first"] as const).map((order) => {
      registerInOrder(order);
      const out = transform({ [A]: SAME_FILE, [B]: FILE_B });
      return [out[A].code, out[B].code];
    });
    expect(outputs[1]).toEqual(outputs[0]);
  });
});

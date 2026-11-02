/**
 * A comprehension whose expansion fails (here: `a << 42`, a first bind with
 * no type constructor) keeps its `yield:` continuation in the output.
 *
 * The transformer consumes the continuation before calling the macro, and
 * every failure path in the let:/par: macros returns the main block alone,
 * so the continuation was dropped from the expanded text. The language
 * service checks that text, so an undefined `nope` in the `yield:` was
 * missing from the editor while `typesugar check` (which checks the source
 * as written) reported it.
 */

import { describe, it, expect, vi } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as ts from "typescript";
import init from "../src/language-service.js";
import "@typesugar/macros";

const VDIR = path.resolve(__dirname, "__virtual_review__");
const pkgRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pkgRoot, "..", "..");
const cliPath = path.join(pkgRoot, "dist", "cli.js");

const FAILING = `import "@typesugar/std/syntax/do";
export const r =
  let: {
    a << 42;
  }
  yield: a + nope;
let: {
  b << 42;
}
yield: b + nope2;
`;

function languageService(file: string, content: string) {
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => ({
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      skipLibCheck: true,
    }),
    getScriptFileNames: () => [file],
    getScriptVersion: () => "1",
    getScriptSnapshot: (f) => {
      const c = f === file ? content : ts.sys.readFile(f);
      return c === undefined ? undefined : ts.ScriptSnapshot.fromString(c);
    },
    getCurrentDirectory: () => VDIR,
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: (f) => f === file || ts.sys.fileExists(f),
    readFile: (f) => (f === file ? content : ts.sys.readFile(f)),
  };
  const info = {
    languageService: ts.createLanguageService(host),
    languageServiceHost: host,
    project: {
      getProjectName: () => "/review-project/tsconfig.json",
      getCompilerOptions: () => host.getCompilationSettings(),
      getFileNames: () => [file],
      getCurrentDirectory: () => VDIR,
      projectService: { logger: { info: vi.fn(), msg: vi.fn() } },
    },
    serverHost: {},
    config: {},
  } as unknown as ts.server.PluginCreateInfo;
  return init({ typescript: ts }).create(info);
}

describe("a comprehension that fails to expand keeps its yield: continuation", () => {
  it("language service: reports the undefined names in both yield: continuations", () => {
    const file = path.join(VDIR, "comp-failed-expansion.ts");
    const ls = languageService(file, FAILING);
    const diags = [...ls.getSemanticDiagnostics(file), ...ls.getSyntacticDiagnostics(file)];
    // What check reports, at the positions written: the undefined names in
    // both continuations and the two expansion failures -- and nothing on the
    // preprocessor's `__letyield_N` tag or the unexpanded block's own syntax.
    const reported = diags
      .map((d) => `${d.code} ${FAILING.slice(d.start!, d.start! + d.length!)}`)
      .sort();
    expect(reported).toEqual(["2304 nope", "2304 nope2", "9999 42", "9999 42"]);
  });

  it.skipIf(!fs.existsSync(cliPath))(
    "typesugar check: reports the same names",
    () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-comp-failed-"));
      try {
        fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(dir, "node_modules"), "dir");
        fs.writeFileSync(
          path.join(dir, "tsconfig.json"),
          JSON.stringify({
            compilerOptions: {
              target: "ES2022",
              module: "ESNext",
              moduleResolution: "Bundler",
              strict: true,
              skipLibCheck: true,
              types: [],
              outDir: "out",
            },
            include: ["src"],
          })
        );
        fs.writeFileSync(path.join(dir, "package.json"), `{"name":"fixture","type":"module"}`);
        fs.mkdirSync(path.join(dir, "src"));
        fs.writeFileSync(path.join(dir, "src", "fail.ts"), FAILING);
        const r = spawnSync(process.execPath, [cliPath, "check"], {
          cwd: dir,
          encoding: "utf-8",
          timeout: 120_000,
        });
        const output = (r.stdout ?? "") + (r.stderr ?? "");
        expect(r.status, output).toBe(1);
        expect(output).toContain("fail.ts(6,14): error TS2304: Cannot find name 'nope'.");
        expect(output).toContain("fail.ts(10,12): error TS2304: Cannot find name 'nope2'.");
        expect(output).toContain("infer type constructor");
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    120_000
  );
});

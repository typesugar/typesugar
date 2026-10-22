/**
 * Assigning a value of an `@opaque` type's underlying representation to it
 * (and back) is free in `typesugar check`, `typesugar build` and the editor
 * (turf case study, round 2, item 4; PHILOSOPHY.md "Implicit conversions").
 *
 * `typesugar check` reported TS2322/TS2345 for `const o: Option<number> =
 * numberOrNull` (Option from @typesugar/fp's .d.ts), for the same value
 * passed as an argument, and for a same-file `/** @opaque A | undefined *\/`
 * type: it filters the source's diagnostics before it expands anything, and
 * the TypeRewriteAssignment rule matches against the type-rewrite registry,
 * which only the expansion filled in. `build` filters after emit, so it hid
 * them. Each test runs the real CLI (built: `pnpm --filter
 * @typesugar/transformer build`) or the real language-service plugin.
 */

import { describe, it, expect, afterAll, vi } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";
import * as ts from "typescript";
import init from "../src/language-service.js";
import { emitDeclarations } from "../src/declarations.js";
import "@typesugar/macros";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pkgRoot, "..", "..");
const cliPath = path.join(pkgRoot, "dist", "cli.js");

const MAIN = `import "typesugar";
import { type Option } from "@typesugar/fp";

declare const numberOrNull: number | null;
export const o: Option<number> = numberOrNull;
function take(x: Option<number>): number {
  return x === null ? 0 : 1;
}
export const t = take(numberOrNull);
export const back: number | null = o;

/** @opaque A | undefined */
export interface Maybe<A> {
  get(): A;
}
declare const numberOrUndefined: number | undefined;
export const m: Maybe<number> = numberOrUndefined;

// A real mismatch is still reported.
export const wrong: Option<number> = "text";
`;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

function project(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-opaque-assign-"));
  dirs.push(dir);
  fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(dir, "node_modules"), "dir");
  fs.writeFileSync(path.join(dir, "package.json"), `{"type":"module"}`);
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
        rootDir: "src",
      },
      include: ["src"],
    })
  );
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "main.ts"), MAIN);
  return dir;
}

/** The `file(line,col): error TSxxxx` lines of a CLI run. */
function errors(dir: string, command: string): string[] {
  const r = spawnSync(process.execPath, [cliPath, command], {
    cwd: dir,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  });
  return ((r.stdout ?? "") + (r.stderr ?? ""))
    .split("\n")
    .filter((l) => /error TS\d+/.test(l))
    .map((l) => l.replace(/^.*main\.ts/, "main.ts").replace(/: error (TS\d+).*$/, " $1"));
}

const WRONG_LINE = MAIN.split("\n").findIndex((l) => l.startsWith("export const wrong")) + 1;

describe("@opaque assignment from/to the underlying type is free", () => {
  for (const command of ["check", "build"]) {
    it.skipIf(!fs.existsSync(cliPath))(`typesugar ${command}`, () => {
      expect(errors(project(), command)).toEqual([`main.ts(${WRONG_LINE},14) TS2322`]);
    });
  }

  it("the emitDeclarations() API", () => {
    const dir = project();
    const result = emitDeclarations({ cwd: dir, declarationDir: "dts" });
    const errs = result.diagnostics
      .filter((d) => d.category === ts.DiagnosticCategory.Error)
      .map((d) => {
        const { line } = ts.getLineAndCharacterOfPosition(d.file!, d.start!);
        return `main.ts(${line + 1}) TS${d.code}`;
      });
    expect(errs).toEqual([`main.ts(${WRONG_LINE}) TS2322`]);
  });

  it("the language service", () => {
    // Inside the repo (gitignored .typesugar/), so @typesugar/fp resolves.
    fs.mkdirSync(path.join(repoRoot, ".typesugar"), { recursive: true });
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(repoRoot, ".typesugar", "ls-opaque-")));
    dirs.push(dir);
    const file = path.join(dir, "main.ts");
    const files = new Map([[file, MAIN]]);
    const settings = (): ts.CompilerOptions => ({
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      skipLibCheck: true,
      types: [],
    });
    const host: ts.LanguageServiceHost = {
      getCompilationSettings: settings,
      getScriptFileNames: () => Array.from(files.keys()),
      getScriptVersion: () => "1",
      getScriptSnapshot: (f) => {
        const c = files.get(f) ?? ts.sys.readFile(f);
        return c === undefined ? undefined : ts.ScriptSnapshot.fromString(c);
      },
      getCurrentDirectory: () => dir,
      getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
      fileExists: (f) => files.has(f) || ts.sys.fileExists(f),
      readFile: (f) => files.get(f) ?? ts.sys.readFile(f),
      directoryExists: (d) => ts.sys.directoryExists(d),
      realpath: (p) => ts.sys.realpath?.(p) ?? p,
    };
    const info = {
      languageService: ts.createLanguageService(host),
      languageServiceHost: host,
      project: {
        getProjectName: () => path.join(dir, "tsconfig.json"),
        getCompilerOptions: settings,
        getFileNames: () => Array.from(files.keys()),
        getCurrentDirectory: () => dir,
        projectService: { logger: { info: vi.fn(), msg: vi.fn() } },
        markAsDirty: vi.fn(),
      },
      serverHost: {},
      config: {},
    } as unknown as ts.server.PluginCreateInfo;
    const proxy = init({ typescript: ts }).create(info);
    const diags = proxy
      .getSemanticDiagnostics(file)
      .filter((d) => d.category === ts.DiagnosticCategory.Error)
      .map((d) => {
        const { line } = ts.getLineAndCharacterOfPosition(d.file!, d.start!);
        return `main.ts(${line + 1}) TS${d.code}`;
      });
    expect(diags).toEqual([`main.ts(${WRONG_LINE}) TS2322`]);
  });
});

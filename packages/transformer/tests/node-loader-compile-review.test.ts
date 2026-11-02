/**
 * The Node loader's compile step agrees with tsc and with the loader's own
 * candidate check: class-field semantics when the tsconfig sets no target,
 * and JSX in a `.TSX` file (the candidate check is case-insensitive).
 */

import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { createLoaderCompiler } from "../src/node-loader-compile.js";
import { createNodeLoaderHooks } from "../src/node-loader.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function makeProject(compilerOptions: object, files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-loader-review-"));
  dirs.push(dir);
  fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(dir, "node_modules"), "dir");
  fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions }));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "fx", type: "module" }));
  for (const [rel, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

const MACRO = `import { comptime } from "typesugar";\nexport const answer: number = comptime(() => 6 * 7);\n`;

describe("node loader compile: class fields with no tsconfig target", () => {
  it("uses tsc's default target's semantics (TypeScript 5.9: ES5, so assignment)", () => {
    const dir = makeProject(
      { module: "ESNext", moduleResolution: "Bundler", strict: true, skipLibCheck: true },
      { "m.ts": MACRO + `export class C { x = 1; }\n` }
    );
    const out = createLoaderCompiler().compile(path.join(dir, "m.ts"), "module");
    if (!out.changed) throw new Error("expected a change");
    expect(out.source).toMatch(/export const answer = 42/);
    expect(out.source).toMatch(/constructor\(\) \{\s*this\.x = 1;/);
  });

  it("follows the target tsc derives from module NodeNext (ESNext: define)", () => {
    const dir = makeProject(
      { module: "NodeNext", moduleResolution: "NodeNext", strict: true, skipLibCheck: true },
      { "m.ts": MACRO + `export class C { x = 1; }\n` }
    );
    const out = createLoaderCompiler().compile(path.join(dir, "m.ts"), "module");
    if (!out.changed) throw new Error("expected a change");
    expect(out.source).toMatch(/class C \{\s*x = 1;/);
  });
});

describe("node loader compile: JSX", () => {
  it("compiles JSX in a .TSX file as in a .tsx one", () => {
    const code = MACRO + `export const el = <div>{answer}</div>;\n`;
    const dir = makeProject(
      { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", skipLibCheck: true },
      { "lower.tsx": code, "UPPER.TSX": code }
    );
    const lower = createLoaderCompiler().compile(path.join(dir, "lower.tsx"), "module");
    if (!lower.changed) throw new Error("expected a change");
    expect(lower.source).not.toContain("<div>");
    const upper = createLoaderCompiler().compile(path.join(dir, "UPPER.TSX"), "module");
    if (!upper.changed) throw new Error("expected a change");
    expect(upper.source).not.toContain("<div>");
  });
});

describe("node loader: an unchanged TypeScript file on a Node that cannot run it", () => {
  // Node before 22.18 / 23.6 (without --experimental-strip-types) has no
  // type stripping: a file the expansion leaves alone reaches Node as .ts.
  const unknownExtension = (): never => {
    throw Object.assign(new TypeError('Unknown file extension ".ts" for /p/src/a.ts'), {
      code: "ERR_UNKNOWN_FILE_EXTENSION",
    });
  };
  const unchanged = () => ({ compile: () => ({ changed: false as const }) });
  const url = pathToFileURL(path.join(path.sep, "p", "src", "a.ts")).href;

  it("says what to do (sync hooks)", () => {
    const hooks = createNodeLoaderHooks({ createCompiler: unchanged });
    let error: (Error & { code?: string }) | undefined;
    try {
      hooks.load(url, { format: undefined }, unknownExtension);
    } catch (e) {
      error = e as Error & { code?: string };
    }
    expect(error?.code).toBe("ERR_UNKNOWN_FILE_EXTENSION");
    expect(error?.message).toMatch(/typesugar/);
    expect(error?.message).toMatch(/22\.18/);
    expect(error?.message).toMatch(/tsx/);
  });

  it("says what to do (async hooks, the module.register() fallback)", async () => {
    const hooks = createNodeLoaderHooks({ createCompiler: unchanged });
    await expect(hooks.loadAsync(url, { format: undefined }, unknownExtension)).rejects.toThrow(
      /22\.18.*tsx/s
    );
  });

  it("leaves other load errors and non-TypeScript modules alone", () => {
    const hooks = createNodeLoaderHooks({ createCompiler: unchanged });
    const other = new Error("boom");
    expect(() =>
      hooks.load(url, { format: undefined }, () => {
        throw other;
      })
    ).toThrow(other);
    const jsError = Object.assign(new Error("x"), { code: "ERR_UNKNOWN_FILE_EXTENSION" });
    expect(() =>
      hooks.load("file:///p/a.weird", { format: undefined }, () => {
        throw jsError;
      })
    ).toThrow(jsError);
  });
});

/**
 * Regression tests for the 2026-10 docs review, "tooling" group
 * (peps/reviews/2026-10-docs-arch-review/docs-authoring.md "1.0 gaps",
 * docs-guides-c.md helper caveat).
 *
 * Macro packages must resolve from the USER'S project, not from wherever the
 * transformer itself is installed. These tests run the real pipeline (from
 * src, via tsx) in a child Node process with NODE_PATH cleared, against a real
 * on-disk project in the OS temp dir, so resolution is exactly plain Node's.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as ts from "typescript";

const REPO = path.resolve(__dirname, "../../..");
const PIPELINE_SRC = path.resolve(__dirname, "../src/pipeline.ts");

let dir: string;

function project(files: Record<string, string>, links: Record<string, string> = {}) {
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  for (const [name, target] of Object.entries(links)) {
    const linkPath = path.join(dir, "node_modules", ...name.split("/"));
    fs.mkdirSync(path.dirname(linkPath), { recursive: true });
    fs.symlinkSync(target, linkPath, "dir");
  }
  fs.writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        skipLibCheck: true,
      },
      include: ["src"],
    })
  );
}

interface RunResult {
  code: string;
  diagnostics: Array<{ message: string; severity: string }>;
  warnings: string[];
}

/** Transform `src/a.ts` with the real pipeline in a plain Node process. */
function transformInNode(): RunResult {
  const runner = path.join(dir, "run.mjs");
  fs.writeFileSync(
    runner,
    `const warnings = [];\n` +
      `console.warn = (...a) => warnings.push(a.map(String).join(" "));\n` +
      `const { createPipeline } = await import(${JSON.stringify(PIPELINE_SRC)});\n` +
      `const p = createPipeline(${JSON.stringify(path.join(dir, "tsconfig.json"))}, { cacheDir: false });\n` +
      `const r = p.transform(${JSON.stringify(path.join(dir, "src/a.ts"))});\n` +
      `process.stdout.write("@@RESULT@@" + JSON.stringify({ code: r.code, diagnostics: r.diagnostics, warnings }));\n`
  );
  const r = spawnSync(process.execPath, ["--import", "tsx", runner], {
    cwd: REPO,
    // pnpm's bin shims put node_modules/.pnpm/node_modules (where every
    // workspace package is hoisted) on NODE_PATH, which would let a bare
    // require() find @typesugar/validate from anywhere and hide the bug.
    env: { ...process.env, NODE_PATH: "" },
    encoding: "utf-8",
    timeout: 120_000,
  });
  const out = r.stdout ?? "";
  const idx = out.indexOf("@@RESULT@@");
  if (idx === -1) throw new Error(`runner failed:\n${out}\n${r.stderr}`);
  return JSON.parse(out.slice(idx + "@@RESULT@@".length)) as RunResult;
}

/** Evaluate a transformed module's exports (ESM -> CJS via transpileModule). */
function evalModule(code: string): Record<string, unknown> {
  const js = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} as Record<string, unknown> };
  new Function("module", "exports", "require", js)(mod, mod.exports, () => ({}));
  return mod.exports;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-tooling-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("macro packages resolve from the user's project, not the transformer's install", () => {
  it("loads @typesugar/validate installed only in the project and expands is<User>()", () => {
    project(
      {
        "src/a.ts":
          `import { is } from "@typesugar/validate";\n` +
          `interface User { name: string; age: number }\n` +
          `const isUser = is<User>();\n` +
          `export const good = isUser({ name: "a", age: 1 });\n` +
          `export const bad = isUser({ name: "a" });\n`,
      },
      { "@typesugar/validate": path.join(REPO, "packages/validate") }
    );
    const result = transformInNode();
    expect(result.code).not.toMatch(/is<User>\(\)/);
    const mod = evalModule(result.code);
    expect(mod.good).toBe(true);
    expect(mod.bad).toBe(false);
  });

  it("warns visibly when an imported @typesugar/* package cannot be resolved", () => {
    project({
      "src/a.ts": `import { is } from "@typesugar/not-installed-pkg";\nexport const x = is;\n`,
    });
    const result = transformInNode();
    const messages = result.diagnostics
      .filter((d) => d.severity === "warning")
      .map((d) => d.message);
    expect(messages.some((m) => /@typesugar\/not-installed-pkg/.test(m))).toBe(true);
  });

  it("warns visibly when a declared macro entry fails to load", () => {
    fs.mkdirSync(path.join(dir, "broken-pkg"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "broken-pkg/package.json"),
      JSON.stringify({
        name: "@typesugar/broken-fixture",
        version: "1.0.0",
        main: "index.js",
        typesugar: { macros: "./macros" },
        exports: {
          ".": "./index.js",
          "./macros": "./macros.js",
          "./package.json": "./package.json",
        },
      })
    );
    fs.writeFileSync(path.join(dir, "broken-pkg/index.js"), "module.exports = {};\n");
    fs.writeFileSync(path.join(dir, "broken-pkg/index.d.ts"), "export declare const y: 1;\n");
    fs.writeFileSync(
      path.join(dir, "broken-pkg/macros.js"),
      `throw new Error("macro module exploded");\n`
    );
    project(
      { "src/a.ts": `import { y } from "@typesugar/broken-fixture";\nexport const x = y;\n` },
      { "@typesugar/broken-fixture": path.join(dir, "broken-pkg") }
    );
    const result = transformInNode();
    const messages = result.diagnostics
      .filter((d) => d.severity === "warning")
      .map((d) => d.message);
    expect(messages.some((m) => /broken-fixture/.test(m) && /exploded/.test(m))).toBe(true);
  });
});

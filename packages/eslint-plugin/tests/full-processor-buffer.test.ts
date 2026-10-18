/**
 * The full processor must lint the text ESLint hands it (an unsaved editor
 * buffer, stdin), not the file on disk (deep review tooling #5).
 *
 * Runs in its own file: the full processor's pipeline is a module singleton
 * created from the tsconfig in process.cwd(), so this test points cwd at a
 * tiny temporary project before the first lint.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Linter } from "eslint";
import { fullConfig, clearTransformCache } from "../src/index.js";

let dir: string;
let previousCwd: string;

beforeAll(() => {
  previousCwd = process.cwd();
  dir = realpathSync(mkdtempSync(join(tmpdir(), "ts-eslint-full-")));
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext" }, include: ["*.ts"] })
  );
  writeFileSync(join(dir, "a.ts"), "export const x = 1;\n");
  process.chdir(dir);
  clearTransformCache();
});

afterAll(() => {
  process.chdir(previousCwd);
  rmSync(dir, { recursive: true, force: true });
});

function lint(text: string) {
  const linter = new Linter({ configType: "flat", cwd: dir });
  return linter.verify(
    text,
    [{ files: ["**/*.ts"], ...fullConfig, rules: { "no-var": "error" } }] as Linter.Config[],
    { filename: join(dir, "a.ts") }
  );
}

describe("full processor lints the buffer, not the disk (tooling #5)", () => {
  it("reports problems that exist only in the unsaved buffer", () => {
    // Disk has `export const x = 1;` — no `var` anywhere.
    const msgs = lint("var x = 1;\nexport { x };\n");
    expect(msgs.map((m) => `${m.line}:${m.column} ${m.ruleId}`)).toEqual(["1:1 no-var"]);
  });

  it("follows further edits to the buffer, and back to the disk content", () => {
    expect(lint("export const x = 1;\nvar y = 2;\nexport { y };\n").map((m) => m.line)).toEqual([
      2,
    ]);
    expect(lint("export const x = 1;\n")).toEqual([]);
  });

  it("--fix with real macro expansion never corrupts the buffer", () => {
    const text = [
      `import { comptime } from "typesugar";`,
      `var a = comptime(() => 1 + 2);`,
      // written the way the TS printer prints it, so this line survives the
      // transform verbatim (a line the printer reformats can't be proven
      // safe to fix, and its fix is dropped)
      `var b = 1;`,
      `export { a, b };`,
      ``,
    ].join("\n");
    const linter = new Linter({ configType: "flat", cwd: dir });
    const r = linter.verifyAndFix(
      text,
      [{ files: ["**/*.ts"], ...fullConfig, rules: { "no-var": "error" } }] as Linter.Config[],
      { filename: join(dir, "a.ts") }
    );
    const lines = r.output.split("\n");
    // Lines the transformer left verbatim are fixed exactly as ESLint would...
    expect(lines[2]).toBe("let b = 1;");
    // ...the macro line (expanded to `var a = 3;`) differs from the original,
    // so its fix is dropped rather than applied at a wrong offset.
    expect(lines[1]).toBe(`var a = comptime(() => 1 + 2);`);
    expect(r.messages.map((m) => `${m.line} ${m.ruleId} ${m.fix ? "fix" : "nofix"}`)).toEqual([
      "2 no-var nofix",
    ]);
    expect(lines[0]).toBe(`import { comptime } from "typesugar";`);
    expect(lines[3]).toBe(`export { a, b };`);
  });
});

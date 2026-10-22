/**
 * A fluent `match()` on a value TypeScript has narrowed reads it from a const
 * asserted to the value's declared type (`const _circle = circle as Shape;`),
 * so the expansion type-checks as the code was written (std's
 * match-scrutinee-typing.test.ts). The assertion is for the checker only: the
 * JavaScript must be byte-for-byte what it was without it.
 *
 * Each file below (std's showcase and the docs playground examples that use
 * `match()`) is expanded twice, with the assertion and without it
 * (TYPESUGAR_MATCH_NO_SCRUTINEE_WIDENING=1, read by std's match macro for
 * this test), and the emitted JavaScript is compared. The expanded
 * TypeScript must differ somewhere (the showcase matches on a narrowed
 * `circle`), or the comparison proves nothing.
 */
import { describe, it, expect, afterEach } from "vitest";
import * as ts from "typescript";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { TransformationPipeline } from "@typesugar/transformer";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV = "TYPESUGAR_MATCH_NO_SCRUTINEE_WIDENING";

function matchExamples(): string[] {
  const out = [path.join(repoRoot, "packages/std/examples/showcase.ts")];
  const walk = (dir: string): void => {
    for (const entry of fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (p.endsWith(".ts") && /\bmatch\(/.test(fs.readFileSync(p, "utf-8"))) out.push(p);
    }
  };
  walk(path.join(repoRoot, "docs/examples"));
  return out;
}

function expand(file: string, widen: boolean): { ts: string; js: string } {
  if (widen) delete process.env[ENV];
  else process.env[ENV] = "1";
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    experimentalDecorators: true,
  };
  const pipeline = new TransformationPipeline(options, [file], { cacheDir: false });
  const code = pipeline.transform(file).code;
  const js = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    fileName: file,
  }).outputText;
  return { ts: code, js };
}

afterEach(() => {
  delete process.env[ENV];
});

describe("the scrutinee's type assertion leaves the JavaScript unchanged", () => {
  const files = matchExamples();
  let differing = 0;

  for (const file of files) {
    it(path.relative(repoRoot, file), () => {
      const widened = expand(file, true);
      const plain = expand(file, false);
      if (widened.ts !== plain.ts) differing++;
      // A line that differs between two identical runs is not the
      // assertion's doing (welcome.ts's `comptime` build id is random).
      const again = expand(file, false).js.split("\n");
      const lines = plain.js.split("\n");
      expect(again.length).toBe(lines.length);
      const stable = (js: string) =>
        js
          .split("\n")
          .map((l, i) => (again[i] === lines[i] ? l : "<nondeterministic>"))
          .join("\n");
      expect(stable(widened.js)).toBe(stable(plain.js));
    });
  }

  it("the assertion was added somewhere (the comparison is not vacuous)", () => {
    expect(files.length).toBeGreaterThan(1);
    expect(differing).toBeGreaterThan(0);
  });
});

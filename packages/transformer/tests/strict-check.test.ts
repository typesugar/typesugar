/**
 * `--strict` type-checks the expansion the build itself made, and filters
 * its diagnostics against that expanded program.
 *
 * It used to expand detached re-parsed copies of every file first: the
 * macros asked the checker about nodes of a tree it never bound, so some
 * calls expanded wrongly or not at all (fp's `case Some(v)`), and errors such
 * as "Cannot find name 's'" for a parameter leaked into the diagnostics of
 * the unexpanded program. The expanded program's diagnostics were then
 * filtered with the unexpanded program's checker and source files, whose
 * text their positions don't refer to; and typesugar's own `.d.ts`, served in
 * the runtime view of `@opaque` types, had a syntax error (a prose
 * "@opaque type" read as a tag).
 */

import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as ts from "typescript";
import {
  opaqueTypesAsUnderlying,
  registerDiagnosticSuppressionRule,
  getDiagnosticSuppressionRules,
  clearDiagnosticSuppressionRules,
  type DiagnosticSuppressionRule,
} from "@typesugar/core";
import { spawnSync } from "child_process";
import { typecheckExpandedProgram } from "../src/strict-check.js";
import { expandProgramSources } from "../src/declarations.js";
import { macroTransformerFactory } from "../src/pipeline.js";

const repoRoot = path.resolve(__dirname, "..", "..", "..");

let saved: readonly DiagnosticSuppressionRule[] = [];
afterEach(() => {
  clearDiagnosticSuppressionRules();
  for (const r of saved) registerDiagnosticSuppressionRule(r);
});

describe("--strict: the expanded program's diagnostics", () => {
  it("the runtime view of @opaque types ignores '@opaque' in prose", () => {
    // typesugar's own index.d.ts: its interface became `type
    // MethodInlinePattern = type can be inlined ...;`, a syntax error every
    // --strict run reported.
    const text = `/**
 * How a call on an @opaque type can be inlined.
 */
export interface MethodInlinePattern {
    readonly kind: "fold";
}
/** @opaque A | null */
export interface Option<A> {
    map<B>(f: (a: A) => B): Option<B>;
}
`;
    const out = opaqueTypesAsUnderlying("/x/index.d.ts", text);
    expect(out).toContain("export interface MethodInlinePattern {");
    expect(out).toContain("export type Option<A> = A | null;");
  });

  it("are suppression-filtered against the expanded files their positions refer to", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-strict-"));
    try {
      fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(dir, "node_modules"), "dir");
      const file = path.join(dir, "main.ts");
      fs.writeFileSync(
        file,
        `import { comptime } from "typesugar";
export const a = comptime(() => [1, 2, 3].map((n) => n * 2).reduce((x, y) => x + y, 0));
export const bad: string = 1;
`
      );
      const options: ts.CompilerOptions = {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        strict: true,
        skipLibCheck: true,
        types: [],
        noEmit: true,
      };
      const program = ts.createProgram([file], options);

      // A rule that records what it was asked about, and suppresses TS2322
      // only when the node at the diagnostic's position is `bad`.
      const seen: string[] = [];
      saved = getDiagnosticSuppressionRules();
      clearDiagnosticSuppressionRules();
      registerDiagnosticSuppressionRule({
        name: "Probe",
        errorCodes: [2322],
        shouldSuppress(d, _checker, sourceFile) {
          seen.push(sourceFile.text);
          return sourceFile.text.slice(d.start!, d.start! + d.length!) === "bad";
        },
      });

      const expanded = expandProgramSources(program, macroTransformerFactory(program, {}));
      const diagnostics = typecheckExpandedProgram({
        rootNames: [file],
        options,
        host: ts.createCompilerHost(options),
        expanded,
      });
      expect(seen).toHaveLength(1);
      expect(seen[0]).not.toContain("comptime(");
      expect(seen[0]).toContain("export const a = 12;");
      expect(diagnostics.map((d) => d.code)).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  const cliPath = path.join(repoRoot, "packages", "transformer", "dist", "cli.js");
  it.skipIf(!fs.existsSync(cliPath))(
    "typesugar check --strict and build --strict: no false positives on correct code",
    () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-strict-cli-"));
      try {
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
            },
            include: ["src"],
          })
        );
        fs.mkdirSync(path.join(dir, "src"));
        fs.writeFileSync(
          path.join(dir, "src", "main.ts"),
          `import "@typesugar/std/syntax/match";
import { comptime } from "typesugar";
import { Some, None, type Option } from "@typesugar/fp";
type Shape = { kind: "circle"; r: number } | { kind: "rect"; w: number; h: number };
export function area(s: Shape): number {
  match: switch (s) {
    case { kind: "circle", r }:
      return Math.PI * r * r;
    case { kind: "rect", w, h }:
      return w * h;
  }
}
export function twice(o: Option<number>): number {
  let out = 0;
  match: switch (o) {
    case Some(v):
      out = v * 2;
      break;
    case None:
      out = -1;
      break;
  }
  return out;
}
export const answer = comptime(() => 6 * 7);
console.log(area({ kind: "rect", w: 2, h: 3 }), twice(Some(4)), twice(None), answer);
`
        );
        for (const command of ["check", "build"]) {
          const r = spawnSync(process.execPath, [cliPath, command, "--strict"], {
            cwd: dir,
            encoding: "utf-8",
            stdio: ["ignore", "pipe", "pipe"],
            timeout: 120_000,
          });
          expect((r.stdout ?? "") + (r.stderr ?? "")).toBe("");
          expect(r.status).toBe(0);
        }
        const run = spawnSync(process.execPath, [path.join(dir, "out", "main.js")], {
          encoding: "utf-8",
        });
        expect(run.stdout.trim()).toBe("6 8 -1 42");
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  );
});

/**
 * The playground's global typeclass declarations — the server compiler's
 * (api/playground-declarations.ts) and Monaco's
 * (docs/.vitepress/components/playground-package-types.ts) — must be the
 * real typeclasses, not hand-written copies. The copies drifted: `Eq` had
 * `eq`/`neq` (std's has `equals`/`notEquals`) and `Ord.compare` returned
 * `number` (std's returns `-1 | 0 | 1`). They are now aliases of the real
 * `.d.ts` (`type Eq<A> = import("@typesugar/std").Eq<A>`), which can't drift;
 * this keeps them aliases and keeps the two files in step.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";
import { AMBIENT_DECLARATIONS } from "../api/playground-declarations.js";

const ROOT = path.resolve(__dirname, "..");

function monacoGlobals(): string {
  const src = fs.readFileSync(
    path.join(ROOT, "docs/.vitepress/components/playground-package-types.ts"),
    "utf8"
  );
  const m = /const GLOBALS_CONTENT = `([\s\S]*?)`;/.exec(src);
  if (!m) throw new Error("GLOBALS_CONTENT not found in playground-package-types.ts");
  return m[1];
}

const SOURCES = {
  "api/playground-declarations.ts": AMBIENT_DECLARATIONS,
  "playground-package-types.ts": monacoGlobals(),
};

const TYPECLASSES = ["Eq", "Ord", "Clone", "Debug", "Hash", "Show"];

/** The `type X<A> = import(...)...` and `declare const` lines of a globals file. */
function typeclassLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(
      (l) => /^type \w+<A> = import\(/.test(l) || /^declare const \w+: typeof import\(/.test(l)
    )
    .sort();
}

/** Type-check `probe` with `globals` as an ambient file, against the real packages. */
function check(globals: string, probe: string): string[] {
  const dir = path.join(ROOT, "tests");
  const globalsFile = path.join(dir, "__playground_globals_check__.d.ts");
  const probeFile = path.join(dir, "__playground_globals_probe__.ts");
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
  const files = new Map([
    [globalsFile, globals],
    [probeFile, probe],
  ]);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.readFile = (f) => files.get(f) ?? readFile(f);
  host.fileExists = (f) => files.has(f) || fileExists(f);
  const program = ts.createProgram([globalsFile, probeFile], options, host);
  return ts
    .getPreEmitDiagnostics(program)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
}

const PROBE = `
import type * as std from "@typesugar/std";
import type * as fp from "@typesugar/fp";
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export const same: [
  Same<Eq<number>, std.Eq<number>>,
  Same<Ord<number>, std.Ord<number>>,
  Same<Clone<number>, std.Clone<number>>,
  Same<Debug<number>, std.Debug<number>>,
  Same<Hash<number>, std.Hash<number>>,
  Same<Show<number>, fp.Show<number>>,
  Same<typeof eqNumber, std.Eq<number>>,
  Same<typeof ordString, std.Ord<string>>,
] = [true, true, true, true, true, true, true, true];
export const order: -1 | 0 | 1 = ordNumber.compare(1, 2);
export const equal: boolean = eqString.equals("a", "b") && eqBoolean.notEquals(true, false);
`;

describe("playground global typeclass declarations", () => {
  for (const [name, text] of Object.entries(SOURCES)) {
    it(`${name}: aliases of the real typeclasses, not copies`, () => {
      for (const tc of TYPECLASSES) {
        expect(text, `${tc} is declared as an interface`).not.toMatch(
          new RegExp(`interface ${tc}<`)
        );
      }
      expect(check(text, PROBE)).toEqual([]);
    });
  }

  it("the server's and Monaco's declare the same types and instances", () => {
    const [a, b] = Object.values(SOURCES).map(typeclassLines);
    expect(a.length).toBeGreaterThanOrEqual(TYPECLASSES.length);
    expect(a).toEqual(b);
  });
});

/**
 * The tsserver plugin agrees with `typesugar check` on code that is correct
 * once expanded but not as written:
 *
 * - an exhaustive destructuring `match: switch` whose every case returns
 *   (TS2366 "Function lacks ending return statement" as written);
 * - a value import / re-export of a type whose derives make it a value, under
 *   `verbatimModuleSyntax` and `isolatedModules` (TS1484, TS1205);
 * - `typeof Vec.Eq` in a type position (TS2693).
 *
 * The plugin checks the expanded program, so it already reported none of
 * these when `typesugar check` did (the CLI filters the unexpanded program's
 * diagnostics); this pins that. The CLI side is in
 * derive-companion-reexports.test.ts and the rule's unit tests (macros
 * diagnostic-suppression-rules.test.ts).
 */

import { describe, it, expect, vi } from "vitest";
import * as path from "path";
import * as ts from "typescript";
import init from "../src/language-service.js";
import "@typesugar/macros";

const VDIR = path.resolve(__dirname, "__virtual_derived_values__");

function createProject(files: Map<string, string>, options: ts.CompilerOptions = {}) {
  const settings = (): ts.CompilerOptions => ({
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    types: [],
    ...options,
  });
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: settings,
    getScriptFileNames: () => Array.from(files.keys()),
    getScriptVersion: () => "1",
    getScriptSnapshot: (f) => {
      const c = files.get(f) ?? ts.sys.readFile(f);
      return c === undefined ? undefined : ts.ScriptSnapshot.fromString(c);
    },
    getCurrentDirectory: () => VDIR,
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: (f) => files.has(f) || ts.sys.fileExists(f),
    readFile: (f) => files.get(f) ?? ts.sys.readFile(f),
  };
  const info = {
    languageService: ts.createLanguageService(host),
    languageServiceHost: host,
    project: {
      getProjectName: () => "/derived-values-project/tsconfig.json",
      getCompilerOptions: settings,
      getFileNames: () => Array.from(files.keys()),
      getCurrentDirectory: () => VDIR,
      projectService: { logger: { info: vi.fn(), msg: vi.fn() } },
    },
    serverHost: {},
    config: {},
  } as unknown as ts.server.PluginCreateInfo;
  return init({ typescript: ts }).create(info);
}

function errors(proxy: ts.LanguageService, file: string): string[] {
  return proxy
    .getSemanticDiagnostics(file)
    .filter((d) => d.category === ts.DiagnosticCategory.Error)
    .map((d) => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
}

describe("tsserver plugin: code that is correct once expanded", () => {
  it("an exhaustive destructuring match: switch that returns in every case", () => {
    const file = path.join(VDIR, "area.ts");
    const proxy = createProject(
      new Map([
        [
          file,
          `import "@typesugar/std/syntax/match";
type Shape = { kind: "circle"; r: number } | { kind: "rect"; w: number; h: number };
export function area(s: Shape): number {
  match: switch (s) {
    case { kind: "circle", r }:
      return Math.PI * r * r;
    case { kind: "rect", w, h }:
      return w * h;
  }
}
export function brk(s: Shape): number {
  match: switch (s) {
    case { kind: "circle", r }:
      if (r > 1) break;
      return r;
    case { kind: "rect", w }:
      return w;
  }
}
`,
        ],
      ])
    );
    // brk really can fall off the end (the break): still reported.
    expect(errors(proxy, file)).toEqual([
      "TS2366: Function lacks ending return statement and return type does not include 'undefined'.",
    ]);
  });

  for (const [label, options] of [
    ["verbatimModuleSyntax", { verbatimModuleSyntax: true }],
    ["isolatedModules", { isolatedModules: true }],
  ] as const) {
    it(`${label}: value import and re-export of a derived type, and typeof Vec.Eq`, () => {
      const vec = path.join(VDIR, "vec.ts");
      const idx = path.join(VDIR, "idx.ts");
      const use = path.join(VDIR, "use.ts");
      const plain = path.join(VDIR, "plain.ts");
      const proxy = createProject(
        new Map([
          [vec, `/** @derive(Eq, Clone) */\nexport interface Vec { x: number; y: number }\n`],
          [plain, `export interface Plain { x: number }\n`],
          [idx, `export { Vec } from "./vec.js";\nexport { Plain } from "./plain.js";\n`],
          [
            use,
            `import { Vec } from "./vec.js";
export { Vec };
export type VecEq = typeof Vec.Eq;
export const same = (a: Vec, b: Vec): boolean => Vec.Eq.equals(a, b);
`,
          ],
        ]),
        options
      );
      expect(errors(proxy, use)).toEqual([]);
      // A type without derives is still only a type.
      const idxErrors = errors(proxy, idx);
      expect(idxErrors).toHaveLength(1);
      expect(idxErrors[0]).toMatch(/^TS1205: .*/);
    });
  }
});

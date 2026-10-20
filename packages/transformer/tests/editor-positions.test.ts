/**
 * Position mapping between a file's source and the expanded code TypeScript
 * sees in the editor (PEP-060 item 5, the bugs the editor integration suite
 * recorded). These are the focused unit tests for the shared layers:
 *
 * - the pipeline's source map (a file without macros is passed through, and
 *   the reprint of a file with macros maps every token, including after a
 *   template literal), and
 * - the tsserver plugin's span translation (line/column conversion, code fixes,
 *   inlay hints, rename locations in generated code, the comptime hint).
 */

import { describe, it, expect, vi } from "vitest";
import * as path from "path";
import * as ts from "typescript";
import { transformCode } from "../src/pipeline.js";
import init from "../src/language-service.js";

// Load macro definitions (registers macros in the global registry)
import { setComptimeEvaluationEnabled } from "@typesugar/macros";

/** Original offset of `needle` (+ delta) → transformed offset → back. */
function roundTrip(
  result: ReturnType<typeof transformCode>,
  needle: string,
  delta = 0
): { original: number; transformed: number | null; back: number | null } {
  const original = result.original.indexOf(needle);
  expect(original, `"${needle}" in the source`).toBeGreaterThanOrEqual(0);
  const transformed = result.mapper.toTransformed(original + delta);
  const back = transformed === null ? null : result.mapper.toOriginal(transformed);
  return { original: original + delta, transformed, back };
}

describe("pipeline source map (what the editor plugin maps positions through)", () => {
  it("passes a file without macros through unchanged, so positions map by identity", () => {
    const code =
      `export function greet(name: string): string {\n` +
      `  return \`Hello, \${name}!\`;\n` +
      `}\n` +
      `\n` +
      `const msg = greet("world");\n`;
    const result = transformCode(code, { fileName: "no-macros.ts" });

    expect(result.changed).toBe(false);
    expect(result.code).toBe(code);
    const call = code.indexOf('greet("world")');
    expect(result.mapper.toTransformed(call)).toBe(call);
    expect(result.mapper.toOriginal(call)).toBe(call);
  });

  it("maps every token after a template literal with substitutions in an expanded file", () => {
    const code =
      `/** @derive(Eq) */\n` +
      `interface Point { x: number; y: number; }\n` +
      `\n` +
      `export function label(n: number): string {\n` +
      `  return \`#\${n} of \${n + 1}\`;\n` +
      `}\n` +
      `\n` +
      `const notANumber: number = label(1);\n`;
    const result = transformCode(code, { fileName: "template-after.ts" });
    expect(result.changed).toBe(true);

    for (const needle of ["notANumber", "label(1)", "n + 1"]) {
      const { original, transformed, back } = roundTrip(result, needle);
      expect(transformed, `"${needle}" maps into the expanded code`).not.toBeNull();
      expect(result.code.slice(transformed!, transformed! + needle.length)).toBe(needle);
      expect(back).toBe(original);
    }
  });

  it("maps tokens after a regular expression literal containing a backtick", () => {
    const code =
      `/** @derive(Eq) */\n` +
      `interface Point { x: number; y: number; }\n` +
      `\n` +
      "const re = /`[a-z]+'/g;\n" +
      `const after = re.source;\n`;
    const result = transformCode(code, { fileName: "regex-after.ts" });
    expect(result.changed).toBe(true);

    const { original, transformed, back } = roundTrip(result, "after");
    expect(transformed).not.toBeNull();
    expect(result.code.slice(transformed!, transformed! + "after".length)).toBe("after");
    expect(back).toBe(original);
  });

  it("records no expansion for a macro that hands back the call (comptime switched off)", () => {
    const code =
      `import { comptime } from "@typesugar/macros";\n` +
      `/** @derive(Eq) */\n` +
      `interface Point { x: number; y: number; }\n` +
      `export const a = comptime(() => 40 + 2);\n`;
    setComptimeEvaluationEnabled(false);
    try {
      const result = transformCode(code, { fileName: "comptime-off.ts" });
      expect(result.code).toContain("comptime(");
      expect(result.expansions?.map((e) => e.macroName) ?? []).not.toContain("comptime");
    } finally {
      setComptimeEvaluationEnabled(true);
    }
  });
});

// ---------------------------------------------------------------------------
// The tsserver plugin's span translation
// ---------------------------------------------------------------------------

const VDIR = path.resolve(__dirname, "__virtual_positions__");

function createProject(files: Map<string, string>) {
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => ({
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      skipLibCheck: true,
    }),
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
  const project = {
    getProjectName: () => "/positions-project/tsconfig.json",
    getCompilerOptions: host.getCompilationSettings,
    getFileNames: () => Array.from(files.keys()),
    getCurrentDirectory: () => VDIR,
    projectService: { logger: { info: vi.fn(), msg: vi.fn() } },
    markAsDirty: vi.fn(),
  };
  const info = {
    languageService: ts.createLanguageService(host),
    languageServiceHost: host,
    project,
    serverHost: {},
    config: {},
  } as unknown as ts.server.PluginCreateInfo;
  const proxy = init({ typescript: ts }).create(info);
  const served = (f: string) => {
    const snap = host.getScriptSnapshot(f)!;
    return snap.getText(0, snap.getLength());
  };
  return { proxy, served };
}

/** Line/character of an offset in `text`, the way an editor counts. */
function lineCol(text: string, offset: number): ts.LineAndCharacter {
  const before = text.slice(0, offset).split("\n");
  return { line: before.length - 1, character: before[before.length - 1].length };
}

const DERIVE_SRC =
  `// navigation across a @derive expansion\n` +
  `/** @derive(Eq) */\n` +
  `interface Vec {\n` +
  `  x: number;\n` +
  `  y: number;\n` +
  `}\n` +
  `\n` +
  `export function scale(v: Vec, k: number): Vec {\n` +
  `  return { x: v.x * k, y: v.y * k };\n` +
  `}\n` +
  `\n` +
  `const tripled = scale({ x: 1, y: 2 }, 3);\n`;

describe("tsserver plugin span translation", () => {
  it("converts a definition's source offset to line/column on the source text", () => {
    const main = path.join(VDIR, "pos-definition.ts");
    const { proxy, served } = createProject(new Map([[main, DERIVE_SRC]]));
    expect(served(main)).not.toBe(DERIVE_SRC);

    const call = DERIVE_SRC.indexOf("scale({") + 1;
    const result = proxy.getDefinitionAndBoundSpan(main, call);
    const decl = DERIVE_SRC.indexOf("scale(v: Vec");
    expect(result?.definitions?.map((d) => d.textSpan.start)).toEqual([decl]);
    // tsserver converts that offset with toLineColumnOffset: it must use the
    // SOURCE text, not the expanded code the language service has.
    expect(proxy.toLineColumnOffset!(main, decl)).toEqual(lineCol(DERIVE_SRC, decl));
  });

  it("offers TypeScript's quick fix in an expanded file, with the edit on the source", () => {
    const src = DERIVE_SRC + `const bad = scal({ x: 1, y: 2 }, 3);\n`;
    const main = path.join(VDIR, "pos-codefix.ts");
    const { proxy } = createProject(new Map([[main, src]]));

    const error = proxy.getSemanticDiagnostics(main).find((d) => d.start === src.indexOf("scal({"));
    expect(error, "the misspelled call is reported at its source position").toBeDefined();
    const fixes = proxy.getCodeFixesAtPosition(
      main,
      error!.start!,
      error!.start! + error!.length!,
      [error!.code],
      {},
      {}
    );
    const spelling = fixes.find((f) => f.fixName === "spelling");
    expect(spelling?.description).toBe("Change spelling to 'scale'");
    expect(spelling!.changes.flatMap((c) => c.textChanges)).toEqual([
      { span: { start: src.indexOf("scal({"), length: "scal".length }, newText: "scale" },
    ]);
  });

  it("shows TypeScript's inlay hints when the requested span starts and ends in comments", () => {
    const src = DERIVE_SRC + `const answer = 6 * 7;\n// trailing comment\n`;
    const main = path.join(VDIR, "pos-hints.ts");
    const { proxy } = createProject(new Map([[main, src]]));

    const hints = proxy.provideInlayHints(
      main,
      { start: 0, length: src.length },
      { includeInlayVariableTypeHints: true }
    );
    const typeHint = hints.find((h) => h.text === ": number");
    expect(typeHint?.position).toBe(src.indexOf("answer =") + "answer".length);
    // Nothing in the generated companion is shown on the @derive tag.
    const tag = src.indexOf("/** @derive");
    const tagEnd = src.indexOf("*/", tag);
    expect(hints.filter((h) => h.position >= tag && h.position <= tagEnd)).toEqual([]);
  });

  it("renames a @derive'd type only where the source names it, not on the @derive tag", () => {
    const main = path.join(VDIR, "pos-rename.ts");
    const { proxy } = createProject(new Map([[main, DERIVE_SRC]]));

    const locations = proxy.findRenameLocations(
      main,
      DERIVE_SRC.indexOf("Vec {") + 1,
      false,
      false,
      {}
    );
    const texts = locations!.map((l) =>
      DERIVE_SRC.slice(l.textSpan.start, l.textSpan.start + l.textSpan.length)
    );
    // interface Vec, scale's parameter and return type
    expect(texts).toEqual(["Vec", "Vec", "Vec"]);
  });

  it("shows no expansion hint for a comptime call that was not evaluated", () => {
    // The @derive makes the file an expanded one, so expansion hints are asked for.
    const src =
      `import { comptime } from "@typesugar/macros";\n` +
      DERIVE_SRC +
      `export const a = comptime(() => 40 + 2);\n`;
    const main = path.join(VDIR, "pos-comptime-off.ts");
    const { proxy, served } = createProject(new Map([[main, src]]));
    expect(served(main)).toContain("comptime(");

    const hints = proxy.provideInlayHints(main, { start: 0, length: src.length }, undefined);
    expect(hints.map((h) => h.text)).toEqual([]);
  });
});

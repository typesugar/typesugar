/**
 * Pre-merge review of the language-service plugin: refactors in expanded
 * files, code-fix edits next to text the transform changed, inlay-hint
 * parsing, and "Expand Macro at Cursor".
 */

import { describe, it, expect, vi } from "vitest";
import * as path from "path";
import * as ts from "typescript";
import init from "../src/language-service.js";
import { TransformationPipeline } from "../src/pipeline.js";
import "@typesugar/macros";

const VDIR = path.resolve(__dirname, "__virtual_pre_merge__");

function createProject(files: Map<string, string>, typescript: typeof ts = ts) {
  const versions = new Map<string, number>();
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => ({
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      skipLibCheck: true,
    }),
    getScriptFileNames: () => Array.from(files.keys()),
    getScriptVersion: (f) => String(versions.get(f) ?? 1),
    getScriptSnapshot: (f) => {
      const c = files.get(f) ?? ts.sys.readFile(f);
      return c === undefined ? undefined : ts.ScriptSnapshot.fromString(c);
    },
    getCurrentDirectory: () => VDIR,
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: (f) => files.has(f) || ts.sys.fileExists(f),
    readFile: (f) => files.get(f) ?? ts.sys.readFile(f),
  };
  const logger = { info: vi.fn(), msg: vi.fn() };
  const info = {
    languageService: ts.createLanguageService(host),
    languageServiceHost: host,
    project: {
      // NOT under packages/transformer/: the plugin skips typesugar's own infra projects.
      getProjectName: () => "/pre-merge-project/tsconfig.json",
      getCompilerOptions: () => host.getCompilationSettings(),
      getFileNames: () => Array.from(files.keys()),
      getCurrentDirectory: () => VDIR,
      projectService: { logger },
    },
    serverHost: {},
    config: {},
  } as unknown as ts.server.PluginCreateInfo;
  const proxy = init({ typescript }).create(info);
  const served = (f: string) => {
    const snap = host.getScriptSnapshot(f)!;
    return snap.getText(0, snap.getLength());
  };
  return { proxy, host, served, logger };
}

const FORMAT = ts.getDefaultFormatCodeSettings();

function applyChanges(text: string, changes: readonly ts.TextChange[]): string {
  return [...changes]
    .sort((a, b) => b.span.start - a.span.start)
    .reduce(
      (acc, c) => acc.slice(0, c.span.start) + c.newText + acc.slice(c.span.start + c.span.length),
      text
    );
}

const MACRO_FILE = `import { fieldNames } from "@typesugar/macros";
export const f = fieldNames<{ id: number }>();
export function g() {
  const x = 1 + 2;
  return x + helper;
}
export const y = 1 + 2;
`;

function macroProject() {
  const other = path.join(VDIR, "other.ts");
  const main = path.join(VDIR, "main.ts");
  const project = createProject(
    new Map([
      [other, `export const helper = 1;\n`],
      [main, MACRO_FILE],
    ])
  );
  expect(project.served(main)).toContain(`["id"]`);
  return { ...project, main };
}

describe("refactors in an expanded file", () => {
  it("are offered for a selection exactly on a statement", () => {
    const { proxy, main } = macroProject();
    const pos = MACRO_FILE.indexOf("const x");
    const end = MACRO_FILE.indexOf(";", pos) + 1;
    const names = proxy
      .getApplicableRefactors(main, { pos, end }, {}, "invoked")
      .map((r) => r.name);
    expect(names).toContain("Extract Symbol");
  });

  it("are offered for a selection whose end has no mapping of its own", () => {
    // A block's closing brace has no source-map segment of its own (the
    // expansion is a reprint), so selecting a whole function ends the range
    // on an unmapped position; mapping both ends exactly offered nothing.
    const { proxy, main } = macroProject();
    const pos = MACRO_FILE.indexOf("export function g");
    const end = MACRO_FILE.indexOf("}\nexport const y") + 1;
    const prefs: ts.UserPreferences = { allowTextChangesInNewFiles: true };
    const refactors = proxy.getApplicableRefactors(main, { pos, end }, prefs, "invoked");
    const names = refactors.map((r) => r.name);
    expect(names).toContain("Move to a new file");
    const edits = proxy.getEditsForRefactor(
      main,
      FORMAT,
      { pos, end },
      "Move to a new file",
      "Move to a new file",
      prefs
    );
    const inMain = edits?.edits.find((e) => e.fileName === main)?.textChanges ?? [];
    expect(applyChanges(MACRO_FILE, inMain)).not.toContain("function g");
    expect(applyChanges(MACRO_FILE, inMain)).toContain("export const y = 1 + 2;");
  });
});

describe("code fixes next to text the transform changed", () => {
  function importFix(code: string): string | undefined {
    const other = path.join(VDIR, "other.ts");
    const main = path.join(VDIR, "fix-main.ts");
    const { proxy, served } = createProject(
      new Map([
        [other, `export const helper = 1;\n`],
        [main, code],
      ])
    );
    expect(served(main)).not.toContain("@typesugar/macros");
    const at = code.lastIndexOf("helper");
    const fixes = proxy.getCodeFixesAtPosition(main, at, at + 6, [2304], FORMAT, {});
    const fix = fixes.find((f) => f.fixName === "import");
    return fix && applyChanges(code, fix.changes[0].textChanges);
  }

  it("offers 'Add missing import' when the removed macro import is followed by code", () => {
    const fixed = importFix(MACRO_FILE);
    expect(fixed).toContain(
      `import { fieldNames } from "@typesugar/macros";\nimport { helper } from "./other";\n`
    );
  });

  it("offers 'Add missing import' when the removed macro import is followed by a comment", () => {
    // The expansion starts with the comment, which has no mapping of its own.
    const fixed = importFix(`import { fieldNames } from "@typesugar/macros";
// helpers
export const f = fieldNames<{ id: number }>();
export const y = helper;
`);
    expect(fixed).toBe(`import { fieldNames } from "@typesugar/macros";
import { helper } from "./other";

// helpers
export const f = fieldNames<{ id: number }>();
export const y = helper;
`);
  });

  it("puts the import before a JSDoc, not between it and its declaration", () => {
    const fixed = importFix(`import { fieldNames } from "@typesugar/macros";

/** The fields. */
export const f = fieldNames<{ id: number }>();
export const y = helper;
`);
    expect(fixed).toContain(
      `import { helper } from "./other";\n\n/** The fields. */\nexport const f`
    );
  });
});

describe("expansion inlay hints", () => {
  it("parse the source once per transform, not on every request", () => {
    const main = path.join(VDIR, "hints-main.ts");
    const code = `import { fieldNames } from "@typesugar/macros";\nexport const f = fieldNames<{ id: number }>();\n`;
    const parses: string[] = [];
    const counting = {
      ...ts,
      createSourceFile: (...args: Parameters<typeof ts.createSourceFile>) => {
        if (args[0] === main && args[1] === code) parses.push(args[0]);
        return ts.createSourceFile(...args);
      },
    } as typeof ts;
    const { proxy } = createProject(new Map([[main, code]]), counting);
    const span = { start: 0, length: code.length };
    const first = proxy.provideInlayHints(main, span, {});
    expect(first.map((h) => h.text)).toContain(`= ["id"]`);
    const before = parses.length;
    proxy.provideInlayHints(main, span, {});
    proxy.provideInlayHints(main, span, {});
    expect(parses.length).toBe(before);
  });
});

describe("Expand Macro at Cursor", () => {
  const ACTIVE = Symbol.for("typesugar.languageService.activeInstance");
  type Instance = {
    expandMacroAt(f: string, p: number): { macroName: string; expandedText: string } | null;
  };

  it("answers with the innermost expansion at the cursor, whatever the record order", () => {
    const main = path.join(VDIR, "expand-main.ts");
    const code = `import { fieldNames } from "@typesugar/macros";\nexport const a = [fieldNames<{ id: number }>()];\n`;
    const callStart = code.indexOf("fieldNames<");
    const outerStart = code.indexOf("[fieldNames");
    // An enclosing expansion recorded before the inner one (as a macro whose
    // result is visited afterwards records it).
    const transform = TransformationPipeline.prototype.transform;
    const spy = vi
      .spyOn(TransformationPipeline.prototype, "transform")
      .mockImplementation(function (this: TransformationPipeline, fileName: string) {
        const r = transform.call(this, fileName);
        if (fileName !== main || !r.expansions) return r;
        const outer = {
          ...r.expansions[0],
          macroName: "outer",
          originalStart: outerStart,
          originalEnd: code.indexOf(";", outerStart),
          expandedText: "OUTER",
        };
        return { ...r, expansions: [outer, ...r.expansions] };
      });
    try {
      const { host, served } = createProject(new Map([[main, code]]));
      served(main);
      const inst = (host as unknown as Record<symbol, Instance>)[ACTIVE];
      expect(inst.expandMacroAt(main, callStart + 2)?.macroName).toBe("fieldNames");
      expect(inst.expandMacroAt(main, outerStart)?.macroName).toBe("outer");
    } finally {
      spy.mockRestore();
    }
  });

  it("still answers for a cursor just next to a call (the documented tolerance)", () => {
    const main = path.join(VDIR, "expand-near.ts");
    const code = `import { fieldNames } from "@typesugar/macros";\nexport const a = fieldNames<{ id: number }>();   \n`;
    const { host, served } = createProject(new Map([[main, code]]));
    served(main);
    const inst = (host as unknown as Record<symbol, Instance>)[ACTIVE];
    expect(inst.expandMacroAt(main, code.indexOf(";") + 2)?.expandedText).toBe(`["id"]`);
  });
});

/**
 * Editor features the tsserver plugin provides now that it is the single
 * editor engine for 1.0 (PEP-060 D5): the custom tsserver requests behind the
 * VS Code expansion views, macro-expansion inlay hints, the trusted
 * `comptimeInEditor` opt-in, loading at most once per project, and macro
 * refactors that actually do something.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as ts from "typescript";
import init, { EXPAND_MACRO_REQUEST, SHOW_TRANSFORMED_REQUEST } from "../src/language-service.js";
import "@typesugar/macros";

const VDIR = path.resolve(__dirname, "__virtual_editor__");

type Handler = (request: ts.server.protocol.Request) => ts.server.HandlerResponse;

function fakeSession() {
  const handlers = new Map<string, Handler>();
  return {
    handlers,
    addProtocolHandler: vi.fn((command: string, handler: Handler) => {
      if (handlers.has(command)) {
        throw new Error(`Protocol handler already exists for command "${command}"`);
      }
      handlers.set(command, handler);
    }),
  };
}

interface ProjectOptions {
  config?: Record<string, unknown>;
  tsconfigPlugins?: unknown[];
  session?: ReturnType<typeof fakeSession>;
  dir?: string;
  projectName?: string;
}

function createProject(files: Map<string, string>, opts: ProjectOptions = {}) {
  const dir = opts.dir ?? VDIR;
  const versions = new Map<string, number>();
  const settings = (): ts.CompilerOptions => ({
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    ...(opts.tsconfigPlugins ? { plugins: opts.tsconfigPlugins as ts.PluginImport[] } : {}),
  });
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: settings,
    getScriptFileNames: () => Array.from(files.keys()),
    getScriptVersion: (f) => String(versions.get(f) ?? 1),
    getScriptSnapshot: (f) => {
      const c = files.get(f) ?? ts.sys.readFile(f);
      return c === undefined ? undefined : ts.ScriptSnapshot.fromString(c);
    },
    getCurrentDirectory: () => dir,
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: (f) => files.has(f) || ts.sys.fileExists(f),
    readFile: (f) => files.get(f) ?? ts.sys.readFile(f),
  };
  const logger = { info: vi.fn(), msg: vi.fn() };
  const project = {
    getProjectName: () => opts.projectName ?? "/editor-project/tsconfig.json",
    getCompilerOptions: settings,
    getFileNames: () => Array.from(files.keys()),
    getCurrentDirectory: () => dir,
    projectService: { logger },
    markAsDirty: vi.fn(),
  };
  const info = {
    languageService: ts.createLanguageService(host),
    languageServiceHost: host,
    project,
    serverHost: {},
    config: opts.config ?? {},
    session: opts.session,
  } as unknown as ts.server.PluginCreateInfo;
  const pluginModule = init({ typescript: ts });
  const proxy = pluginModule.create(info);
  const served = (f: string) => {
    const snap = host.getScriptSnapshot(f)!;
    return snap.getText(0, snap.getLength());
  };
  return { proxy, host, info, served, logger, project, pluginModule };
}

function request(handler: Handler, args: Record<string, unknown>) {
  return handler({ seq: 1, type: "request", command: "x", arguments: args });
}

const FIELD_NAMES_SRC =
  `import { fieldNames } from "@typesugar/macros";\n` +
  `interface User { id: number }\n` +
  `export const f = fieldNames<User>();\n`;

afterEach(() => {
  delete process.env.TYPESUGAR_COMPTIME_IN_EDITOR;
});

describe("custom tsserver requests for the VS Code expansion views", () => {
  it(`${SHOW_TRANSFORMED_REQUEST} returns the original and transformed text of a project file`, () => {
    const main = path.join(VDIR, "ed-show.ts");
    const session = fakeSession();
    createProject(new Map([[main, FIELD_NAMES_SRC]]), { session });

    const handler = session.handlers.get(SHOW_TRANSFORMED_REQUEST)!;
    expect(handler).toBeDefined();
    const res = request(handler, { file: main });
    expect(res.responseRequired).toBe(true);
    const body = res.response as { original: string; transformed: string; changed: boolean };
    expect(body.changed).toBe(true);
    expect(body.original).toBe(FIELD_NAMES_SRC);
    expect(body.transformed).toContain(`["id"]`);
  });

  it(`${EXPAND_MACRO_REQUEST} returns the expansion at an offset inside the macro call`, () => {
    const main = path.join(VDIR, "ed-expand.ts");
    const session = fakeSession();
    createProject(new Map([[main, FIELD_NAMES_SRC]]), { session });

    const offset = FIELD_NAMES_SRC.indexOf("fieldNames<User>") + 3;
    const res = request(session.handlers.get(EXPAND_MACRO_REQUEST)!, {
      file: main,
      position: offset,
    });
    const body = res.response as { macroName: string; expandedText: string } | null;
    expect(body).not.toBeNull();
    expect(body!.macroName).toBe("fieldNames");
    expect(body!.expandedText).toContain(`"id"`);
  });

  it(`${EXPAND_MACRO_REQUEST} returns null away from any macro`, () => {
    const main = path.join(VDIR, "ed-expand-none.ts");
    const session = fakeSession();
    const src = `export const plain = 1;\n` + " ".repeat(400) + `\nexport const other = 2;\n`;
    createProject(new Map([[main, src]]), { session });
    const res = request(session.handlers.get(EXPAND_MACRO_REQUEST)!, {
      file: main,
      position: src.indexOf("other"),
    });
    expect(res.response ?? null).toBeNull();
  });

  it("registers each handler once per session and routes a request to the project that has the file", () => {
    const session = fakeSession();
    const a = path.join(VDIR, "proj-a", "a.ts");
    const b = path.join(VDIR, "proj-b", "b.ts");
    createProject(new Map([[a, `export const a = 1;\n`]]), {
      session,
      projectName: "/proj-a/tsconfig.json",
    });
    createProject(new Map([[b, FIELD_NAMES_SRC]]), {
      session,
      projectName: "/proj-b/tsconfig.json",
    });

    expect(session.addProtocolHandler).toHaveBeenCalledTimes(2); // one per command, not per project
    const res = request(session.handlers.get(SHOW_TRANSFORMED_REQUEST)!, { file: b });
    expect((res.response as { transformed: string }).transformed).toContain(`["id"]`);
  });

  it("answers null (not an error) for a file no typesugar project has", () => {
    const session = fakeSession();
    createProject(new Map([[path.join(VDIR, "x.ts"), `export const x = 1;\n`]]), { session });
    const res = request(session.handlers.get(SHOW_TRANSFORMED_REQUEST)!, {
      file: path.join(VDIR, "not-in-any-project.ts"),
    });
    expect(res.responseRequired).toBe(true);
    expect(res.response ?? null).toBeNull();
  });
});

describe("loaded twice on one project (tsconfig plugin + the VS Code extension's global plugin)", () => {
  it("the second load is a no-op instead of transforming already-transformed code", () => {
    const main = path.join(VDIR, "ed-twice.ts");
    const files = new Map([[main, FIELD_NAMES_SRC]]);
    const first = createProject(files);
    const second = {
      ...first.info,
      languageService: first.proxy,
    } as unknown as ts.server.PluginCreateInfo;
    const proxy2 = init({ typescript: ts }).create(second);
    expect(proxy2).toBe(first.proxy);
    expect(first.served(main)).toContain(`["id"]`);
  });
});

describe("macro-expansion inlay hints", () => {
  it("shows the expansion after an expression-macro call", () => {
    const main = path.join(VDIR, "ed-hints.ts");
    const { proxy, served } = createProject(new Map([[main, FIELD_NAMES_SRC]]));
    served(main);
    const hints = proxy.provideInlayHints(
      main,
      { start: 0, length: FIELD_NAMES_SRC.length },
      undefined
    );
    const callEnd = FIELD_NAMES_SRC.indexOf("fieldNames<User>()") + "fieldNames<User>()".length;
    const hint = hints.find((h) => h.position === callEnd);
    expect(hint).toBeDefined();
    expect(hint!.text).toContain(`"id"`);
    expect(hint!.text.startsWith("= ")).toBe(true);
  });

  it("adds no hint outside the requested span", () => {
    const main = path.join(VDIR, "ed-hints-span.ts");
    const { proxy, served } = createProject(new Map([[main, FIELD_NAMES_SRC]]));
    served(main);
    const hints = proxy.provideInlayHints(main, { start: 0, length: 10 }, undefined);
    expect(hints.some((h) => h.text.includes(`"id"`))).toBe(false);
  });
});

describe("comptimeInEditor comes only from the editor, never from the repository's tsconfig", () => {
  const SRC = `import { comptime } from "@typesugar/macros";\nexport const a = comptime(() => 40 + 2);\n`;

  it("is honoured when the editor supplied it (plugin config not present in tsconfig)", () => {
    const main = path.join(VDIR, "ed-ct-editor.ts");
    const { served } = createProject(new Map([[main, SRC]]), {
      config: { name: "@typesugar/ts-plugin", comptimeInEditor: true },
    });
    expect(served(main)).toMatch(/=\s*42/);
  });

  it("is ignored when the repository's own tsconfig plugin entry sets it", () => {
    const main = path.join(VDIR, "ed-ct-tsconfig.ts");
    const entry = { name: "@typesugar/transformer/language-service", comptimeInEditor: true };
    const { served } = createProject(new Map([[main, SRC]]), {
      config: entry,
      tsconfigPlugins: [entry],
    });
    expect(served(main)).toContain("comptime(");
  });

  it("follows onConfigurationChanged (the editor toggling the setting) at runtime", () => {
    const main = path.join(VDIR, "ed-ct-runtime.ts");
    const { served, pluginModule, project } = createProject(new Map([[main, SRC]]));
    expect(served(main)).toContain("comptime(");
    project.markAsDirty.mockClear();
    pluginModule.onConfigurationChanged!({ comptimeInEditor: true });
    expect(project.markAsDirty).toHaveBeenCalled();
    expect(served(main)).toMatch(/=\s*42/);
    pluginModule.onConfigurationChanged!({ comptimeInEditor: false });
    expect(served(main)).toContain("comptime(");
  });
});

describe("macro refactors", () => {
  it("offers only actions that produce an edit (no do-nothing 'Expand …')", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-ls-refactor-"));
    try {
      fs.writeFileSync(
        path.join(dir, "typesugar.manifest.json"),
        JSON.stringify({ version: 1, macros: { expression: { fieldNames: {}, comptime: {} } } })
      );
      const main = path.join(dir, "main.ts");
      const { proxy } = createProject(new Map([[main, FIELD_NAMES_SRC]]), { dir });
      const pos = FIELD_NAMES_SRC.indexOf("fieldNames<User>") + 2;
      const refactors = proxy.getApplicableRefactors(main, pos, undefined);
      const ours = refactors.find((r) => r.name === "typesugar-macro");
      for (const action of ours?.actions ?? []) {
        const edits = proxy.getEditsForRefactor(
          main,
          ts.getDefaultFormatCodeSettings(),
          pos,
          "typesugar-macro",
          action.name,
          undefined
        );
        expect(edits?.edits.length ?? 0, action.description).toBeGreaterThan(0);
      }
      expect((ours?.actions ?? []).some((a) => a.description.startsWith("Expand"))).toBe(false);

      // ...while "Wrap in comptime(...)" on a selection still works, edit and all.
      const sel = { pos: FIELD_NAMES_SRC.indexOf("fieldNames<User>()"), end: 0 };
      sel.end = sel.pos + "fieldNames<User>()".length;
      const wrap = proxy
        .getApplicableRefactors(main, sel, undefined)
        .find((r) => r.name === "typesugar-macro")
        ?.actions.find((a) => a.description === "Wrap in comptime(...)");
      expect(wrap).toBeDefined();
      const wrapEdits = proxy.getEditsForRefactor(
        main,
        ts.getDefaultFormatCodeSettings(),
        sel,
        "typesugar-macro",
        wrap!.name,
        undefined
      );
      expect(wrapEdits!.edits[0].textChanges[0].newText).toBe("comptime(() => fieldNames<User>())");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

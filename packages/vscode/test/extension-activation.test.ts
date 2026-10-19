/**
 * activate() of the VS Code extension: UI on top of the tsserver plugin, the
 * single editor engine for 1.0 (PEP-060 D5). No language server is started;
 * the expansion views ask the plugin through `typescript.tsserverRequest`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { createMockTextDocument, Position, Selection, workspace } from "./mocks/vscode-mock";

type Callback = (...args: unknown[]) => unknown;

function makeContext(): any {
  return { subscriptions: [] as unknown[] };
}

let registered: Map<string, Callback>;
let executed: unknown[][];
let tsserverReply: (command: string, args: any) => unknown;
let configurePlugin: ReturnType<typeof vi.fn>;
let updates: unknown[][];

beforeEach(() => {
  registered = new Map();
  executed = [];
  updates = [];
  tsserverReply = () => undefined;
  configurePlugin = vi.fn();

  vi.spyOn(vscode.commands, "registerCommand").mockImplementation(((id: string, cb: Callback) => {
    registered.set(id, cb);
    return { dispose() {} };
  }) as any);
  vi.spyOn(vscode.commands, "executeCommand").mockImplementation((async (
    id: string,
    ...args: any[]
  ) => {
    executed.push([id, ...args]);
    if (id === "typescript.tsserverRequest") return tsserverReply(args[0], args[1]);
    return undefined;
  }) as any);
  vi.spyOn(vscode.extensions, "getExtension").mockImplementation(((id: string) =>
    id === "vscode.typescript-language-features"
      ? {
          isActive: true,
          exports: { getAPI: (v: number) => (v === 0 ? { configurePlugin } : undefined) },
          activate: async () => ({ getAPI: () => ({ configurePlugin }) }),
        }
      : undefined) as any);
  vi.spyOn(vscode.workspace, "getConfiguration").mockImplementation(
    () =>
      ({
        get: (key: string) => (key === "comptimeInEditor" ? comptimeSetting : undefined),
        has: () => false,
        inspect: () => undefined,
        update: (...args: unknown[]) => {
          updates.push(args);
          return Promise.resolve();
        },
      }) as any
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  comptimeSetting = undefined;
  (workspace as any)._setTrusted(true);
});

let comptimeSetting: boolean | undefined;

function withActiveEditor(content: string, file: string, offset: number) {
  const doc = createMockTextDocument(content, file);
  const pos = doc.positionAt(offset) as Position;
  const editor = { document: doc, selection: new Selection(pos, pos) };
  vi.spyOn(vscode.window, "activeTextEditor", "get").mockReturnValue(editor as any);
  return doc;
}

describe("extension activate()", () => {
  it("does not start a language server or depend on one", async () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"));
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain("@typesugar/lsp-server");
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain("vscode-languageclient");
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "extension.ts"), "utf-8");
    expect(src).not.toMatch(/vscode-languageclient|LanguageClient/);
  });

  // deep-review tooling #6: the extension used to write
  // `typescript.validate.enable: false` into workspace settings.
  it("does not modify the user's TypeScript settings", async () => {
    const { activate } = await import("../src/extension.js");
    await activate(makeContext());
    expect(updates).toEqual([]);
  });

  it("registers the expansion commands", async () => {
    const { activate } = await import("../src/extension.js");
    await activate(makeContext());
    expect([...registered.keys()].sort()).toEqual([
      "typesugar.expandMacro",
      "typesugar.showTransformed",
    ]);
  });

  it("Expand Macro asks the tsserver plugin for the expansion at the cursor and shows it", async () => {
    const { activate, EXPAND_MACRO_REQUEST } = await import("../src/extension.js");
    await activate(makeContext());
    const src = `const f = fieldNames<User>();\n`;
    withActiveEditor(src, "/proj/src/a.ts", 12);
    tsserverReply = (command) =>
      command === EXPAND_MACRO_REQUEST
        ? {
            type: "response",
            success: true,
            body: { macroName: "fieldNames", expandedText: `["id"]` },
          }
        : undefined;
    const opened = vi.spyOn(vscode.workspace, "openTextDocument");
    const shown = vi.spyOn(vscode.window, "showTextDocument");

    await registered.get("typesugar.expandMacro")!();

    const req = executed.find((e) => e[0] === "typescript.tsserverRequest")!;
    expect(req[1]).toBe("_typesugar.expandMacro");
    expect(req[2]).toEqual({ file: "/proj/src/a.ts", position: 12 });
    expect(String(opened.mock.calls[0][0])).toMatch(/^typesugar-expansion:/);
    expect(shown).toHaveBeenCalled();
  });

  it("Expand Macro says so when the plugin finds no expansion", async () => {
    const { activate } = await import("../src/extension.js");
    await activate(makeContext());
    withActiveEditor(`const x = 1;\n`, "/proj/src/b.ts", 3);
    tsserverReply = () => ({ type: "response", success: true });
    const info = vi.spyOn(vscode.window, "showInformationMessage");
    await registered.get("typesugar.expandMacro")!();
    expect(String(info.mock.calls[0]?.[0])).toMatch(/No macro expansion/);
  });

  it("Show Transformed opens a diff of the plugin's transformed text", async () => {
    const { activate, SHOW_TRANSFORMED_REQUEST } = await import("../src/extension.js");
    await activate(makeContext());
    withActiveEditor(`const f = fieldNames<User>();\n`, "/proj/src/c.ts", 0);
    tsserverReply = (command) =>
      command === SHOW_TRANSFORMED_REQUEST
        ? {
            type: "response",
            success: true,
            body: { original: "a", transformed: "b", changed: true },
          }
        : undefined;
    await registered.get("typesugar.showTransformed")!();
    expect(executed.find((e) => e[0] === "typescript.tsserverRequest")![2]).toEqual({
      file: "/proj/src/c.ts",
    });
    const diff = executed.find((e) => e[0] === "vscode.diff");
    expect(diff).toBeDefined();
    expect(String(diff![2])).toMatch(/^typesugar-transformed:/);
  });

  it("the request names match the ones the tsserver plugin registers", async () => {
    const { EXPAND_MACRO_REQUEST, SHOW_TRANSFORMED_REQUEST } = await import("../src/extension.js");
    const pluginSrc = fs.readFileSync(
      path.join(__dirname, "..", "..", "transformer", "src", "language-service.ts"),
      "utf-8"
    );
    expect(pluginSrc).toContain(`export const EXPAND_MACRO_REQUEST = "${EXPAND_MACRO_REQUEST}"`);
    expect(pluginSrc).toContain(
      `export const SHOW_TRANSFORMED_REQUEST = "${SHOW_TRANSFORMED_REQUEST}"`
    );
  });

  describe("typesugar.comptimeInEditor reaches the plugin only in a trusted workspace", () => {
    it("sends comptimeInEditor: true when set and trusted", async () => {
      comptimeSetting = true;
      const { activate } = await import("../src/extension.js");
      await activate(makeContext());
      expect(configurePlugin).toHaveBeenCalledWith("@typesugar/ts-plugin", {
        comptimeInEditor: true,
      });
    });

    it("sends comptimeInEditor: false in an untrusted workspace even when set", async () => {
      comptimeSetting = true;
      (workspace as any)._setTrusted(false);
      const { activate } = await import("../src/extension.js");
      await activate(makeContext());
      expect(configurePlugin).toHaveBeenCalledWith("@typesugar/ts-plugin", {
        comptimeInEditor: false,
      });
    });
  });
});

/**
 * typesugar VS Code extension — UI on top of the TypeScript server plugin.
 *
 * All language intelligence (macro-aware diagnostics, completions, hover,
 * go-to-definition, references, rename, quick fixes, refactors, inlay hints)
 * comes from the tsserver plugin `@typesugar/ts-plugin`, which this extension
 * registers through `typescriptServerPlugins` in package.json. That plugin is
 * the single editor engine for 1.0 (PEP-060 D5); the extension no longer
 * starts the `@typesugar/lsp-server` language server.
 *
 * What this module adds:
 * - "Expand Macro at Cursor" (peek of one expansion) and "Show Transformed
 *   Source" (diff of the whole file), answered by the plugin through custom
 *   tsserver requests sent with VS Code's `typescript.tsserverRequest`;
 * - the `typesugar.comptimeInEditor` setting, passed to the plugin with the
 *   TypeScript extension's `configurePlugin` API (trusted workspaces only).
 *
 * TextMate grammars are contributed declaratively in package.json.
 */

import * as vscode from "vscode";
import * as path from "path";

/** Must match the names `@typesugar/transformer/language-service` registers. */
export const EXPAND_MACRO_REQUEST = "_typesugar.expandMacro";
export const SHOW_TRANSFORMED_REQUEST = "_typesugar.showTransformed";

/** The plugin name in package.json `typescriptServerPlugins`. */
const PLUGIN_NAME = "@typesugar/ts-plugin";
const TS_EXTENSION_ID = "vscode.typescript-language-features";

interface ExpandMacroResponse {
  macroName: string;
  expandedText: string;
}
interface ShowTransformedResponse {
  original: string;
  transformed: string;
  changed: boolean;
}

// Mutable content for the virtual document providers
let expansionContent = "";
let transformedContent = "";
let expansionCounter = 0;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const outputChannel = vscode.window.createOutputChannel("Typesugar");
  context.subscriptions.push(outputChannel);

  // The extension does NOT touch `typescript.validate.enable` or any other
  // user setting (deep-review tooling #6): the built-in TypeScript features
  // are macro-aware through the plugin.

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider("typesugar-expansion", {
      provideTextDocumentContent: () => expansionContent,
    }),
    vscode.workspace.registerTextDocumentContentProvider("typesugar-transformed", {
      provideTextDocumentContent: () => transformedContent,
    }),
    vscode.commands.registerCommand("typesugar.expandMacro", () => expandMacro(outputChannel)),
    vscode.commands.registerCommand("typesugar.showTransformed", () =>
      showTransformed(outputChannel)
    )
  );

  // comptime blocks run the workspace's code with the editor's privileges, so
  // the plugin only evaluates them when the user opted in AND the workspace
  // is trusted. Re-sent when either changes.
  const sendPluginConfig = () =>
    configurePlugin(outputChannel).catch((err) =>
      outputChannel.appendLine(`configurePlugin failed: ${err}`)
    );
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("typesugar.comptimeInEditor")) void sendPluginConfig();
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(() => void sendPluginConfig())
  );
  await sendPluginConfig();

  outputChannel.appendLine("typesugar extension activated (tsserver plugin: " + PLUGIN_NAME + ")");
}

export function deactivate(): void {
  // Nothing to stop: the plugin lives in tsserver, owned by VS Code's
  // TypeScript extension.
}

// ---------------------------------------------------------------------------
// Plugin configuration
// ---------------------------------------------------------------------------

async function configurePlugin(outputChannel: vscode.OutputChannel): Promise<void> {
  const comptimeInEditor =
    vscode.workspace.isTrusted === true &&
    vscode.workspace.getConfiguration("typesugar").get<boolean>("comptimeInEditor") === true;

  const tsExtension = vscode.extensions.getExtension(TS_EXTENSION_ID);
  if (!tsExtension) {
    outputChannel.appendLine(
      "VS Code's TypeScript extension is not available; typesugar needs it to load its plugin."
    );
    return;
  }
  const exports = (tsExtension.isActive ? tsExtension.exports : await tsExtension.activate()) as
    | { getAPI?(version: 0): { configurePlugin(id: string, config: unknown): void } | undefined }
    | undefined;
  const api = exports?.getAPI?.(0);
  if (!api) {
    outputChannel.appendLine("TypeScript extension API v0 unavailable; cannot configure plugin.");
    return;
  }
  api.configurePlugin(PLUGIN_NAME, { comptimeInEditor });
}

// ---------------------------------------------------------------------------
// Custom tsserver requests
// ---------------------------------------------------------------------------

/**
 * Send one of the plugin's custom requests. VS Code's
 * `typescript.tsserverRequest` only forwards non-built-in commands whose name
 * starts with `_`, and resolves to the tsserver response (`body` holds the
 * plugin's answer; no body means "nothing here").
 */
async function tsserverRequest<T>(command: string, args: object): Promise<T | undefined> {
  const response = await vscode.commands.executeCommand<{ body?: T } | undefined>(
    "typescript.tsserverRequest",
    command,
    args
  );
  return response?.body ?? undefined;
}

function activeTypeScriptEditor(): vscode.TextEditor | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return undefined;
  if (editor.document.uri.scheme !== "file") {
    void vscode.window.showInformationMessage("typesugar: open a TypeScript file on disk first.");
    return undefined;
  }
  return editor;
}

async function expandMacro(outputChannel: vscode.OutputChannel): Promise<void> {
  const editor = activeTypeScriptEditor();
  if (!editor) return;
  const file = editor.document.uri.fsPath;
  const position = editor.document.offsetAt(editor.selection.active);

  try {
    const result = await tsserverRequest<ExpandMacroResponse>(EXPAND_MACRO_REQUEST, {
      file,
      position,
    });
    if (!result) {
      void vscode.window.showInformationMessage("No macro expansion found at the cursor.");
      return;
    }

    expansionContent = result.expandedText;
    const previewUri = vscode.Uri.parse(
      `typesugar-expansion://expansion/${result.macroName}-${++expansionCounter}.ts`
    );
    const doc = await vscode.workspace.openTextDocument(previewUri);
    await vscode.window.showTextDocument(doc, {
      preview: true,
      viewColumn: vscode.ViewColumn.Beside,
    });
  } catch (error) {
    reportRequestError(outputChannel, "expandMacro", error);
  }
}

async function showTransformed(outputChannel: vscode.OutputChannel): Promise<void> {
  const editor = activeTypeScriptEditor();
  if (!editor) return;
  const fileName = path.basename(editor.document.fileName);

  try {
    const result = await tsserverRequest<ShowTransformedResponse>(SHOW_TRANSFORMED_REQUEST, {
      file: editor.document.uri.fsPath,
    });
    if (!result) {
      void vscode.window.showInformationMessage(
        "typesugar's TypeScript plugin isn't active for this file (is it in a tsconfig project?)."
      );
      return;
    }
    if (!result.changed) {
      void vscode.window.showInformationMessage("No macros expanded in this file.");
      return;
    }

    transformedContent = result.transformed;
    const transformedUri = vscode.Uri.parse(
      `typesugar-transformed://transformed/${fileName}-${++expansionCounter}.ts`
    );
    await vscode.commands.executeCommand(
      "vscode.diff",
      editor.document.uri,
      transformedUri,
      `${fileName} — Macro Expansion`
    );
  } catch (error) {
    reportRequestError(outputChannel, "showTransformed", error);
  }
}

function reportRequestError(
  outputChannel: vscode.OutputChannel,
  what: string,
  error: unknown
): void {
  outputChannel.appendLine(`${what} error: ${error}`);
  void vscode.window.showErrorMessage(
    `typesugar: ${what} failed — is VS Code's TypeScript server running? See the Typesugar output.`
  );
}

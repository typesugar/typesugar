/**
 * typesugar VSCode Extension — thin LSP client.
 *
 * Activates when a workspace contains typesugar.manifest.json or has typesugar
 * installed. Connects to the @typesugar/lsp-server for all language intelligence:
 *
 * - Diagnostics (type errors + macro expansion errors)
 * - Completions (with extension method support)
 * - Hover, go-to-definition, references, rename
 * - Semantic tokens (macro highlighting)
 * - CodeLens (expansion previews)
 * - Inlay hints (bind types, comptime results)
 * - Code actions (expand macro, wrap in comptime, add derive)
 *
 * VS Code-specific features handled here:
 * - Commands (expand macro peek widget, show transformed diff, generate manifest)
 * - Status bar
 * - TextMate grammars (loaded declaratively from package.json)
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from "vscode-languageclient/node.js";

let client: LanguageClient | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const outputChannel = vscode.window.createOutputChannel("Typesugar");
  outputChannel.appendLine("typesugar extension activating...");

  // --- Start LSP server ---
  const serverModule = resolveServerPath();
  if (!serverModule) {
    outputChannel.appendLine("Could not find @typesugar/lsp-server. Language features disabled.");
    return;
  }

  outputChannel.appendLine(`Starting LSP server: ${serverModule}`);

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.stdio },
    debug: { module: serverModule, transport: TransportKind.stdio },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { language: "typescript", scheme: "file" },
      { language: "typescriptreact", scheme: "file" },
      { language: "sugared-typescript", scheme: "file" },
      { language: "sugared-typescriptreact", scheme: "file" },
    ],
    outputChannel,
  };

  client = new LanguageClient(
    "typesugar",
    "typesugar Language Server",
    serverOptions,
    clientOptions
  );

  // Start the client (also starts the server)
  try {
    await client.start();
    outputChannel.appendLine("LSP client started");
  } catch (err) {
    outputChannel.appendLine(`Failed to start LSP server: ${err}`);
    vscode.window.showErrorMessage(
      "typesugar: Failed to start language server. Check the output channel for details."
    );
    client = undefined;
    return;
  }

  // --- Commands (VS Code-specific UI) ---
  registerCommands(context, client, outputChannel);

  // --- Status bar ---
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.text = "$(zap) typesugar";
  statusBar.tooltip = "typesugar macro system active (LSP)";
  statusBar.command = "typesugar.refreshManifest";
  statusBar.show();
  context.subscriptions.push(statusBar);

  outputChannel.appendLine("typesugar extension activated");
}

export async function deactivate(): Promise<void> {
  if (client) {
    try {
      await client.stop();
    } catch {
      // Server may already be gone
    }
    client = undefined;
  }
}

// ---------------------------------------------------------------------------
// Server path resolution
// ---------------------------------------------------------------------------

function resolveServerPath(): string | undefined {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const candidates: string[] = [];

  if (workspaceFolder) {
    // Try workspace node_modules first
    candidates.push(
      path.join(
        workspaceFolder.uri.fsPath,
        "node_modules",
        "@typesugar",
        "lsp-server",
        "dist",
        "server.js"
      )
    );
  }

  // Try relative to the extension
  candidates.push(
    path.join(__dirname, "..", "node_modules", "@typesugar", "lsp-server", "dist", "server.js")
  );

  // Try global install
  candidates.push(path.join(__dirname, "..", "..", "lsp-server", "dist", "server.js"));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// VS Code-specific command registration
// ---------------------------------------------------------------------------

// Mutable content for virtual document providers (fix #6.1: single registration)
let expansionContent = "";
let transformedContent = "";
let expansionCounter = 0;

function registerCommands(
  context: vscode.ExtensionContext,
  lspClient: LanguageClient,
  outputChannel: vscode.OutputChannel
): void {
  // Register content providers ONCE at activation (fix #6.1: no leaks)
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider("typesugar-expansion", {
      provideTextDocumentContent: () => expansionContent,
    }),
    vscode.workspace.registerTextDocumentContentProvider("typesugar-transformed", {
      provideTextDocumentContent: () => transformedContent,
    })
  );

  // expandMacro: show expansion in peek widget
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "typesugar.expandMacro",
      async (uri?: string, offset?: number) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor && !uri) return;

        const docUri = uri ?? editor!.document.uri.toString();
        const pos = offset ?? (editor ? editor.document.offsetAt(editor.selection.active) : 0);

        try {
          const result = (await lspClient.sendRequest("workspace/executeCommand", {
            command: "typesugar.expandMacro",
            arguments: [docUri, pos],
          })) as { macroName: string; expandedText: string } | null;

          if (!result) {
            vscode.window.showInformationMessage("No macro expansion found at this position.");
            return;
          }

          expansionContent = result.expandedText;
          // Use unique counter in URI to avoid stale cache (fix #6.8)
          const previewUri = vscode.Uri.parse(
            `typesugar-expansion://expansion/${result.macroName}-${++expansionCounter}.ts`
          );

          const doc = await vscode.workspace.openTextDocument(previewUri);
          await vscode.window.showTextDocument(doc, {
            preview: true,
            viewColumn: vscode.ViewColumn.Beside,
          });
        } catch (error) {
          outputChannel.appendLine(`expandMacro error: ${error}`);
        }
      }
    )
  );

  // showTransformed: show full transformed source
  context.subscriptions.push(
    vscode.commands.registerCommand("typesugar.showTransformed", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const uri = editor.document.uri.toString();

      try {
        const result = (await lspClient.sendRequest("workspace/executeCommand", {
          command: "typesugar.showTransformed",
          arguments: [uri],
        })) as { original: string; transformed: string; changed: boolean } | null;

        if (!result || !result.changed) {
          vscode.window.showInformationMessage("No transformations applied to this file.");
          return;
        }

        transformedContent = result.transformed;
        const originalUri = editor.document.uri;
        const transformedUri = vscode.Uri.parse(
          `typesugar-transformed://transformed/${path.basename(editor.document.fileName)}-${++expansionCounter}.ts`
        );

        await vscode.commands.executeCommand(
          "vscode.diff",
          originalUri,
          transformedUri,
          `${path.basename(editor.document.fileName)} — Macro Expansion`
        );
      } catch (error) {
        outputChannel.appendLine(`showTransformed error: ${error}`);
      }
    })
  );

  // refreshManifest: tell the LSP server to reload
  context.subscriptions.push(
    vscode.commands.registerCommand("typesugar.refreshManifest", async () => {
      try {
        await lspClient.sendRequest("workspace/executeCommand", {
          command: "typesugar.refreshManifest",
          arguments: [],
        });
        vscode.window.showInformationMessage("typesugar manifest reloaded.");
      } catch (error) {
        outputChannel.appendLine(`refreshManifest error: ${error}`);
      }
    })
  );

  // generateManifest: run CLI in terminal
  context.subscriptions.push(
    vscode.commands.registerCommand("typesugar.generateManifest", () => {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) return;

      const terminal = vscode.window.createTerminal({
        name: "typesugar: Generate Manifest",
        cwd: workspaceFolder.uri.fsPath,
      });
      terminal.sendText("npx typesugar build --manifest");
      terminal.show();
    })
  );
}

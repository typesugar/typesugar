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

// Mutable content for virtual document providers
let expansionContent = "";
let transformedContent = "";
let expansionCounter = 0;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const outputChannel = vscode.window.createOutputChannel("Typesugar");
  outputChannel.appendLine("typesugar extension activating...");

  // Disable built-in TypeScript validation — the typesugar LSP provides its own
  // diagnostics on the transformed code with position mapping. Having both active
  // produces duplicate errors (one from raw TS, one from the LSP with macro awareness).
  const tsConfig = vscode.workspace.getConfiguration("typescript");
  if (tsConfig.get<boolean>("validate.enable") !== false) {
    await tsConfig.update("validate.enable", false, vscode.ConfigurationTarget.Workspace);
    outputChannel.appendLine(
      "Disabled built-in TypeScript validation (typesugar LSP handles diagnostics)"
    );
  }

  // --- Start LSP server ---
  const serverModule = resolveServerPath();
  if (!serverModule) {
    outputChannel.appendLine("Could not find @typesugar/lsp-server. Language features disabled.");
    return;
  }

  outputChannel.appendLine(`Starting LSP server: ${serverModule}`);

  const serverOptions: ServerOptions = {
    run: { command: "node", args: [serverModule, "--stdio"], transport: TransportKind.stdio },
    debug: { command: "node", args: [serverModule, "--stdio"], transport: TransportKind.stdio },
  };

  // Register virtual document content providers
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider("typesugar-expansion", {
      provideTextDocumentContent: () => expansionContent,
    }),
    vscode.workspace.registerTextDocumentContentProvider("typesugar-transformed", {
      provideTextDocumentContent: () => transformedContent,
    })
  );

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { language: "typescript", scheme: "file" },
      { language: "typescriptreact", scheme: "file" },
    ],
    outputChannel,
    // Intercept executeCommand to add VS Code-specific UI (peek widget, diff view).
    // vscode-languageclient auto-registers the server's executeCommandProvider commands,
    // so we use middleware instead of registerCommand to avoid "already exists" conflicts.
    middleware: {
      executeCommand: async (command, args, next) => {
        if (command === "typesugar.expandMacro") {
          return handleExpandMacro(outputChannel, args, next);
        }
        if (command === "typesugar.showTransformed") {
          return handleShowTransformed(outputChannel, args, next);
        }
        if (command === "typesugar.refreshManifest") {
          const result = await next(command, args);
          vscode.window.showInformationMessage("typesugar manifest reloaded.");
          return result;
        }
        return next(command, args);
      },
    },
  };

  client = new LanguageClient(
    "typesugar",
    "typesugar Language Server",
    serverOptions,
    clientOptions
  );

  // Register generateManifest (not an LSP command — runs CLI in terminal)
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

  // Prefer the bundled self-contained server (shipped with the extension)
  candidates.push(
    path.join(
      __dirname,
      "..",
      "node_modules",
      "@typesugar",
      "lsp-server",
      "dist",
      "server-bundled.cjs"
    )
  );

  if (workspaceFolder) {
    // Try workspace node_modules (bundled first, then regular)
    candidates.push(
      path.join(
        workspaceFolder.uri.fsPath,
        "node_modules",
        "@typesugar",
        "lsp-server",
        "dist",
        "server-bundled.cjs"
      ),
      path.join(
        workspaceFolder.uri.fsPath,
        "node_modules",
        "@typesugar",
        "lsp-server",
        "dist",
        "server.cjs"
      )
    );
  }

  // Try relative to the extension (unbundled fallback)
  candidates.push(
    path.join(__dirname, "..", "node_modules", "@typesugar", "lsp-server", "dist", "server.cjs")
  );

  // Try global install
  candidates.push(path.join(__dirname, "..", "..", "lsp-server", "dist", "server.cjs"));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// VS Code-specific command handlers (used via middleware)
// ---------------------------------------------------------------------------

async function handleExpandMacro(
  outputChannel: vscode.OutputChannel,
  args: unknown[],
  next: (command: string, args: unknown[]) => Thenable<unknown>
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor && args.length === 0) return;

  const docUri = (args[0] as string | undefined) ?? editor!.document.uri.toString();
  const pos =
    (args[1] as number | undefined) ??
    (editor ? editor.document.offsetAt(editor.selection.active) : 0);

  try {
    const result = (await next("typesugar.expandMacro", [docUri, pos])) as {
      macroName: string;
      expandedText: string;
    } | null;

    if (!result) {
      vscode.window.showInformationMessage("No macro expansion found at this position.");
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
    outputChannel.appendLine(`expandMacro error: ${error}`);
  }
}

async function handleShowTransformed(
  outputChannel: vscode.OutputChannel,
  args: unknown[],
  next: (command: string, args: unknown[]) => Thenable<unknown>
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const uri = (args[0] as string | undefined) ?? editor.document.uri.toString();

  try {
    const result = (await next("typesugar.showTransformed", [uri])) as {
      original: string;
      transformed: string;
      changed: boolean;
    } | null;

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
}

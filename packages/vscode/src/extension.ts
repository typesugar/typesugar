/**
 * typemacro VSCode Extension — entry point.
 *
 * Activates when a workspace contains typemacro.manifest.json or has typemacro
 * installed. Registers all providers:
 *
 * - Semantic tokens (manifest-driven macro highlighting)
 * - CodeLens (expansion previews)
 * - Inlay hints (bind types, comptime results)
 * - Code actions (expand, wrap, add derive)
 * - Diagnostics (background transformer errors)
 * - Commands (expand macro, refresh/generate manifest, add derive)
 *
 * The TextMate grammar handles structural syntax (let:/yield:, <<, comptime)
 * and is loaded declaratively from package.json — no activation needed.
 */

import * as vscode from "vscode";
import { ManifestLoader } from "./manifest.js";
import { MacroSemanticTokensProvider, LEGEND } from "./semantic-tokens.js";
import { MacroCodeLensProvider } from "./codelens.js";
import { MacroInlayHintsProvider } from "./inlay-hints.js";
import { MacroCodeActionsProvider } from "./code-actions.js";
import { MacroDiagnosticsManager } from "./diagnostics.js";
import { ExpansionService } from "./expansion.js";
import { registerCommands } from "./commands.js";

const TS_SELECTOR: vscode.DocumentSelector = [
  { language: "typescript", scheme: "file" },
  { language: "typescriptreact", scheme: "file" },
];

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const outputChannel = vscode.window.createOutputChannel("typemacro");
  outputChannel.appendLine("typemacro extension activating...");

  // --- Core services ---
  const manifest = new ManifestLoader();
  const expansion = new ExpansionService();

  context.subscriptions.push(manifest, expansion);

  // Initialize manifest from workspace
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (workspaceFolder) {
    await manifest.initialize(workspaceFolder);
    outputChannel.appendLine(
      `Manifest loaded: ${Object.keys(manifest.current.macros.expression).length} expression macros, ` +
        `${Object.keys(manifest.current.macros.decorator).length} decorator macros, ` +
        `${Object.keys(manifest.current.macros.taggedTemplate).length} tagged template macros`,
    );
  }

  // --- Semantic Tokens ---
  const semanticTokens = new MacroSemanticTokensProvider(manifest);
  context.subscriptions.push(
    vscode.languages.registerDocumentSemanticTokensProvider(
      TS_SELECTOR,
      semanticTokens,
      LEGEND,
    ),
    semanticTokens,
  );

  // --- CodeLens ---
  const codeLens = new MacroCodeLensProvider(manifest, expansion);
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(TS_SELECTOR, codeLens),
    codeLens,
  );

  // --- Inlay Hints ---
  const inlayHints = new MacroInlayHintsProvider(manifest, expansion);
  context.subscriptions.push(
    vscode.languages.registerInlayHintsProvider(TS_SELECTOR, inlayHints),
    inlayHints,
  );

  // --- Code Actions ---
  const codeActions = new MacroCodeActionsProvider(manifest, expansion);
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(TS_SELECTOR, codeActions, {
      providedCodeActionKinds: MacroCodeActionsProvider.providedCodeActionKinds,
    }),
  );

  // --- Diagnostics ---
  const diagnostics = new MacroDiagnosticsManager(expansion);
  context.subscriptions.push(diagnostics);

  // --- Commands ---
  registerCommands(context, manifest, expansion);

  // --- Status bar ---
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  statusBar.text = "$(zap) typemacro";
  statusBar.tooltip = "typemacro macro system active";
  statusBar.command = "typemacro.refreshManifest";
  statusBar.show();
  context.subscriptions.push(statusBar);

  // Update status bar when manifest changes
  manifest.onDidChange((m) => {
    const total =
      Object.keys(m.macros.expression).length +
      Object.keys(m.macros.decorator).length +
      Object.keys(m.macros.taggedTemplate).length +
      Object.keys(m.macros.labeledBlock).length;
    statusBar.text = `$(zap) typemacro (${total} macros)`;
  });

  outputChannel.appendLine("typemacro extension activated");
}

export function deactivate(): void {
  // All disposables are cleaned up via context.subscriptions
}

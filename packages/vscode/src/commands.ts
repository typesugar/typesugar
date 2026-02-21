/**
 * Commands — user-facing commands registered by the extension.
 *
 * - typesugar.expandMacro: Show macro expansion in a side panel
 * - typesugar.showTransformed: Show full file transformation in diff view
 * - typesugar.refreshManifest: Reload the manifest from disk
 * - typesugar.generateManifest: Run `typesugar build --manifest`
 * - typesugar.addDerive: Quick-pick derive macros to add to a type
 */

import * as vscode from "vscode";
import * as path from "path";
import type { ManifestLoader } from "./manifest.js";
import type { ExpansionService } from "./expansion.js";

export function registerCommands(
  context: vscode.ExtensionContext,
  manifest: ManifestLoader,
  expansion: ExpansionService
): void {
  // --- Expand Macro ---
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "typesugar.expandMacro",
      async (uri?: vscode.Uri, position?: number) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor && !uri) {
          vscode.window.showWarningMessage("No active editor");
          return;
        }

        const targetUri = uri ?? editor!.document.uri;
        const targetDoc = uri ? await vscode.workspace.openTextDocument(uri) : editor!.document;
        const targetPos = position ?? editor!.document.offsetAt(editor!.selection.active);

        const expanded = await expansion.getExpansionAtPosition(targetDoc, targetPos);
        if (!expanded) {
          vscode.window.showInformationMessage(
            "Could not expand macro. Make sure typesugar is installed in this project."
          );
          return;
        }

        // Show expansion in a virtual document
        const expandedUri = vscode.Uri.parse(`typesugar-expansion:${targetUri.fsPath}?expanded`);

        const provider = new (class implements vscode.TextDocumentContentProvider {
          provideTextDocumentContent(): string {
            return expanded;
          }
        })();

        const registration = vscode.workspace.registerTextDocumentContentProvider(
          "typesugar-expansion",
          provider
        );

        const doc = await vscode.workspace.openTextDocument(expandedUri);
        await vscode.window.showTextDocument(doc, {
          viewColumn: vscode.ViewColumn.Beside,
          preview: true,
          preserveFocus: true,
        });

        // Set language to TypeScript for syntax highlighting
        await vscode.languages.setTextDocumentLanguage(doc, "typescript");

        // Clean up the provider after a delay (the document stays open)
        setTimeout(() => registration.dispose(), 5000);
      }
    )
  );

  // --- Show Transformed Source ---
  context.subscriptions.push(
    vscode.commands.registerCommand("typesugar.showTransformed", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("No active editor");
        return;
      }

      const document = editor.document;
      const fileName = document.fileName;

      // Check if it's a TypeScript file
      if (!fileName.match(/\.[tj]sx?$/)) {
        vscode.window.showWarningMessage("typesugar.showTransformed only works on TypeScript/JavaScript files");
        return;
      }

      // Get transformed content from the extension
      const transformed = await expansion.getTransformedFile(document);
      if (!transformed) {
        vscode.window.showInformationMessage(
          "No transformation applied to this file. It may not contain any typesugar syntax or macros."
        );
        return;
      }

      // Create a virtual document for the transformed content
      const baseName = path.basename(fileName);
      const transformedUri = vscode.Uri.parse(
        `typesugar-transformed:${fileName}?transformed&t=${Date.now()}`
      );

      const provider = new (class implements vscode.TextDocumentContentProvider {
        provideTextDocumentContent(): string {
          return transformed;
        }
      })();

      const registration = vscode.workspace.registerTextDocumentContentProvider(
        "typesugar-transformed",
        provider
      );

      // Open as diff view: original vs transformed
      const originalUri = document.uri;
      await vscode.commands.executeCommand(
        "vscode.diff",
        originalUri,
        transformedUri,
        `typesugar: ${baseName} (original ↔ transformed)`
      );

      // Clean up the provider after a delay
      setTimeout(() => registration.dispose(), 60000);
    })
  );

  // --- Refresh Manifest ---
  context.subscriptions.push(
    vscode.commands.registerCommand("typesugar.refreshManifest", async () => {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        vscode.window.showWarningMessage("No workspace folder open");
        return;
      }
      await manifest.initialize(workspaceFolder);
      vscode.window.showInformationMessage("typesugar: Manifest refreshed");
    })
  );

  // --- Generate Manifest ---
  context.subscriptions.push(
    vscode.commands.registerCommand("typesugar.generateManifest", async () => {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        vscode.window.showWarningMessage("No workspace folder open");
        return;
      }

      const terminal = vscode.window.createTerminal({
        name: "typesugar manifest",
        cwd: workspaceFolder.uri.fsPath,
      });
      terminal.show();
      terminal.sendText("npx typesugar build --manifest");
    })
  );

  // --- Add Derive ---
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "typesugar.addDerive",
      async (uri?: vscode.Uri, position?: number) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showWarningMessage("No active editor");
          return;
        }

        const deriveEntry = manifest.current.macros.decorator.derive;
        const availableDerives = deriveEntry?.args ?? [];

        if (availableDerives.length === 0) {
          vscode.window.showWarningMessage("No derive macros available");
          return;
        }

        const selected = await vscode.window.showQuickPick(
          availableDerives.map((name) => ({
            label: name,
            description: `Generate ${name} implementation`,
            picked: false,
          })),
          {
            canPickMany: true,
            placeHolder: "Select derive macros to add",
            title: "Add @derive(...)",
          }
        );

        if (!selected || selected.length === 0) return;

        const deriveNames = selected.map((s) => `"${s.label}"`).join(", ");
        const decorator = `@derive(${deriveNames})\n`;

        // Insert the decorator above the current line
        const targetLine =
          position !== undefined
            ? editor.document.positionAt(position).line
            : editor.selection.active.line;

        await editor.edit((editBuilder) => {
          const lineStart = new vscode.Position(targetLine, 0);
          editBuilder.insert(lineStart, decorator);
        });
      }
    )
  );
}

/**
 * Diagnostics Bridge — surface macro expansion errors in the editor.
 *
 * Runs the typemacro transformer in a background worker on file save,
 * collects macro-specific diagnostics (code 90000), and publishes them
 * to a VSCode DiagnosticCollection. This provides richer error messages
 * than the TS language service plugin alone.
 */

import * as vscode from "vscode";
import type { ExpansionService } from "./expansion.js";

export class MacroDiagnosticsManager {
  private readonly collection: vscode.DiagnosticCollection;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly expansion: ExpansionService) {
    this.collection = vscode.languages.createDiagnosticCollection("typemacro");

    // Re-run diagnostics on save
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument((doc) => {
        if (this.isTypeScriptDocument(doc)) {
          this.updateDiagnostics(doc);
        }
      }),
    );

    // Clear diagnostics when a file is closed
    this.disposables.push(
      vscode.workspace.onDidCloseTextDocument((doc) => {
        this.collection.delete(doc.uri);
      }),
    );

    // Run diagnostics on all open TS files at startup
    for (const doc of vscode.workspace.textDocuments) {
      if (this.isTypeScriptDocument(doc)) {
        this.updateDiagnostics(doc);
      }
    }
  }

  private async updateDiagnostics(
    document: vscode.TextDocument,
  ): Promise<void> {
    const config = vscode.workspace.getConfiguration("typemacro");
    if (!config.get<boolean>("enableDiagnostics", true)) {
      this.collection.delete(document.uri);
      return;
    }

    try {
      const result = await this.expansion.expandFile(document);
      if (!result) {
        this.collection.delete(document.uri);
        return;
      }

      const diagnostics: vscode.Diagnostic[] = result.diagnostics.map((d) => {
        const range = d.range
          ? new vscode.Range(
              new vscode.Position(d.range.startLine, d.range.startChar),
              new vscode.Position(d.range.endLine, d.range.endChar),
            )
          : new vscode.Range(0, 0, 0, 0);

        const severity =
          d.severity === "error"
            ? vscode.DiagnosticSeverity.Error
            : vscode.DiagnosticSeverity.Warning;

        const diag = new vscode.Diagnostic(range, d.message, severity);
        diag.source = "typemacro";
        diag.code = d.code;

        if (d.expansion) {
          diag.relatedInformation = [
            new vscode.DiagnosticRelatedInformation(
              new vscode.Location(document.uri, range),
              `Expansion:\n${d.expansion}`,
            ),
          ];
        }

        return diag;
      });

      this.collection.set(document.uri, diagnostics);
    } catch {
      // Expansion failed entirely — clear diagnostics rather than show stale ones
      this.collection.delete(document.uri);
    }
  }

  private isTypeScriptDocument(doc: vscode.TextDocument): boolean {
    return (
      doc.languageId === "typescript" || doc.languageId === "typescriptreact"
    );
  }

  dispose(): void {
    this.collection.dispose();
    for (const d of this.disposables) d.dispose();
  }
}

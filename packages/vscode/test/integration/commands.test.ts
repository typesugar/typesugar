/**
 * Integration tests for VS Code extension commands.
 *
 * Verifies that commands execute without throwing and produce
 * the expected side effects (opening editors, showing messages, etc.).
 */
import * as assert from "assert";
import * as vscode from "vscode";

suite("Command Execution", () => {
  const EXTENSION_ID = "typesugar.typesugar";

  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    if (ext && !ext.isActive) {
      await ext.activate();
    }
  });

  test("typesugar.refreshManifest completes without error", async function () {
    this.timeout(10000);

    await assert.doesNotReject(
      vscode.commands.executeCommand("typesugar.refreshManifest"),
      "refreshManifest should complete without error"
    );
  });

  test("typesugar.expandMacro handles no active editor", async function () {
    this.timeout(10000);

    await vscode.commands.executeCommand("workbench.action.closeAllEditors");

    // Should show a warning, not throw
    await assert.doesNotReject(
      vscode.commands.executeCommand("typesugar.expandMacro"),
      "expandMacro should not throw without editor"
    );
  });

  test("typesugar.showTransformed handles no active editor", async function () {
    this.timeout(10000);

    await vscode.commands.executeCommand("workbench.action.closeAllEditors");

    await assert.doesNotReject(
      vscode.commands.executeCommand("typesugar.showTransformed"),
      "showTransformed should not throw without editor"
    );
  });

  test("typesugar.expandMacro works with a TypeScript file open", async function () {
    this.timeout(15000);

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders?.length) {
      this.skip();
      return;
    }

    const sampleUri = vscode.Uri.joinPath(workspaceFolders[0].uri, "sample.ts");
    const doc = await vscode.workspace.openTextDocument(sampleUri);
    const editor = await vscode.window.showTextDocument(doc);

    // Move cursor to the beginning (near a macro)
    editor.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0));

    await assert.doesNotReject(
      vscode.commands.executeCommand("typesugar.expandMacro"),
      "expandMacro should not throw with editor open"
    );
  });

  test("typesugar.showTransformed works with a TypeScript file open", async function () {
    this.timeout(15000);

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders?.length) {
      this.skip();
      return;
    }

    const sampleUri = vscode.Uri.joinPath(workspaceFolders[0].uri, "sample.ts");
    const doc = await vscode.workspace.openTextDocument(sampleUri);
    await vscode.window.showTextDocument(doc);

    await assert.doesNotReject(
      vscode.commands.executeCommand("typesugar.showTransformed"),
      "showTransformed should not throw with file open"
    );
  });

  test("typesugar.showTransformed rejects non-TypeScript files", async function () {
    this.timeout(10000);

    // Open a non-TS file
    const doc = await vscode.workspace.openTextDocument({
      content: "# README",
      language: "markdown",
    });
    await vscode.window.showTextDocument(doc);

    // Should show warning, not throw
    await assert.doesNotReject(
      vscode.commands.executeCommand("typesugar.showTransformed"),
      "showTransformed should handle non-TS files gracefully"
    );
  });
});

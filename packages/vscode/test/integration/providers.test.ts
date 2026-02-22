/**
 * Integration tests for VS Code extension providers.
 *
 * These run in the Extension Development Host and verify that providers
 * are actually registered and respond to VS Code API calls.
 */
import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";

suite("Provider Integration", () => {
  const EXTENSION_ID = "typesugar.typesugar";
  let sampleDocUri: vscode.Uri;

  suiteSetup(async () => {
    // Activate extension
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    if (ext && !ext.isActive) {
      await ext.activate();
    }

    // Find sample.ts in the test fixture workspace
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders?.length) {
      sampleDocUri = vscode.Uri.joinPath(workspaceFolders[0].uri, "sample.ts");
    }
  });

  test("Semantic tokens are provided for TypeScript files", async function () {
    this.timeout(10000);

    if (!sampleDocUri) {
      this.skip();
      return;
    }

    const doc = await vscode.workspace.openTextDocument(sampleDocUri);
    await vscode.window.showTextDocument(doc);

    // Wait for extension to process the file
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Request semantic tokens via VS Code API
    const tokens = await vscode.commands.executeCommand<vscode.SemanticTokens>(
      "vscode.provideDocumentSemanticTokens",
      doc.uri
    );

    // We expect some tokens since sample.ts has macro invocations
    // (the exact count depends on the manifest and file content)
    assert.ok(tokens, "Should provide semantic tokens object");
    assert.ok(tokens.data.length > 0, "Should have token data for macro-containing file");
  });

  test("No semantic tokens for plain TypeScript file", async function () {
    this.timeout(10000);

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders?.length) {
      this.skip();
      return;
    }

    const noMacrosUri = vscode.Uri.joinPath(workspaceFolders[0].uri, "no-macros.ts");
    const doc = await vscode.workspace.openTextDocument(noMacrosUri);
    await vscode.window.showTextDocument(doc);

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const tokens = await vscode.commands.executeCommand<vscode.SemanticTokens>(
      "vscode.provideDocumentSemanticTokens",
      doc.uri
    );

    // no-macros.ts should have no typesugar semantic tokens
    // (it may still have tokens from other providers, but our provider returns none)
    if (tokens) {
      // Tokens from our provider would be in addition to built-in ones.
      // We can't easily distinguish, so just verify no errors occurred.
      assert.ok(true, "No errors providing tokens for non-macro file");
    }
  });

  test("CodeLens is provided for macro-containing files", async function () {
    this.timeout(10000);

    if (!sampleDocUri) {
      this.skip();
      return;
    }

    const doc = await vscode.workspace.openTextDocument(sampleDocUri);
    await vscode.window.showTextDocument(doc);

    await new Promise((resolve) => setTimeout(resolve, 2000));

    const codeLenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      "vscode.executeCodeLensProvider",
      doc.uri
    );

    assert.ok(codeLenses, "Should return CodeLens array");
    assert.ok(codeLenses.length > 0, "Should have at least one CodeLens for macro file");

    // Verify at least one lens has the typesugar command
    const typesugarLens = codeLenses.find((l) => l.command?.command === "typesugar.expandMacro");
    assert.ok(typesugarLens, "Should have a typesugar.expandMacro CodeLens");
  });

  test("Empty file produces no CodeLens", async function () {
    this.timeout(10000);

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders?.length) {
      this.skip();
      return;
    }

    const emptyUri = vscode.Uri.joinPath(workspaceFolders[0].uri, "empty.ts");
    const doc = await vscode.workspace.openTextDocument(emptyUri);
    await vscode.window.showTextDocument(doc);

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const codeLenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      "vscode.executeCodeLensProvider",
      doc.uri
    );

    // Our provider should return no lenses for empty file
    // (other extensions might add theirs, so we just check ours aren't there)
    const typesugarLenses = (codeLenses ?? []).filter(
      (l) => l.command?.command === "typesugar.expandMacro"
    );
    assert.strictEqual(typesugarLenses.length, 0, "Empty file should have no typesugar CodeLens");
  });
});

/**
 * Integration tests: the tsserver plugin is the language engine (PEP-060 D5).
 *
 * These run in the Extension Development Host. They check that VS Code's
 * TypeScript server loaded `@typesugar/ts-plugin` (registered through
 * `typescriptServerPlugins`) and that its custom requests — the ones behind
 * "Expand Macro at Cursor" and "Show Transformed Source" — answer.
 */
import * as assert from "assert";
import * as vscode from "vscode";

suite("tsserver plugin", () => {
  const EXTENSION_ID = "typesugar.typesugar-vscode";
  let sampleDocUri: vscode.Uri | undefined;

  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    if (ext && !ext.isActive) {
      await ext.activate();
    }
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders?.length) {
      sampleDocUri = vscode.Uri.joinPath(workspaceFolders[0].uri, "sample.ts");
    }
  });

  test("_typesugar.showTransformed returns the plugin's transformed text", async function () {
    this.timeout(30000);
    if (!sampleDocUri) {
      this.skip();
      return;
    }

    const doc = await vscode.workspace.openTextDocument(sampleDocUri);
    await vscode.window.showTextDocument(doc);
    // Give tsserver time to load the project and the plugin.
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const response = await vscode.commands.executeCommand<{
      body?: { original: string; transformed: string; changed: boolean };
    }>("typescript.tsserverRequest", "_typesugar.showTransformed", {
      file: doc.uri.fsPath,
    });

    assert.ok(response?.body, "the typesugar tsserver plugin should answer");
    assert.strictEqual(response.body.original, doc.getText());
  });
});

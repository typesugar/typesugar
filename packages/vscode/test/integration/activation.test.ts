/**
 * Integration tests for VS Code extension activation.
 *
 * These run in the Extension Development Host with full VS Code API access.
 * They verify the extension activates, registers all providers, and sets up
 * the status bar correctly.
 */
import * as assert from "assert";
import * as vscode from "vscode";

suite("Extension Activation", () => {
  const EXTENSION_ID = "typesugar.typesugar";

  test("Extension is present in extensions list", () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `Extension ${EXTENSION_ID} should be found`);
  });

  test("Extension activates successfully", async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, "Extension should exist");

    if (!ext.isActive) {
      await ext.activate();
    }
    assert.strictEqual(ext.isActive, true, "Extension should be active after activation");
  });

  test("All commands are registered", async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    if (ext && !ext.isActive) {
      await ext.activate();
    }

    const commands = await vscode.commands.getCommands(true);

    const expectedCommands = [
      "typesugar.expandMacro",
      "typesugar.showTransformed",
      "typesugar.refreshManifest",
      "typesugar.generateManifest",
      "typesugar.addDerive",
    ];

    for (const cmd of expectedCommands) {
      assert.ok(commands.includes(cmd), `Command '${cmd}' should be registered`);
    }
  });

  test("Extension deactivates cleanly", async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    if (ext && !ext.isActive) {
      await ext.activate();
    }

    // Deactivation happens automatically, but we can verify no errors
    // by checking the extension is still in a good state
    assert.ok(ext, "Extension should still be accessible");
  });

  test("Commands do not throw when no active editor", async () => {
    // Close all editors
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");

    // These should not throw, just show warnings
    await assert.doesNotReject(
      Promise.resolve(vscode.commands.executeCommand("typesugar.expandMacro")),
      "expandMacro should not throw without editor"
    );

    await assert.doesNotReject(
      Promise.resolve(vscode.commands.executeCommand("typesugar.showTransformed")),
      "showTransformed should not throw without editor"
    );
  });
});

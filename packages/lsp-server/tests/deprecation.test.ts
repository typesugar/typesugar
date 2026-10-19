/**
 * @typesugar/lsp-server is not supported in 1.0 (PEP-060 D5): the tsserver
 * plugin is the single editor engine. Starting the server says so, once.
 */
import { describe, it, expect, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { MessageType, ShowMessageNotification } from "vscode-languageserver/node.js";
import { DEPRECATION_MESSAGE, announceDeprecation } from "../src/deprecation.js";

describe("lsp-server deprecation notice", () => {
  it("points users at the TypeScript language-service plugin and the editor setup page", () => {
    expect(DEPRECATION_MESSAGE).toMatch(/not supported in 1\.0/i);
    expect(DEPRECATION_MESSAGE).toContain("@typesugar/transformer/language-service");
    expect(DEPRECATION_MESSAGE).toContain("editor-setup");
  });

  it("warns on stderr and with a window/showMessage notification, once per process", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    // stdout carries the JSON-RPC stream under --stdio: a stray write corrupts it.
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const sendNotification = vi.fn();
    const sendRequest = vi.fn();
    const connection = { sendNotification, sendRequest };
    try {
      announceDeprecation(connection);
      announceDeprecation(connection);
      expect(stderr).toHaveBeenCalledTimes(1);
      expect(String(stderr.mock.calls[0][0])).toContain(DEPRECATION_MESSAGE);
      expect(stdout).not.toHaveBeenCalled();
      // A notification, not window/showMessageRequest: the warning has no
      // actions, so there is nothing for the client to answer.
      expect(sendRequest).not.toHaveBeenCalled();
      expect(sendNotification).toHaveBeenCalledTimes(1);
      const [type, params] = sendNotification.mock.calls[0];
      expect(type.method).toBe("window/showMessage");
      expect(type.method).toBe(ShowMessageNotification.type.method);
      expect(params).toEqual({ type: MessageType.Warning, message: DEPRECATION_MESSAGE });
    } finally {
      stderr.mockRestore();
      stdout.mockRestore();
    }
  });

  it("server.ts announces it on start", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "server.ts"), "utf-8");
    expect(src).toMatch(/announceDeprecation\(connection\)/);
  });

  it("the README carries the banner", () => {
    const readme = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf-8");
    expect(readme).toMatch(/Not supported in 1\.0; use the TypeScript language-service plugin/);
  });
});

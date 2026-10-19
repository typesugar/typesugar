/**
 * @typesugar/lsp-server is not supported in 1.0 (PEP-060 D5): the tsserver
 * plugin is the single editor engine. Starting the server says so, once.
 */
import { describe, it, expect, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { DEPRECATION_MESSAGE, announceDeprecation } from "../src/deprecation.js";

describe("lsp-server deprecation notice", () => {
  it("points users at the TypeScript language-service plugin and the editor setup page", () => {
    expect(DEPRECATION_MESSAGE).toMatch(/not supported in 1\.0/i);
    expect(DEPRECATION_MESSAGE).toContain("@typesugar/transformer/language-service");
    expect(DEPRECATION_MESSAGE).toContain("editor-setup");
  });

  it("warns on stderr and in the editor, once per process", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const showWarningMessage = vi.fn();
    const connection = { window: { showWarningMessage } };
    try {
      announceDeprecation(connection);
      announceDeprecation(connection);
      expect(stderr).toHaveBeenCalledTimes(1);
      expect(String(stderr.mock.calls[0][0])).toContain(DEPRECATION_MESSAGE);
      expect(showWarningMessage).toHaveBeenCalledTimes(1);
      expect(showWarningMessage).toHaveBeenCalledWith(DEPRECATION_MESSAGE);
    } finally {
      stderr.mockRestore();
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

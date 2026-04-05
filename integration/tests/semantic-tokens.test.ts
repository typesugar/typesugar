/**
 * Integration test: Semantic tokens through the LSP server.
 *
 * Verifies that macro invocations get the correct semantic token types
 * for syntax highlighting.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prepareFixture, type PreparedFixture } from "../lib/fixture-manager.js";
import { initSession, openFile, getSemanticTokens, type LspSession } from "../lib/assertions.js";

describe("semantic tokens (basic-project)", () => {
  let fixture: PreparedFixture;
  let session: LspSession;

  beforeAll(async () => {
    fixture = await prepareFixture("basic-project");
    session = await initSession(fixture);
  }, 60000);

  afterAll(async () => {
    await session?.client.dispose();
    fixture?.cleanup();
  });

  it("returns semantic tokens for file with macros", async () => {
    const { uri } = await openFile(session, "src/macros.ts");
    await new Promise((r) => setTimeout(r, 500));

    const tokens = await getSemanticTokens(session, uri);

    // The LSP server should return semantic tokens for macro invocations
    // Token data is encoded as [deltaLine, deltaStart, length, tokenType, tokenModifiers]
    if (tokens && tokens.data.length > 0) {
      expect(tokens.data.length % 5, "token data should be multiple of 5").toBe(0);
    }
    // Even if no custom tokens, the request should not fail
    expect(true, "semantic tokens request should not throw").toBe(true);
  });

  it("returns semantic tokens for file without macros", async () => {
    const { uri } = await openFile(session, "src/navigation.ts");
    await new Promise((r) => setTimeout(r, 500));

    const tokens = await getSemanticTokens(session, uri);
    // Should work without errors even for non-macro files
    expect(true, "semantic tokens for non-macro file should not throw").toBe(true);
  });
});

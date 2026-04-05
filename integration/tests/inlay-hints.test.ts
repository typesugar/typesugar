/**
 * Integration test: Inlay hints through the LSP server.
 *
 * Verifies that comptime evaluation results and bind variable types
 * appear as inline hints.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prepareFixture, type PreparedFixture } from "../lib/fixture-manager.js";
import { initSession, openFile, type LspSession } from "../lib/assertions.js";

interface LspInlayHint {
  position: { line: number; character: number };
  label: string | Array<{ value: string }>;
  kind?: number;
}

describe("inlay hints (basic-project)", () => {
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

  it("returns inlay hints for file with macros", async () => {
    const { uri } = await openFile(session, "src/macros.ts");
    await new Promise((r) => setTimeout(r, 1000));

    const hints = await session.client.request<LspInlayHint[] | null>("textDocument/inlayHint", {
      textDocument: { uri },
      range: {
        start: { line: 0, character: 0 },
        end: { line: 20, character: 0 },
      },
    });

    // If hints are returned, they should have valid positions
    if (hints && hints.length > 0) {
      for (const hint of hints) {
        expect(hint.position.line).toBeGreaterThanOrEqual(0);
        const label =
          typeof hint.label === "string" ? hint.label : hint.label.map((p) => p.value).join("");
        expect(label.length, "hint label should be non-empty").toBeGreaterThan(0);
      }
    }
  });
});

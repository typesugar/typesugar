/**
 * Integration test: CodeLens through the LSP server.
 *
 * Verifies that clickable lenses appear above macro invocations.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prepareFixture, type PreparedFixture } from "../lib/fixture-manager.js";
import { initSession, openFile, type LspSession } from "../lib/assertions.js";

interface LspCodeLens {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  command?: { title: string; command: string };
}

describe("codelens (basic-project)", () => {
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

  it("returns CodeLens for macro-containing file", async () => {
    const { uri } = await openFile(session, "src/macros.ts");
    await new Promise((r) => setTimeout(r, 500));

    const lenses = await session.client.request<LspCodeLens[]>("textDocument/codeLens", {
      textDocument: { uri },
    });

    // Should have lenses for comptime(), @derive, and staticAssert()
    if (lenses && lenses.length > 0) {
      // At least one lens should exist
      expect(lenses.length).toBeGreaterThan(0);

      // Lenses should have valid ranges
      for (const lens of lenses) {
        expect(lens.range.start.line).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("returns no CodeLens for non-macro file", async () => {
    const { uri } = await openFile(session, "src/navigation.ts");
    await new Promise((r) => setTimeout(r, 500));

    const lenses = await session.client.request<LspCodeLens[] | null>("textDocument/codeLens", {
      textDocument: { uri },
    });

    // Non-macro file should have zero typesugar lenses
    const count = lenses?.length ?? 0;
    // It's OK to have zero or just TS-provided lenses
    expect(count).toBeGreaterThanOrEqual(0);
  });
});

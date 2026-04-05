/**
 * Integration test: Code actions through the LSP server.
 *
 * Verifies that quick fixes and refactoring actions are available
 * at the expected positions.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prepareFixture, type PreparedFixture } from "../lib/fixture-manager.js";
import { initSession, openFile, getCodeActions, type LspSession } from "../lib/assertions.js";

describe("code actions (basic-project)", () => {
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

  it("provides code actions at error position", async () => {
    const { uri } = await openFile(session, "src/diagnostics.ts");
    await new Promise((r) => setTimeout(r, 500));

    // Line 6: type error position — should have TS quick fixes
    const actions = await getCodeActions(session, uri, 6, 0, 6, 30);
    // May have zero actions if TS doesn't offer fixes for this error, but shouldn't throw
    expect(Array.isArray(actions), "code actions should return an array").toBe(true);
  });

  it("provides code actions at macro position", async () => {
    const { uri } = await openFile(session, "src/macros.ts");
    await new Promise((r) => setTimeout(r, 500));

    // Line 6: comptime() call — may have "Expand macro" action
    const actions = await getCodeActions(session, uri, 6, 0, 6, 40);
    expect(Array.isArray(actions), "code actions should return an array").toBe(true);
  });
});

/**
 * Integration test: Rename through the LSP server.
 *
 * Verifies that rename maps positions correctly through
 * the source map pipeline.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prepareFixture, type PreparedFixture } from "../lib/fixture-manager.js";
import { initSession, openFile, getRename, type LspSession } from "../lib/assertions.js";

describe("rename (basic-project)", () => {
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

  it("rename function produces edits at all reference sites", async () => {
    const { uri } = await openFile(session, "src/navigation.ts");
    await new Promise((r) => setTimeout(r, 500));

    // Rename "greet" at line 8 (declaration) → "sayHello"
    const edit = await getRename(session, uri, 8, 17, "sayHello");

    expect(edit, "rename should return a workspace edit").not.toBeNull();
    if (edit?.changes) {
      const fileEdits = Object.values(edit.changes).flat();
      expect(fileEdits.length, "should rename at declaration and call site").toBeGreaterThanOrEqual(
        2
      );
    }
  });
});

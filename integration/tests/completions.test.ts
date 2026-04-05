/**
 * Integration test: Completions through the LSP server.
 *
 * Verifies that autocomplete works correctly after macro expansions
 * and that extension method completions appear.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prepareFixture, type PreparedFixture } from "../lib/fixture-manager.js";
import {
  initSession,
  openFile,
  getCompletions,
  assertCompletionContains,
  type LspSession,
} from "../lib/assertions.js";

describe("completions (basic-project)", () => {
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

  it("provides property completions for typed object", async () => {
    const { uri } = await openFile(session, "src/completions.ts");

    // Wait for language service to initialize
    await new Promise((r) => setTimeout(r, 1000));

    // Line 8, char 2: after "c." — should include r, g, b
    await assertCompletionContains(session, uri, 8, 2, "r", "Color.r property");
    await assertCompletionContains(session, uri, 8, 2, "g", "Color.g property");
    await assertCompletionContains(session, uri, 8, 2, "b", "Color.b property");
  });

  it("provides completions after pipe() expansion", async () => {
    const { uri } = await openFile(session, "src/completions.ts");
    await new Promise((r) => setTimeout(r, 1000));

    // Line 13, char 8: after "result." — pipe returns number, so should have number methods
    const items = await getCompletions(session, uri, 13, 7);
    expect(items.length, "should have completions after pipe result").toBeGreaterThan(0);

    // Should include standard number methods
    const labels = items.map((i) => i.label);
    expect(
      labels.some((l) => l === "toFixed" || l === "toString" || l === "valueOf"),
      `expected number methods, got: ${labels.slice(0, 10).join(", ")}`
    ).toBe(true);
  });
});

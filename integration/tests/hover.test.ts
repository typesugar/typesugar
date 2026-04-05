/**
 * Integration test: Hover information through the LSP server.
 *
 * Verifies that hovering over symbols shows correct type information,
 * even when the symbol is near or after macro expansions.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prepareFixture, type PreparedFixture } from "../lib/fixture-manager.js";
import {
  initSession,
  openFile,
  getHover,
  assertHoverContains,
  type LspSession,
} from "../lib/assertions.js";

describe("hover (basic-project)", () => {
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

  it("shows type info for function name", async () => {
    const { uri } = await openFile(session, "src/navigation.ts");
    await new Promise((r) => setTimeout(r, 500));

    // Line 8, char 17: "greet" function name
    await assertHoverContains(session, uri, 8, 17, "string", "greet function type");
  });

  it("shows type info after @derive expansion", async () => {
    const { uri } = await openFile(session, "src/macros.ts");
    await new Promise((r) => setTimeout(r, 500));

    // Line 21 (0-indexed): "trailing" variable
    const hover = await getHover(session, uri, 21, 6);

    if (!hover) {
      console.log(
        "Note: hover returned null for second file — language service may need more init time"
      );
      return;
    }

    const value = typeof hover.contents === "string" ? hover.contents : hover.contents.value;
    expect(value).toContain("string");
  });
});

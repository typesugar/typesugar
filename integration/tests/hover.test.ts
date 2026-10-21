/**
 * Integration test: hover (tsserver `quickinfo`) through the typesugar plugin.
 *
 * Hovering a symbol shows its type, and the hovered range is the symbol's own
 * range in the source, including after macro expansions.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prepareFixture, type PreparedFixture } from "../lib/fixture-manager.js";
import { initSession, openFile, locate, getQuickInfo, type TsSession } from "../lib/assertions.js";

describe("hover (basic-project)", () => {
  let fixture: PreparedFixture;
  let session: TsSession;

  beforeAll(async () => {
    fixture = await prepareFixture("basic-project");
    session = await initSession(fixture);
  }, 60000);

  afterAll(async () => {
    await session?.client.dispose();
    fixture?.cleanup();
  });

  it("shows the signature of a function", async () => {
    const { file, text } = openFile(session, "src/navigation.ts");
    const info = await getQuickInfo(session, file, locate(text, "greet(name", { delta: 1 }));
    expect(info?.displayString).toBe("function greet(name: string): string");
    expect(info?.start).toEqual(locate(text, "greet(name"));
  });

  it("shows the type of a variable after comptime, @derive and staticAssert expansions", async () => {
    const { file, text } = openFile(session, "src/macros.ts");
    const info = await getQuickInfo(session, file, locate(text, "trailing =", { delta: 1 }));
    expect(info?.displayString).toBe('const trailing: "end"');
    expect(info?.start).toEqual(locate(text, "trailing ="));
    expect(info?.end).toEqual(locate(text, "trailing =", { delta: "trailing".length }));
  });
});

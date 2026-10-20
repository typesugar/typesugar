/**
 * Integration test: inlay hints (tsserver `provideInlayHints`) through the
 * typesugar plugin: the expansion preview after an expression macro, and
 * TypeScript's own hints mapped back to source positions.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prepareFixture, type PreparedFixture } from "../lib/fixture-manager.js";
import {
  initSession,
  openFile,
  locate,
  PLUGIN_NAME,
  type Location,
  type TsSession,
} from "../lib/assertions.js";

interface InlayHint {
  text: string;
  position: Location;
  kind: string;
}

describe("inlay hints (basic-project)", () => {
  let fixture: PreparedFixture;
  let session: TsSession;
  let file: string;
  let text: string;

  const hints = () =>
    session.client.request<InlayHint[]>("provideInlayHints", {
      file,
      start: 0,
      length: text.length,
    });
  const COMPTIME_CALL = "comptime(() => 6 * 7)";

  beforeAll(async () => {
    fixture = await prepareFixture("basic-project");
    session = await initSession(fixture);
    ({ file, text } = openFile(session, "src/macros.ts"));
  }, 60000);

  afterAll(async () => {
    await session?.client.dispose();
    fixture?.cleanup();
  });

  it("does not evaluate comptime for a hint unless the editor enables it", async () => {
    expect((await hints()).map((h) => h.text)).not.toContain("= 42");
  });

  // PEP-060 item 5: the plugin maps the requested span to the expanded text
  // and drops TypeScript's own hints when either end doesn't map, which is the
  // case whenever the span starts or ends in a comment (here: start of file).
  // Without the plugin TypeScript returns `: number` after `answer`. Flip to
  // `it` when that is fixed.
  it.fails(
    "shows TypeScript's variable-type hint at the source position (PEP-060 item 5)",
    async () => {
      await session.client.request("configure", {
        preferences: { includeInlayVariableTypeHints: true },
      });
      try {
        const typeHint = (await hints()).find((h) => h.text === ": number");
        // `const answer = comptime(...)`: the hint goes right after `answer`.
        expect(typeHint?.position).toEqual(locate(text, "answer =", { delta: "answer".length }));
      } finally {
        await session.client.request("configure", {
          preferences: { includeInlayVariableTypeHints: false },
        });
      }
    }
  );

  it("shows `= 42` after the comptime call once the editor enables comptimeInEditor", async () => {
    // What the VS Code extension sends for `typesugar.comptimeInEditor: true`.
    await session.client.request("configurePlugin", {
      pluginName: PLUGIN_NAME,
      configuration: { comptimeInEditor: true },
    });
    const hint = (await hints()).find((h) => h.text === "= 42");
    expect(hint?.position).toEqual(locate(text, COMPTIME_CALL, { delta: COMPTIME_CALL.length }));
  });
});

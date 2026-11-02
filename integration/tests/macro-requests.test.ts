/**
 * Integration test: the plugin's custom tsserver requests behind the VS Code
 * extension's "Expand Macro at Cursor" and "Show Transformed Source" commands
 * (`_typesugar.expandMacro`, `_typesugar.showTransformed`).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prepareFixture, type PreparedFixture } from "../lib/fixture-manager.js";
import {
  initSession,
  openFile,
  positionOf,
  PLUGIN_NAME,
  type TsSession,
} from "../lib/assertions.js";

interface ExpandMacroResponse {
  macroName: string;
  expandedText: string;
}
interface ShowTransformedResponse {
  original: string;
  transformed: string;
  changed: boolean;
}

describe("custom tsserver requests (basic-project)", () => {
  let fixture: PreparedFixture;
  let session: TsSession;
  let file: string;
  let text: string;

  const expandAt = (position: number, inFile = file) =>
    session.client.requestRaw<ExpandMacroResponse>("_typesugar.expandMacro", {
      file: inFile,
      position,
    });

  beforeAll(async () => {
    fixture = await prepareFixture("basic-project");
    session = await initSession(fixture);
    ({ file, text } = openFile(session, "src/macros.ts"));
    await session.client.request("configurePlugin", {
      pluginName: PLUGIN_NAME,
      configuration: { comptimeInEditor: true },
    });
  }, 60000);

  afterAll(async () => {
    await session?.client.dispose();
    fixture?.cleanup();
  });

  it("expandMacro inside a comptime call returns its evaluated expansion", async () => {
    const res = await expandAt(positionOf(text, "6 * 7"));
    expect(res.success).toBe(true);
    expect(res.body).toEqual({ macroName: "comptime", expandedText: "42" });
  });

  it("expandMacro on a staticAssert call returns its expansion", async () => {
    const res = await expandAt(positionOf(text, "staticAssert(false", { delta: 3 }));
    expect(res.body).toEqual({ macroName: "staticAssert", expandedText: "void 0" });
  });

  it("expandMacro in a file without macros returns no result", async () => {
    const nav = openFile(session, "src/navigation.ts");
    const res = await expandAt(positionOf(nav.text, "greet(name"), nav.file);
    expect(res.body).toBeUndefined();
  });

  it("showTransformed returns the source and the expanded code TypeScript sees", async () => {
    const body = await session.client.request<ShowTransformedResponse>(
      "_typesugar.showTransformed",
      { file }
    );
    expect(body.changed).toBe(true);
    expect(body.original).toBe(text);
    expect(body.transformed).toMatch(/const answer = 42;/);
    expect(body.transformed).not.toContain("staticAssert(false");
    // @derive(Eq) adds the companion; the interface itself stays.
    expect(body.transformed).toContain("interface Metric");
    expect(body.transformed.length).toBeGreaterThan(text.length);
  });

  it("showTransformed for a file outside every project returns no result", async () => {
    const res = await session.client.requestRaw("_typesugar.showTransformed", {
      file: "/nonexistent/elsewhere.ts",
    });
    expect(res.body).toBeUndefined();
  });
});

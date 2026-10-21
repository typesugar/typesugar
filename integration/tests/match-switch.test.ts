/**
 * Integration test: the `match:` statement form through tsserver + the
 * typesugar plugin. Names bound by a case pattern are declared by the
 * expansion, so the editor shows no "Cannot find name" on them, hover shows
 * their types, and the macro's own exhaustiveness error lands on the label.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prepareFixture, type PreparedFixture } from "../lib/fixture-manager.js";
import {
  initSession,
  openFile,
  locate,
  getDiagnostics,
  getQuickInfo,
  type TsSession,
  type TsDiagnostic,
} from "../lib/assertions.js";

describe("match: switch (basic-project)", () => {
  let fixture: PreparedFixture;
  let session: TsSession;
  let file: string;
  let text: string;
  let diagnostics: TsDiagnostic[] = [];

  beforeAll(async () => {
    fixture = await prepareFixture("basic-project");
    session = await initSession(fixture);
    ({ file, text } = openFile(session, "src/match-switch.ts"));
    diagnostics = await getDiagnostics(session, file);
  }, 60000);

  afterAll(async () => {
    await session?.client.dispose();
    fixture?.cleanup();
  });

  it("reports only the missing case, on the match label (no TS2304 on bound names)", () => {
    const summary = diagnostics.map((d) => `${d.code} ${d.text}`);
    expect(summary).toEqual([expect.stringMatching(/^9226 .*missing cases: "Polygon"/)]);
    const at = locate(text, "match: switch (kind)");
    expect(diagnostics[0].start).toEqual(at);
  });

  it("hover on a name bound by a case pattern shows the variant's element type", async () => {
    const info = await getQuickInfo(session, file, locate(text, "x + y", { delta: 0 }));
    expect(info?.displayString).toBe("const x: number");
  });

  it("hover on a shorthand binding shows the variant's property type", async () => {
    const info = await getQuickInfo(session, file, locate(text, "coordinates.length"));
    expect(info?.displayString).toBe("const coordinates: number[][]");
  });
});

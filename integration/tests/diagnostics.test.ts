/**
 * Integration test: diagnostic positions through tsserver + the typesugar plugin.
 *
 * Red squiggles must land on the right line and column for TypeScript errors
 * and typesugar macro errors, including after expansions that change the size
 * of the code.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prepareFixture, type PreparedFixture } from "../lib/fixture-manager.js";
import {
  initSession,
  openFile,
  locate,
  getDiagnostics,
  assertDiagnosticAt,
  type TsSession,
  type TsDiagnostic,
} from "../lib/assertions.js";

describe("diagnostic positions (basic-project)", () => {
  let fixture: PreparedFixture;
  let session: TsSession;
  let file: string;
  let text: string;
  let diagnostics: TsDiagnostic[] = [];

  beforeAll(async () => {
    fixture = await prepareFixture("basic-project");
    session = await initSession(fixture);
    ({ file, text } = openFile(session, "src/diagnostics.ts"));
    diagnostics = await getDiagnostics(session, file);
  }, 60000);

  afterAll(async () => {
    await session?.client.dispose();
    fixture?.cleanup();
  });

  it("TS type error before @derive maps to the declared name", () => {
    const d = assertDiagnosticAt(
      diagnostics,
      locate(text, "x: number"),
      "not assignable",
      "type error before @derive"
    );
    expect(d.code).toBe(2322);
  });

  it("TS type error after @derive expansion maps to the declared name", () => {
    const d = assertDiagnosticAt(
      diagnostics,
      locate(text, "y: string"),
      "not assignable",
      "type error after @derive"
    );
    expect(d.code).toBe(2322);
  });

  it("staticAssert macro error points to the call and spans it", () => {
    const d = assertDiagnosticAt(
      diagnostics,
      locate(text, "staticAssert(false"),
      "Static assertion failed: intentional failure",
      "staticAssert"
    );
    expect(d.code).toBe(9217);
    const call = 'staticAssert(false, "intentional failure")';
    expect(d.end).toEqual(locate(text, call, { delta: call.length }));
  });

  it("reports exactly the three expected errors", () => {
    expect(
      diagnostics.map((d) => d.code).sort(),
      diagnostics.map((d) => `${d.start.line}:${d.start.offset} ${d.text}`).join("\n")
    ).toEqual([2322, 2322, 9217]);
  });

  it("diagnostic spans have non-zero length", () => {
    for (const d of diagnostics) {
      const nonEmpty =
        d.end.line > d.start.line || (d.end.line === d.start.line && d.end.offset > d.start.offset);
      expect(nonEmpty, `diagnostic "${d.text.slice(0, 40)}" should have a non-empty span`).toBe(
        true
      );
    }
  });

  it("pipe() expansion: type error after a multi-line pipe maps to the right name", async () => {
    const pipe = openFile(session, "src/pipe-chain.ts");
    const pipeDiagnostics = await getDiagnostics(session, pipe.file);
    const d = assertDiagnosticAt(
      pipeDiagnostics,
      locate(pipe.text, "pipeBad"),
      "not assignable",
      "type error after pipe"
    );
    expect(d.end).toEqual(locate(pipe.text, "pipeBad", { delta: "pipeBad".length }));
    expect(pipeDiagnostics).toHaveLength(1);
  });

  // A file without macros is served as written (positions map by identity),
  // and the source map of an expanded file maps tokens after a `${...}`
  // template (PEP-060 item 5).
  it("type error after a template literal is reported", async () => {
    const tpl = openFile(session, "src/template-literal.ts");
    const tplDiagnostics = await getDiagnostics(session, tpl.file);
    assertDiagnosticAt(tplDiagnostics, locate(tpl.text, "notANumber"), "not assignable");
  });

  it("diagnostics clear when the error is fixed (geterr after an edit)", async () => {
    expect(diagnostics.length).toBeGreaterThan(0);
    const lines = text.split("\n");

    // Replace the whole file, as an editor sends a change.
    session.client.notify("change", {
      file,
      line: 1,
      offset: 1,
      endLine: lines.length,
      endOffset: lines[lines.length - 1].length + 1,
      insertString: "export const fixed = 1;\n",
    });
    session.client.clearEvents();
    session.client.notify("geterr", { files: [file], delay: 0 });

    const semantic = await session.client.waitForEvent<{
      file: string;
      diagnostics: TsDiagnostic[];
    }>("semanticDiag", (b) => b.file === file);
    expect(semantic.diagnostics).toEqual([]);
  });
});

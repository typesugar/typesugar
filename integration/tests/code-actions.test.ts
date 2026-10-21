/**
 * Integration test: quick fixes (tsserver `getCodeFixes`) through the
 * typesugar plugin. TypeScript's own fixes must edit the right text in a file
 * whose @derive and pipe() expansions change the code above the error.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prepareFixture, type PreparedFixture } from "../lib/fixture-manager.js";
import {
  initSession,
  openFile,
  locate,
  toPos,
  getDiagnostics,
  assertDiagnosticAt,
  type Location,
  type TsSession,
} from "../lib/assertions.js";

interface CodeFix {
  fixName: string;
  description: string;
  changes: Array<{
    fileName: string;
    textChanges: Array<{ start: Location; end: Location; newText: string }>;
  }>;
}

describe("code actions (basic-project)", () => {
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

  // The plugin maps the error's span into the expanded code for TypeScript and
  // the fix's edits back to the source (PEP-060 item 5).
  it("offers TypeScript's spelling fix and its edit lands on the misspelled name", async () => {
    const { file, text } = openFile(session, "src/code-actions.ts");
    const diagnostics = await getDiagnostics(session, file);
    const error = assertDiagnosticAt(
      diagnostics,
      locate(text, "greetng"),
      "Cannot find name 'greetng'",
      "misspelled call"
    );

    const fixes = await session.client.request<CodeFix[]>("getCodeFixes", {
      file,
      startLine: error.start.line,
      startOffset: error.start.offset,
      endLine: error.end.line,
      endOffset: error.end.offset,
      errorCodes: [error.code],
    });
    const spelling = fixes.find((f) => f.fixName === "spelling");
    expect(spelling?.description).toBe("Change spelling to 'greeting'");

    // Apply the fix to the ORIGINAL text: it must change exactly that name.
    const changes = spelling!.changes.flatMap((c) => c.textChanges);
    expect(changes).toHaveLength(1);
    const [change] = changes;
    const fixed =
      text.slice(0, toPos(text, change.start)) +
      change.newText +
      text.slice(toPos(text, change.end));
    expect(fixed).toBe(text.replace('greetng("there")', 'greeting("there")'));
  });
});

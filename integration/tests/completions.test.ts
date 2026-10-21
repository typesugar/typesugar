/**
 * Integration test: completions through tsserver + the typesugar plugin.
 *
 * Member completions must work in a file whose `@derive` expansion adds code
 * above the cursor.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prepareFixture, type PreparedFixture } from "../lib/fixture-manager.js";
import {
  initSession,
  openFile,
  locate,
  getCompletionNames,
  type TsSession,
} from "../lib/assertions.js";

describe("completions (basic-project)", () => {
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

  it("offers the members of a @derive'd interface after `c.`", async () => {
    const { file, text } = openFile(session, "src/completions.ts");
    const names = await getCompletionNames(session, file, locate(text, "c.\n", { delta: 2 }));
    expect(names).toEqual(expect.arrayContaining(["r", "g", "b"]));
  });

  it("offers in-scope names after the expansions in a macro file", async () => {
    const { file, text } = openFile(session, "src/macros.ts");
    // At the start of `trailing`'s initializer: the names declared above the
    // expansions (a comptime result and a @derive'd interface) are in scope.
    const names = await getCompletionNames(session, file, locate(text, '"end"'));
    expect(names).toEqual(expect.arrayContaining(["answer", "Metric"]));
  });
});

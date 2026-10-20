/**
 * Integration test: rename (tsserver `rename`) through the typesugar plugin.
 * Every rename location must be the symbol's own range in the source.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prepareFixture, type PreparedFixture } from "../lib/fixture-manager.js";
import {
  initSession,
  openFile,
  locate,
  getRenameLocations,
  spanText,
  type TsSession,
} from "../lib/assertions.js";

describe("rename (basic-project)", () => {
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

  it("renames a function at its declaration and every call, across expansions", async () => {
    const { file, text } = openFile(session, "src/navigation-macros.ts");
    const { canRename, spans } = await getRenameLocations(
      session,
      file,
      locate(text, "scale(v: Vec", { delta: 1 })
    );
    expect(canRename).toBe(true);
    expect(spans.map((s) => s.start)).toEqual([
      locate(text, "scale(v: Vec"),
      locate(text, "scale(v, 2)"),
      locate(text, "scale(doubled"),
    ]);
    for (const s of spans) {
      expect(s.file).toBe(file);
      expect(spanText(text, s)).toBe("scale");
    }
  });

  // PEP-060 item 5: the @derive(Eq) companion's own references to `Vec`
  // (generated code) map back onto the `@derive` JSDoc tag, so rename returns
  // five extra locations covering "@de" and would corrupt the comment. Flip to
  // `it` when generated references are filtered out.
  it.fails("renames a type used by @derive and in pipe() arguments (PEP-060 item 5)", async () => {
    const { file, text } = openFile(session, "src/navigation-macros.ts");
    const { spans } = await getRenameLocations(session, file, locate(text, "Vec {", { delta: 1 }));
    // interface Vec, scale's parameter and return type, and the two pipe() lambdas
    expect(spans).toHaveLength(5);
    for (const s of spans) expect(spanText(text, s)).toBe("Vec");
  });

  // PEP-060 item 5: positions after a template literal don't map back (see
  // navigation.test.ts), so the call site is missing. Flip to `it` when fixed.
  it.fails("renames greet() at its declaration and its call (PEP-060 item 5)", async () => {
    const { file, text } = openFile(session, "src/navigation.ts");
    const { spans } = await getRenameLocations(
      session,
      file,
      locate(text, "greet(name", { delta: 1 })
    );
    expect(spans.map((s) => s.start)).toEqual([
      locate(text, "greet(name"),
      locate(text, 'greet("world")'),
    ]);
  });
});

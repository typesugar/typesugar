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

  // The @derive(Eq) companion's own references to `Vec` are generated code
  // that the source map attributes to the `@derive` tag; rename drops them
  // instead of editing "@de" of the comment (PEP-060 item 5).
  it("renames a type used by @derive and in pipe() arguments", async () => {
    const { file, text } = openFile(session, "src/navigation-macros.ts");
    const { spans } = await getRenameLocations(session, file, locate(text, "Vec {", { delta: 1 }));
    // interface Vec, scale's parameter and return type, and the two pipe() lambdas
    expect(spans).toHaveLength(5);
    for (const s of spans) expect(spanText(text, s)).toBe("Vec");
  });

  // Positions after a template literal map (see navigation.test.ts).
  it("renames greet() at its declaration and its call", async () => {
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

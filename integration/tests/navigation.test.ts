/**
 * Integration test: go-to-definition and find-references through tsserver +
 * the typesugar plugin. Positions must map through the macro expansions in
 * both directions.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prepareFixture, type PreparedFixture } from "../lib/fixture-manager.js";
import {
  initSession,
  openFile,
  locate,
  getDefinition,
  getReferences,
  type TsSession,
} from "../lib/assertions.js";

describe("navigation (basic-project)", () => {
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

  describe("across @derive and pipe() expansions", () => {
    // tsserver turns a definition's offset into line/offset with the language
    // service's `toLineColumnOffset`; the plugin converts it on the source
    // text, not the expanded code (PEP-060 item 5).
    it("go-to-definition on a call after the expansions jumps to the declaration", async () => {
      const { file, text } = openFile(session, "src/navigation-macros.ts");
      const defs = await getDefinition(session, file, locate(text, "scale(doubled", { delta: 1 }));
      expect(defs).toHaveLength(1);
      expect(defs[0].file).toBe(file);
      expect(defs[0].start).toEqual(locate(text, "scale(v: Vec"));
    });

    it("go-to-definition inside a pipe() argument jumps to the declaration", async () => {
      const { file, text } = openFile(session, "src/navigation-macros.ts");
      const defs = await getDefinition(session, file, locate(text, "scale(v, 2)", { delta: 1 }));
      expect(defs.map((d) => d.start)).toEqual([locate(text, "scale(v: Vec")]);
    });

    it("find-references returns the declaration and both calls", async () => {
      const { file, text } = openFile(session, "src/navigation-macros.ts");
      const refs = await getReferences(session, file, locate(text, "scale(v: Vec", { delta: 1 }));
      expect(refs.map((r) => r.start)).toEqual([
        locate(text, "scale(v: Vec"),
        locate(text, "scale(v, 2)"),
        locate(text, "scale(doubled"),
      ]);
      expect(refs.find((r) => r.isDefinition)?.start).toEqual(locate(text, "scale(v: Vec"));
    });
  });

  // A file without macros is served as written, so positions map by identity
  // (navigation.ts has a `${...}` template inside greet(), after which the old
  // reprint's source map had no mappings; PEP-060 item 5).
  describe("in a file without macros", () => {
    it("go-to-definition on `greet(...)` jumps to its declaration", async () => {
      const { file, text } = openFile(session, "src/navigation.ts");
      const defs = await getDefinition(session, file, locate(text, 'greet("world")', { delta: 1 }));
      expect(defs.map((d) => d.start)).toEqual([locate(text, "greet(name")]);
    });

    it("go-to-definition on `add(...)` jumps to its declaration", async () => {
      const { file, text } = openFile(session, "src/navigation.ts");
      const defs = await getDefinition(session, file, locate(text, "add(1, 2)", { delta: 1 }));
      expect(defs.map((d) => d.start)).toEqual([locate(text, "add(a: number")]);
    });

    it("find-references includes the declaration and the call", async () => {
      const { file, text } = openFile(session, "src/navigation.ts");
      const refs = await getReferences(session, file, locate(text, "greet(name", { delta: 1 }));
      expect(refs.map((r) => r.start)).toEqual([
        locate(text, "greet(name"),
        locate(text, 'greet("world")'),
      ]);
    });
  });
});

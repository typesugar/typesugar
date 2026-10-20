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
    // PEP-060 item 5: the plugin maps the definition's offset back correctly,
    // but tsserver turns it into line/offset with the language service's
    // `toLineColumnOffset`, which reads the EXPANDED text (the plugin doesn't
    // wrap it). After the @derive companion the result lands on the wrong
    // line ("8:33" instead of "10:17" here). References and rename use the
    // open file's own text and are right. Flip to `it` when that is fixed.
    it.fails(
      "go-to-definition on a call after the expansions jumps to the declaration (PEP-060 item 5)",
      async () => {
        const { file, text } = openFile(session, "src/navigation-macros.ts");
        const defs = await getDefinition(
          session,
          file,
          locate(text, "scale(doubled", { delta: 1 })
        );
        expect(defs).toHaveLength(1);
        expect(defs[0].file).toBe(file);
        expect(defs[0].start).toEqual(locate(text, "scale(v: Vec"));
      }
    );

    it.fails(
      "go-to-definition inside a pipe() argument jumps to the declaration (PEP-060 item 5)",
      async () => {
        const { file, text } = openFile(session, "src/navigation-macros.ts");
        const defs = await getDefinition(session, file, locate(text, "scale(v, 2)", { delta: 1 }));
        expect(defs.map((d) => d.start)).toEqual([locate(text, "scale(v: Vec")]);
      }
    );

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

  // PEP-060 item 5 (one diagnostics and position model): the plugin reprints
  // every file, macros or not, and the reprint's source map has no mappings
  // after a template literal with a substitution. navigation.ts has one inside
  // greet(), so nothing after it maps: definitions from the calls come back
  // empty and references lose the call sites. Flip to `it` when that is fixed.
  describe("in a file without macros", () => {
    it.fails(
      "go-to-definition on `greet(...)` jumps to its declaration (PEP-060 item 5)",
      async () => {
        const { file, text } = openFile(session, "src/navigation.ts");
        const defs = await getDefinition(
          session,
          file,
          locate(text, 'greet("world")', { delta: 1 })
        );
        expect(defs.map((d) => d.start)).toEqual([locate(text, "greet(name")]);
      }
    );

    it.fails(
      "go-to-definition on `add(...)` jumps to its declaration (PEP-060 item 5)",
      async () => {
        const { file, text } = openFile(session, "src/navigation.ts");
        const defs = await getDefinition(session, file, locate(text, "add(1, 2)", { delta: 1 }));
        expect(defs.map((d) => d.start)).toEqual([locate(text, "add(a: number")]);
      }
    );

    it.fails("find-references includes the declaration and the call (PEP-060 item 5)", async () => {
      const { file, text } = openFile(session, "src/navigation.ts");
      const refs = await getReferences(session, file, locate(text, "greet(name", { delta: 1 }));
      expect(refs.map((r) => r.start)).toEqual([
        locate(text, "greet(name"),
        locate(text, 'greet("world")'),
      ]);
    });
  });
});

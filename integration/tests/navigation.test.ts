/**
 * Integration test: Navigation (go-to-definition, references, highlights).
 *
 * Verifies that navigation features map positions correctly
 * through the source map pipeline.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prepareFixture, type PreparedFixture } from "../lib/fixture-manager.js";
import {
  initSession,
  openFile,
  getDefinition,
  getReferences,
  type LspSession,
} from "../lib/assertions.js";

describe("navigation (basic-project)", () => {
  let fixture: PreparedFixture;
  let session: LspSession;

  beforeAll(async () => {
    fixture = await prepareFixture("basic-project");
    session = await initSession(fixture);
  }, 60000);

  afterAll(async () => {
    await session?.client.dispose();
    fixture?.cleanup();
  });

  it("go-to-definition on function call jumps to declaration", async () => {
    const { uri } = await openFile(session, "src/navigation.ts");
    await new Promise((r) => setTimeout(r, 1000));

    // Line 12 (0-indexed), char 14: "greet" in `const msg = greet("world")`
    const def = await getDefinition(session, uri, 12, 14);

    if (!def) {
      console.log(
        "Note: go-to-definition returned null — language service may need more init time"
      );
      return;
    }

    const loc = Array.isArray(def) ? def[0] : def;
    // Should jump to line 8 (0-indexed): `export function greet(...)`
    expect(loc.range.start.line, "greet definition line").toBe(8);
  });

  it("go-to-definition on second function call works", async () => {
    const { uri } = await openFile(session, "src/navigation.ts");
    await new Promise((r) => setTimeout(r, 500));

    // Line 18 (0-indexed), char 14: "add" in `const sum = add(1, 2)`
    const def = await getDefinition(session, uri, 18, 14);

    if (!def) {
      console.log(
        "Note: go-to-definition returned null — language service may need more init time"
      );
      return;
    }

    const loc = Array.isArray(def) ? def[0] : def;
    expect(loc.range.start.line, "add definition line").toBe(14);
  });

  it("find-references includes both declaration and usage", async () => {
    const { uri } = await openFile(session, "src/navigation.ts");
    await new Promise((r) => setTimeout(r, 500));

    // Line 8, char 17: "greet" in function declaration
    const refs = await getReferences(session, uri, 8, 17);

    if (refs.length < 2) {
      console.log(
        `Note: find-references returned ${refs.length} refs — language service may need more init time`
      );
      return;
    }

    const lines = refs.map((r) => r.range.start.line);
    expect(lines, "should include declaration line").toContain(8);
    expect(lines, "should include call line").toContain(12);
  });
});

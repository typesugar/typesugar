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
  assertDefinitionAt,
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

    // Line 12 (0-indexed), char 12: "greet" in `const msg = greet("world")`
    // Should jump to line 8 (0-indexed): `export function greet(...)`
    await assertDefinitionAt(session, uri, 12, 14, 8, "greet call → declaration");
  });

  it("go-to-definition on second function call works", async () => {
    const { uri } = await openFile(session, "src/navigation.ts");
    await new Promise((r) => setTimeout(r, 500));

    // Line 18 (0-indexed), char 12: "add" in `const sum = add(1, 2)`
    // Should jump to line 14 (0-indexed): `function add(...)`
    await assertDefinitionAt(session, uri, 18, 14, 14, "add call → declaration");
  });

  it("find-references includes both declaration and usage", async () => {
    const { uri } = await openFile(session, "src/navigation.ts");
    await new Promise((r) => setTimeout(r, 500));

    // Line 8, char 17: "greet" in function declaration
    const refs = await getReferences(session, uri, 8, 17);
    expect(refs.length, "greet should have at least 2 references").toBeGreaterThanOrEqual(2);

    const lines = refs.map((r) => r.range.start.line);
    expect(lines, "should include declaration line").toContain(8);
    expect(lines, "should include call line").toContain(12);
  });
});

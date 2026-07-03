/**
 * Regression tests for expression-position let:/yield: comprehensions.
 *
 * The underlying issue: TypeScript's parser can't insert ASI between a host
 * expression (`=>`, `return`, `export default`) and a following `let:` label.
 * Instead it parses the arrow body / export value as a bare `let` Identifier
 * and spills the rest of the comprehension into surrounding siblings via
 * error recovery.
 *
 * The fix lives in `packages/transformer/src/arrow-comprehension-preprocess.ts`
 * and the transformer-side flatten/simplify paths in
 * `packages/transformer/src/index.ts`.
 */
import { describe, it, expect } from "vitest";

// Register all macro packages — same pattern as tests/playground-examples.test.ts.
// PEP-050 Case-1: macro definitions live in the isolated `./macros` entry (the
// runtime `.` entry no longer registers them), so import the macros subpath.
import "@typesugar/macros";
import "@typesugar/std/macros";
import "@typesugar/effect";

import { transformCode } from "@typesugar/transformer";

const ARROW_FN_SOURCE = `
import { Effect } from "effect";
import "@typesugar/std/syntax/do";

const getUserWithPosts = (userId: string) =>
let: {
  user << Effect.succeed({ id: userId, name: "Alice" });
  _    << Effect.log(\`Found user: \${user.name}\`);
  posts << Effect.succeed([
    { id: "p1", title: "Hello World", authorId: userId },
    { id: "p2", title: "Effect is great", authorId: userId },
  ]);
}
yield: { ({ user, posts }) }

console.log(typeof getUserWithPosts);
`;

const RETURN_SOURCE = `
import { Effect } from "effect";
import "@typesugar/std/syntax/do";

function compute() {
  return
  let: {
    x << Effect.succeed(1);
    y << Effect.succeed(2);
  }
  yield: { x + y }
}
`;

const EXPORT_DEFAULT_SOURCE = `
import { Effect } from "effect";
import "@typesugar/std/syntax/do";

export default
let: {
  x << Effect.succeed(1);
  y << Effect.succeed(2);
}
yield: { x + y }
`;

const GENERATOR_SOURCE = `
import { Effect } from "effect";
import "@typesugar/std/syntax/do";

function* gen() {
  const r =
  let: {
    x << Effect.succeed(1);
  }
  yield: { x }
  yield r;
}
`;

const TOP_LEVEL_SOURCE = `
import { Effect } from "effect";
import "@typesugar/std/syntax/do";

const prog =
let: {
  x << Effect.succeed(1);
  y << Effect.succeed(2);
}
yield: { x + y }
`;

describe("let:/yield: in expression position", () => {
  describe("arrow body", () => {
    it("expands `(x) => let: {...} yield: {...}` into a proper Effect chain", async () => {
      const result = await transformCode(ARROW_FN_SOURCE, { fileName: "input.ts" });
      const out = result.code;

      expect(out).toMatch(/const getUserWithPosts\s*=\s*\(userId[^)]*\)\s*=>\s*Effect\.flatMap\(/);

      expect(out).not.toContain("let: {");
      expect(out).not.toContain("yield: {");
      expect(out).not.toMatch(/=>\s*let\s*,/);
      expect(out).not.toMatch(/^\s*<<\s+/m);

      expect(out).toContain("Effect.succeed");
      expect(out).toContain("Effect.flatMap");
      expect(out).toContain("Effect.map");

      const errors = (result.diagnostics ?? []).filter((d) => d.severity === "error");
      expect(errors, `Unexpected errors: ${JSON.stringify(errors)}`).toEqual([]);
    });

    it("does not emit TS9222 for the arrow-body case (it's not discarded)", async () => {
      const result = await transformCode(ARROW_FN_SOURCE, { fileName: "input.ts" });
      const ts9222 = (result.diagnostics ?? []).filter((d) => d.code === 9222);
      expect(ts9222).toEqual([]);
    });
  });

  describe("return + let:/yield:", () => {
    it("rewrites `return let: {...} yield: {...}` into `return <chain>`", async () => {
      const result = await transformCode(RETURN_SOURCE, { fileName: "input.ts" });
      const out = result.code;

      expect(out).toMatch(/return\s+Effect\.flatMap\(/);
      expect(out).not.toContain("let: {");
      expect(out).not.toContain("yield: {");

      const errors = (result.diagnostics ?? []).filter((d) => d.severity === "error");
      expect(errors, `Unexpected errors: ${JSON.stringify(errors)}`).toEqual([]);
    });
  });

  describe("export default + let:/yield:", () => {
    it("hoists to a top-level const and exports it", async () => {
      const result = await transformCode(EXPORT_DEFAULT_SOURCE, { fileName: "input.ts" });
      const out = result.code;

      expect(out).toMatch(/const __letyield_\d+\s*=\s*Effect\.flatMap\(/);
      expect(out).toMatch(/export default __letyield_\d+/);
      expect(out).not.toContain("let: {");
      expect(out).not.toContain("yield: {");

      const errors = (result.diagnostics ?? []).filter((d) => d.severity === "error");
      expect(errors, `Unexpected errors: ${JSON.stringify(errors)}`).toEqual([]);
    });
  });

  describe("TS9223 — yield: inside generator function", () => {
    it("emits TS9223 suggesting pure:/return:", async () => {
      const result = await transformCode(GENERATOR_SOURCE, { fileName: "input.ts" });
      const ts9223 = (result.diagnostics ?? []).filter((d) => d.code === 9223);
      expect(ts9223.length).toBeGreaterThanOrEqual(1);
      expect(ts9223[0].message).toMatch(/yield:.*cannot be used.*generator/i);
    });
  });

  describe("top-level const regression", () => {
    it("the existing `const x = let:/yield:` path still works", async () => {
      const result = await transformCode(TOP_LEVEL_SOURCE, { fileName: "input.ts" });
      const out = result.code;

      expect(out).toMatch(/const prog\s*=\s*Effect\.flatMap\(/);
      expect(out).not.toContain("let: {");
      expect(out).not.toContain("yield: {");

      const errors = (result.diagnostics ?? []).filter((d) => d.severity === "error");
      expect(errors, `Unexpected errors: ${JSON.stringify(errors)}`).toEqual([]);
    });
  });
});

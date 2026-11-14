/**
 * The do-notation activation import is erased once the comprehensions are
 * expanded (neverthrow case study F9). `import "@typesugar/std/syntax/do"`
 * only switches the `let:`/`par:` labels on for the transformer; left in the
 * output it made `@typesugar/std` a runtime dependency of every consumer that
 * used do-notation, and loaded std's own instances for nothing. An instance
 * the output does call (static style: Iterable, AsyncIterable) gets its own
 * named import, which stays.
 */
import { describe, it, expect } from "vitest";

import "@typesugar/macros";
import "@typesugar/std/macros";

import { transformCode } from "@typesugar/transformer";

const errors = (r: ReturnType<typeof transformCode>) =>
  r.diagnostics.filter((d) => d.severity === "error").map((d) => d.message);

describe("the syntax/do activation import is erased after expansion", () => {
  it("method-style (Array): no import of @typesugar/std remains", () => {
    const r = transformCode(
      `import "@typesugar/std/syntax/do";
export const xs = let: { x << [1, 2]; y << [x * 10]; } yield: x + y;
`,
      { fileName: "do-erase-array.ts" }
    );
    expect(errors(r)).toEqual([]);
    expect(r.code).toContain(".flatMap(");
    expect(r.code).not.toContain("@typesugar/std");
  });

  it("method-style (Promise, par:): no import of @typesugar/std remains", () => {
    const r = transformCode(
      `import "@typesugar/std/syntax/do";
declare function a(): Promise<number>;
declare function b(): Promise<number>;
export const p = par: { x << a(); y << b(); } yield: x + y;
`,
      { fileName: "do-erase-par.ts" }
    );
    expect(errors(r)).toEqual([]);
    expect(r.code).toContain("Promise.all");
    expect(r.code).not.toContain("@typesugar/std");
  });

  it("static style (Iterable): the side-effect import goes, the instance's named import stays", () => {
    const r = transformCode(
      `import "@typesugar/std/syntax/do";
declare const it: Iterable<number>;
export const ys = let: { x << it; } yield: x + 1;
`,
      { fileName: "do-erase-iterable.ts" }
    );
    expect(errors(r)).toEqual([]);
    expect(r.code).toMatch(/import \{ flatMapIterable \} from "@typesugar\/std[^"]*";/);
    expect(r.code).not.toMatch(/import "@typesugar\/std\/syntax\/do";/);
  });

  it("a file with no comprehension keeps the import as written (unchanged files are not reprinted)", () => {
    const code = `import "@typesugar/std/syntax/do";\nexport const n = 1;\n`;
    const r = transformCode(code, { fileName: "do-erase-untouched.ts" });
    expect(r.code).toContain(`import "@typesugar/std/syntax/do";`);
  });
});

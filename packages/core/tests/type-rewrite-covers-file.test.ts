/**
 * `typeRewriteEntryCoversFile` lives in @typesugar/core so transformer-core's
 * symbol-scoped @opaque erasure and the macros diagnostic-suppression rule
 * share ONE definition of "this file belongs to that entry" (previously two
 * hand-synchronised copies).
 */
import { describe, it, expect } from "vitest";
import { typeRewriteEntryCoversFile, type TypeRewriteEntry } from "../src/index.js";

const entry = (e: Partial<TypeRewriteEntry>): TypeRewriteEntry =>
  ({ typeName: "Option", underlyingTypeText: "A | null", ...e }) as TypeRewriteEntry;

describe("typeRewriteEntryCoversFile", () => {
  it("compares declarationFile exactly (ignoring extension and slashes)", () => {
    const e = entry({ declarationFile: "C:\\proj\\node_modules\\fp\\index.d.ts" });
    expect(typeRewriteEntryCoversFile("C:/proj/node_modules/fp/index.d.ts", e)).toBe(true);
    expect(typeRewriteEntryCoversFile("C:/proj/node_modules/fp/index.ts", e)).toBe(true);
    expect(typeRewriteEntryCoversFile("C:/proj/other/index.d.ts", e)).toBe(false);
  });

  it("matches a package subpath against the package's src/dist dirs", () => {
    const e = entry({ sourceModule: "@typesugar/fp/data/option" });
    expect(typeRewriteEntryCoversFile("/r/packages/fp/src/data/option.ts", e)).toBe(true);
    expect(
      typeRewriteEntryCoversFile("/r/node_modules/@typesugar/fp/dist/data/option.d.ts", e)
    ).toBe(true);
    expect(typeRewriteEntryCoversFile("/r/packages/fp/src/data/either.ts", e)).toBe(false);
  });

  it("compares an absolute sourceModule exactly and a relative one as a suffix", () => {
    expect(typeRewriteEntryCoversFile("/a/lib.ts", entry({ sourceModule: "/a/lib.ts" }))).toBe(
      true
    );
    expect(typeRewriteEntryCoversFile("/b/lib.ts", entry({ sourceModule: "/a/lib.ts" }))).toBe(
      false
    );
    expect(typeRewriteEntryCoversFile("/x/y/lib.ts", entry({ sourceModule: "./lib.js" }))).toBe(
      true
    );
  });

  it("an entry with neither declarationFile nor sourceModule covers nothing", () => {
    expect(typeRewriteEntryCoversFile("/a/b.ts", entry({}))).toBe(false);
  });
});

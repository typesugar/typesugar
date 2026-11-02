/**
 * deriveTagNames / parseDeriveList: the one parser for a `@derive` /
 * `@deriving` JSDoc tag's list. A tag's comment runs to the next tag, so prose
 * after the list must not add names (method sugar matched "Show" in the
 * description of a `@derive(Eq)` type and emitted a `Point.Show` that never
 * exists; the suppression rule took every word of the prose as a derive).
 */
import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import { deriveTagNames, parseDeriveList } from "../src/index.js";

function tagOf(doc: string): ts.JSDocTag {
  const sf = ts.createSourceFile("/x.ts", `${doc}\ninterface P {}`, ts.ScriptTarget.ES2022, true);
  const iface = sf.statements.find(ts.isInterfaceDeclaration)!;
  return ts.getJSDocTags(iface).find((t) => /^deriv/.test(t.tagName.text))!;
}

describe("deriveTagNames", () => {
  it("reads the parenthesized and the bare forms", () => {
    expect(deriveTagNames(tagOf(`/** @derive(Eq, Clone) */`))).toEqual(["Eq", "Clone"]);
    expect(deriveTagNames(tagOf(`/** @derive Eq, Clone */`))).toEqual(["Eq", "Clone"]);
    expect(deriveTagNames(tagOf(`/** @deriving (Show, Eq) */`))).toEqual(["Show", "Eq"]);
  });

  it("ignores prose after the list", () => {
    expect(
      deriveTagNames(tagOf(`/**\n * @derive(Eq)\n * Points compare by value; Show them.\n */`))
    ).toEqual(["Eq"]);
    expect(
      deriveTagNames(tagOf(`/**\n * @derive Eq, Ord\n * Ordered by id, then Show name.\n */`))
    ).toEqual(["Eq", "Ord"]);
  });

  it("is empty for an empty tag", () => {
    expect(parseDeriveList("")).toEqual([]);
    expect(parseDeriveList("   ")).toEqual([]);
  });
});

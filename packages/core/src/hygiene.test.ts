import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import { FileBindingCache } from "./hygiene.js";

function cacheFor(source: string): FileBindingCache {
  const sf = ts.createSourceFile("test.ts", source, ts.ScriptTarget.Latest, true);
  return new FileBindingCache(sf);
}

function printImports(cache: FileBindingCache): string[] {
  const printer = ts.createPrinter();
  const sf = ts.createSourceFile("out.ts", "", ts.ScriptTarget.Latest, false);
  return cache
    .getPendingImports()
    .map((imp) => printer.printNode(ts.EmitHint.Unspecified, imp, sf));
}

describe("FileBindingCache.ensureImport", () => {
  it("registers a plain pending import for a symbol not in scope (the PEP-033 2H MatchError case)", () => {
    // Source imports `match` (a macro that gets stripped) but NOT MatchError.
    const cache = cacheFor(`import { match } from "@typesugar/std";\n`);

    const ref = cache.ensureImport("MatchError", "@typesugar/std");
    expect(ref.text).toBe("MatchError"); // bare — no conflict to alias around

    const imports = printImports(cache);
    expect(imports).toContain(`import { MatchError } from "@typesugar/std";`);
    // plain specifier, not `MatchError as MatchError`
    expect(imports.join("\n")).not.toContain(" as ");
  });

  it("does not add an import when the symbol is already imported from the same module", () => {
    const cache = cacheFor(`import { MatchError } from "@typesugar/std";\n`);
    const ref = cache.ensureImport("MatchError", "@typesugar/std");
    expect(ref.text).toBe("MatchError");
    expect(cache.getPendingImports()).toHaveLength(0);
  });

  it("aliases when a local declaration would shadow the symbol", () => {
    const cache = cacheFor(`class MatchError {}\n`);
    const ref = cache.ensureImport("MatchError", "@typesugar/std");
    expect(ref.text).not.toBe("MatchError"); // aliased to avoid the local class
    const imports = printImports(cache);
    expect(imports.join("\n")).toContain(
      `import { MatchError as ${ref.text} } from "@typesugar/std";`
    );
  });

  it("returns a bare reference with no import for a known global", () => {
    const cache = cacheFor(``);
    const ref = cache.ensureImport("Error", "@typesugar/std");
    expect(ref.text).toBe("Error");
    expect(cache.getPendingImports()).toHaveLength(0);
  });

  it("dedupes repeated ensureImport calls for the same symbol", () => {
    const cache = cacheFor(``);
    cache.ensureImport("MatchError", "@typesugar/std");
    cache.ensureImport("MatchError", "@typesugar/std");
    const imports = printImports(cache);
    expect(imports).toHaveLength(1);
    expect(imports[0]).toBe(`import { MatchError } from "@typesugar/std";`);
  });
});

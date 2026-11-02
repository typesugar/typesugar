/**
 * Pre-merge review regressions (2026-11) for reference hygiene and the
 * macro registry.
 */
import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import { FileBindingCache } from "../src/hygiene.js";
import { createRegistry, defineLabeledBlockMacro } from "../src/registry.js";

function cacheFor(source: string): FileBindingCache {
  return new FileBindingCache(ts.createSourceFile("test.ts", source, ts.ScriptTarget.Latest, true));
}

function printImports(cache: FileBindingCache): string[] {
  const printer = ts.createPrinter();
  const sf = ts.createSourceFile("out.ts", "", ts.ScriptTarget.Latest, false);
  return cache
    .getPendingImports()
    .map((imp) => printer.printNode(ts.EmitHint.Unspecified, imp, sf));
}

describe("hygiene: a reused import shadowed by a nested binding", () => {
  // `import { Eq } from "m"; function f(Eq: number) { ... }` — a bare `Eq`
  // emitted inside `f` would resolve to the number parameter, not the import.
  const source = `
    import { Eq } from "m";
    export function f(Eq: number) { return Eq; }
  `;

  it("safeRef aliases instead of reusing the bare import name", () => {
    const cache = cacheFor(source);
    const ref = cache.safeRef("Eq", "m");
    expect(ref.text).not.toBe("Eq");
    expect(printImports(cache)).toEqual([`import { Eq as ${ref.text} } from "m";`]);

    // Execute: the emitted reference inside the shadowing scope reaches the import.
    const importedEq = { equals: (a: number, b: number) => a === b };
    const f = new Function(
      ref.text,
      `function f(Eq) { return ${ref.text}.equals(Eq, 1); } return f;`
    )(importedEq);
    expect(f(1)).toBe(true);
  });

  it("ensureImport aliases instead of reusing the bare import name", () => {
    const cache = cacheFor(source);
    const ref = cache.ensureImport("Eq", "m");
    expect(ref.text).not.toBe("Eq");
    expect(printImports(cache)).toEqual([`import { Eq as ${ref.text} } from "m";`]);
  });

  it("still reuses the bare import when nothing shadows it", () => {
    const cache = cacheFor(`import { Eq } from "m"; export const x = 1;`);
    expect(cache.safeRef("Eq", "m").text).toBe("Eq");
    expect(cache.ensureImport("Eq", "m").text).toBe("Eq");
    expect(printImports(cache)).toEqual([]);
  });
});

describe("registry: re-registering a labeled-block macro with an added label", () => {
  it("getAll lists the macro once", () => {
    const registry = createRegistry();
    const label = ["m1"];
    const macro = defineLabeledBlockMacro({ name: "multi", label, expand: () => [] });
    registry.register(macro);
    // The same definition object gains a label and is registered again
    // (e.g. a plugin extending its own macro's continuation labels).
    label.push("m2");
    registry.register(macro);
    expect(registry.getAll()).toEqual([macro]);
    expect(registry.getLabeledBlock("m2")).toBe(macro);
  });
});

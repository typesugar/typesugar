/**
 * Reference/introduced-name hygiene regressions (deep review 2026-10:
 * core #14, #15, #26, #28, #44).
 *
 * The emitted code is EXECUTED where the finding is about runtime behaviour
 * (a captured or dangling reference), not just grepped.
 */
import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import { FileBindingCache, HygieneContext } from "../src/hygiene.js";
import { MacroContextImpl } from "../src/context.js";

function sourceFor(source: string): ts.SourceFile {
  return ts.createSourceFile("test.ts", source, ts.ScriptTarget.Latest, true);
}

function cacheFor(source: string): FileBindingCache {
  return new FileBindingCache(sourceFor(source));
}

function printImports(cache: FileBindingCache): string[] {
  const printer = ts.createPrinter();
  const sf = ts.createSourceFile("out.ts", "", ts.ScriptTarget.Latest, false);
  return cache
    .getPendingImports()
    .map((imp) => printer.printNode(ts.EmitHint.Unspecified, imp, sf));
}

/** A MacroContextImpl over `source`, with its own hygiene context. */
function contextFor(source: string, hygiene = new HygieneContext()): MacroContextImpl {
  const sf = sourceFor(source);
  const host = ts.createCompilerHost({});
  const origGet = host.getSourceFile.bind(host);
  host.getSourceFile = (name, lang) => (name === "test.ts" ? sf : origGet(name, lang));
  const program = ts.createProgram(["test.ts"], { noLib: true, noResolve: true }, host);
  return new MacroContextImpl(
    program,
    program.getTypeChecker(),
    program.getSourceFile("test.ts") ?? sf,
    ts.factory,
    undefined as unknown as ts.TransformationContext,
    hygiene
  );
}

describe("core #14: reference hygiene sees nested bindings", () => {
  it("aliases a symbol that a function parameter shadows, so the call reaches the import", () => {
    // The user's `map` parameter must not capture the reference the macro emits.
    const cache = cacheFor(`
      export function f(map: Map<string, number>, o: unknown) {
        return o;
      }
    `);
    const ref = cache.ensureImport("map", "@typesugar/fp/data/option");
    expect(ref.text).not.toBe("map");
    expect(printImports(cache)).toEqual([
      `import { map as ${ref.text} } from "@typesugar/fp/data/option";`,
    ]);

    // Execute: the emitted call inside the shadowing scope reaches the import.
    const importedMap = (o: number, fn: (n: number) => number) => fn(o);
    const emitted = new Function(
      ref.text,
      `function f(map, o) { return ${ref.text}(o, (n) => n + map.size); } return f;`
    )(importedMap);
    expect(emitted(new Map([["a", 1]]), 41)).toBe(42);
  });

  it.each([
    ["a block-local const", `function g() { const map = 1; return map; }`],
    ["a catch binding", `try {} catch (map) {}`],
    ["a for-of binding", `for (const map of []) {}`],
    ["a destructured parameter", `const h = ({ map }: { map: number }) => map;`],
    ["a nested function declaration", `function outer() { function map() {} }`],
    ["a named function expression", `const k = function map() {};`],
    ["a class expression name", `const C = class map {};`],
  ])("treats %s as a conflict", (_label, src) => {
    const cache = cacheFor(src);
    expect(cache.ensureImport("map", "m").text).not.toBe("map");
    expect(cache.safeRef("map", "m").text).not.toBe("map");
  });
});

describe("core #15: type-only and default imports are not value imports of the name", () => {
  it.each([
    ["import type { Point }", `import type { Point } from "./point";`],
    ["import { type Point }", `import { type Point } from "./point";`],
    ["default import", `import Point from "./point";`],
  ])("%s → an aliased value import is registered", (_label, src) => {
    const cache = cacheFor(src);
    const ref = cache.ensureImport("Point", "./point");
    // A bare `Point` would reference an erased type import (ReferenceError at
    // runtime) or the default export. It must be a fresh value import, aliased
    // because `Point` is already bound in the file.
    expect(ref.text).not.toBe("Point");
    expect(printImports(cache)).toEqual([`import { Point as ${ref.text} } from "./point";`]);
  });

  it("an aliased import `{ Eq as Point }` is not the named export Point", () => {
    const cache = cacheFor(`import { Eq as Point } from "./point";`);
    const ref = cache.ensureImport("Point", "./point");
    expect(ref.text).not.toBe("Point");
    expect(cache.hasPendingImports()).toBe(true);
  });

  it("a plain value import of the same name is still reused bare", () => {
    const cache = cacheFor(`import { Point } from "./point";`);
    expect(cache.ensureImport("Point", "./point").text).toBe("Point");
    expect(cache.hasPendingImports()).toBe(false);
  });
});

describe("core #26: ensureImport never binds a name twice", () => {
  it("two modules wanting bare `map` get distinct bindings", () => {
    const cache = cacheFor(`export {};`);
    const a = cache.ensureImport("map", "@typesugar/fp/data/option");
    const b = cache.ensureImport("map", "@typesugar/fp/data/either");
    expect(a.text).not.toBe(b.text);
    const imports = printImports(cache);
    // The emitted module must load: no duplicate binding.
    const bound = imports.flatMap((i) =>
      [...i.matchAll(/(?:as (\w+)|\{ (\w+) \})/g)].map((m) => m[1] ?? m[2])
    );
    expect(new Set(bound).size).toBe(bound.length);
  });

  it.each([
    ["namespace import", `import * as Eq from "./x";`],
    ["import-equals", `import Eq = require("./x");`],
  ])("%s binding forces the alias path", (_label, src) => {
    const cache = cacheFor(src);
    const ref = cache.ensureImport("Eq", "@typesugar/std");
    expect(ref.text).not.toBe("Eq");
    expect(printImports(cache)).toEqual([`import { Eq as ${ref.text} } from "@typesugar/std";`]);
  });
});

describe("core #28: generateUniqueName is always fresh", () => {
  it("two calls with the same prefix inside one scope differ", () => {
    const ctx = contextFor(`export {};`);
    const [a, b] = ctx.hygiene.withScope(() => [
      ctx.generateUniqueName("tmp").text,
      ctx.generateUniqueName("tmp").text,
    ]);
    expect(a).not.toBe(b);
  });

  it("outside a scope it does not collide with hygiene.mangleName", () => {
    const ctx = contextFor(`export {};`);
    const a = ctx.generateUniqueName("v").text;
    const b = ctx.hygiene.mangleName("v");
    expect(a).not.toBe(b);
  });

  it("createIdentifier keeps its 'same scope, same name' memoisation", () => {
    const h = new HygieneContext();
    const [a, b] = h.withScope(() => [h.createIdentifier("x").text, h.createIdentifier("x").text]);
    expect(a).toBe(b);
  });
});

describe("core #44: tryShortName checks nested bindings", () => {
  it.each([
    ["a parameter", `function f(_x: number) { return _x; }`],
    ["a nested local", `function f() { const _x = 1; return _x; }`],
    ["a destructured top-level name", `const { _x } = { _x: 1 };`],
    ["a namespace", `namespace _x {}`],
    ["an import-equals", `import _x = require("y");`],
  ])("does not return a name bound by %s", (_label, src) => {
    const ctx = contextFor(src);
    expect(ctx.tryShortName("_x").text).not.toBe("_x");
  });

  it("returns the preferred name when nothing binds it", () => {
    const ctx = contextFor(`const y = 1;`);
    expect(ctx.tryShortName("_x").text).toBe("_x");
  });
});

describe("core #27: a module symbol named like a JS global is still imported", () => {
  it("ensureImport('File', './models') registers the import instead of returning the global", () => {
    const cache = cacheFor(`export {};`);
    const ref = cache.ensureImport("File", "./models");
    expect(ref.text).toBe("File");
    expect(printImports(cache)).toEqual([`import { File } from "./models";`]);
  });

  it("ensureImport aliases a global-named symbol when the file already binds that name", () => {
    const cache = cacheFor(`import { Map } from "immutable";`);
    const ref = cache.ensureImport("Map", "./models");
    expect(ref.text).not.toBe("Map");
    expect(printImports(cache)).toEqual([`import { Map as ${ref.text} } from "./models";`]);
  });

  it("safeRef does not hand back a bare global name the file shadows with an import", () => {
    const cache = cacheFor(`import { Map } from "immutable";`);
    expect(cache.safeRef("Map", "./models").text).not.toBe("Map");
    // Same module and plain value import → reuse is still fine.
    expect(cache.safeRef("Map", "immutable").text).toBe("Map");
  });

  it("safeRef does not hand back a bare global name a local declaration shadows", () => {
    const cache = cacheFor(`function f() { const Request = 1; return Request; }`);
    expect(cache.safeRef("Request", "./models").text).not.toBe("Request");
  });
});

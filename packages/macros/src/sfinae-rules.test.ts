import { describe, it, expect, beforeAll } from "vitest";
import * as ts from "typescript";
import { createMacroCallChainRule, createExtensionMethodCallRule } from "./sfinae-rules.js";
import { registerTypeclassMacros } from "./typeclass.js";
import { globalResolutionScope } from "@typesugar/core";

/**
 * Build an in-memory Program for `code` and return its semantic diagnostics.
 * `noLib`/`noResolve` keep it self-contained — the MacroCallChain rule walks the
 * AST by the `match` identifier name, so it does not need `@typesugar/std` to resolve.
 */
function diagnose(code: string) {
  const fileName = "t.ts";
  const sf = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true);
  const host: ts.CompilerHost = {
    getSourceFile: (fn) => (fn === fileName ? sf : undefined),
    getDefaultLibFileName: () => "lib.d.ts",
    writeFile: () => {},
    getCurrentDirectory: () => "",
    getCanonicalFileName: (fn) => fn,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (fn) => fn === fileName,
    readFile: (fn) => (fn === fileName ? code : undefined),
  };
  const program = ts.createProgram([fileName], { noLib: true, noResolve: true }, host);
  return { sf, checker: program.getTypeChecker(), diags: program.getSemanticDiagnostics(sf) };
}

describe("ExtensionMethodCall SFINAE rule — typeclass instance method sugar (PEP-033 N3)", () => {
  const rule = createExtensionMethodCallRule();

  beforeAll(() => {
    // Populate the typeclass registry so getTypeclassesForMethod("equals") finds Eq.
    registerTypeclassMacros();
  });

  function ts2339(code: string) {
    const { sf, checker, diags } = diagnose(code);
    return {
      sf,
      checker,
      diags: diags.filter(
        (d) =>
          d.code === 2339 &&
          /Property '([^']+)' does not exist/.test(
            typeof d.messageText === "string" ? d.messageText : d.messageText.messageText
          )
      ),
    };
  }

  it("suppresses TS2339 for `.equals` on a @derive(Eq)-decorated class", () => {
    const code = [
      `@derive(Eq)`,
      `class Point { constructor(public x: number) {} }`,
      `declare const p1: Point, p2: Point;`,
      `const r = p1.equals(p2);`,
    ].join("\n");
    const { sf, checker, diags } = ts2339(code);
    const equalsDiag = diags.find((d) =>
      (typeof d.messageText === "string" ? d.messageText : d.messageText.messageText).includes(
        "'equals'"
      )
    );
    expect(equalsDiag).toBeDefined();
    expect(rule.shouldSuppress(equalsDiag!, checker, sf)).toBe(true);
  });

  it("suppresses TS2339 for `.equals` on a JSDoc @derive(Eq) interface", () => {
    const code = [
      `/** @derive(Eq) */`,
      `interface User { id: number }`,
      `declare const u1: User, u2: User;`,
      `const r = u1.equals(u2);`,
    ].join("\n");
    const { sf, checker, diags } = ts2339(code);
    const equalsDiag = diags.find((d) =>
      (typeof d.messageText === "string" ? d.messageText : d.messageText.messageText).includes(
        "'equals'"
      )
    );
    expect(equalsDiag).toBeDefined();
    expect(rule.shouldSuppress(equalsDiag!, checker, sf)).toBe(true);
  });

  it("does NOT suppress `.equals` on a type that doesn't derive Eq", () => {
    const code = [
      `class Plain { constructor(public x: number) {} }`,
      `declare const p: Plain;`,
      `const r = p.equals(p);`,
    ].join("\n");
    const { sf, checker, diags } = ts2339(code);
    const equalsDiag = diags.find((d) =>
      (typeof d.messageText === "string" ? d.messageText : d.messageText.messageText).includes(
        "'equals'"
      )
    );
    expect(equalsDiag).toBeDefined();
    expect(rule.shouldSuppress(equalsDiag!, checker, sf)).toBe(false);
  });
});

describe("ExtensionMethodCall SFINAE rule — typeclass method sugar over primitives (PEP-052)", () => {
  const rule = createExtensionMethodCallRule();

  beforeAll(() => {
    registerTypeclassMacros();
  });

  function ts2339(code: string, fileName: string) {
    const fs2339Code = code;
    const sf = ts.createSourceFile(fileName, fs2339Code, ts.ScriptTarget.Latest, true);
    const host: ts.CompilerHost = {
      getSourceFile: (fn) => (fn === fileName ? sf : undefined),
      getDefaultLibFileName: () => "lib.d.ts",
      writeFile: () => {},
      getCurrentDirectory: () => "",
      getCanonicalFileName: (fn) => fn,
      useCaseSensitiveFileNames: () => true,
      getNewLine: () => "\n",
      fileExists: (fn) => fn === fileName,
      readFile: (fn) => (fn === fileName ? fs2339Code : undefined),
    };
    const program = ts.createProgram([fileName], { noLib: true, noResolve: true }, host);
    const diags = program
      .getSemanticDiagnostics(sf)
      .filter(
        (d) =>
          d.code === 2339 &&
          /Property '([^']+)' does not exist/.test(
            typeof d.messageText === "string" ? d.messageText : d.messageText.messageText
          )
      );
    return { sf, checker: program.getTypeChecker(), diags };
  }

  it("suppresses TS2339 for `.equals` on a number when Eq method syntax is activated", () => {
    const fileName = "primitive-eq-on.ts";
    globalResolutionScope.activateMethodSyntax(fileName, "Eq");

    const code = `declare const n: number;\nconst r = n.equals(5);`;
    const { sf, checker, diags } = ts2339(code, fileName);
    const equalsDiag = diags.find((d) =>
      (typeof d.messageText === "string" ? d.messageText : d.messageText.messageText).includes(
        "'equals'"
      )
    );
    expect(equalsDiag).toBeDefined();
    expect(rule.shouldSuppress(equalsDiag!, checker, sf)).toBe(true);
  });

  it("does NOT suppress `.equals` on a number without the Eq syntax-activation import", () => {
    const fileName = "primitive-eq-off.ts";
    // Deliberately not calling activateMethodSyntax — mirrors a file that
    // never imported @typesugar/std/syntax/eq.

    const code = `declare const n: number;\nconst r = n.equals(5);`;
    const { sf, checker, diags } = ts2339(code, fileName);
    const equalsDiag = diags.find((d) =>
      (typeof d.messageText === "string" ? d.messageText : d.messageText.messageText).includes(
        "'equals'"
      )
    );
    expect(equalsDiag).toBeDefined();
    expect(rule.shouldSuppress(equalsDiag!, checker, sf)).toBe(false);
  });
});

describe("MacroCallChain SFINAE rule — TS18004 (PEP-033 N2)", () => {
  const rule = createMacroCallChainRule();

  it("includes 18004 in its error codes", () => {
    expect(rule.errorCodes).toContain(18004);
  });

  it("suppresses TS18004 on pattern-binding shorthand inside a match() chain", () => {
    const code = [
      `declare function match(x: unknown): any;`,
      `type Shape = { kind: "circle"; r: number } | { kind: "square"; s: number };`,
      `function area(sh: Shape): number {`,
      `  return match(sh)`,
      `    .case({ kind: "circle", r }).then(Math.PI * r ** 2)`,
      `    .case({ kind: "square", s }).then(s ** 2)`,
      `    .else(0);`,
      `}`,
    ].join("\n");

    const { sf, checker, diags } = diagnose(code);
    const shorthand18004 = diags.filter((d) => d.code === 18004);
    expect(shorthand18004.length).toBeGreaterThan(0); // sanity: the source really triggers it
    for (const d of shorthand18004) {
      expect(rule.shouldSuppress(d, checker, sf)).toBe(true);
    }
  });

  it("does NOT suppress a genuine TS18004 outside any match chain", () => {
    const code = `const obj = { kind: "circle", r };`;
    const { sf, checker, diags } = diagnose(code);
    const shorthand18004 = diags.filter((d) => d.code === 18004);
    expect(shorthand18004.length).toBeGreaterThan(0);
    for (const d of shorthand18004) {
      expect(rule.shouldSuppress(d, checker, sf)).toBe(false);
    }
  });
});

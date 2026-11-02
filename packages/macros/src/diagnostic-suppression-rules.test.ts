import { describe, it, expect, beforeAll } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  createMacroCallChainRule,
  createExtensionMethodCallRule,
  createNewtypeAssignmentRule,
} from "./diagnostic-suppression-rules.js";
import { registerTypeclassMacros } from "./typeclass.js";
import { globalResolutionScope } from "@typesugar/core";

/**
 * Build an in-memory Program for `code` and return its semantic diagnostics.
 * `noLib`/`noResolve` keep it self-contained. The MacroCallChain rule accepts an
 * unresolvable `match` import when its specifier is `@typesugar/std`.
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

describe("ExtensionMethodCall diagnostic suppression rule — typeclass instance method sugar (PEP-033 N3)", () => {
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

describe("ExtensionMethodCall diagnostic suppression rule — typeclass method sugar over primitives (PEP-052)", () => {
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

describe("MacroCallChain diagnostic suppression rule — TS18004 (PEP-033 N2)", () => {
  const rule = createMacroCallChainRule();

  it("includes 18004 in its error codes", () => {
    expect(rule.errorCodes).toContain(18004);
  });

  it("suppresses TS18004 on pattern-binding shorthand inside a match() chain", () => {
    // noResolve: the import stays unresolved, so the rule decides by the
    // import specifier — as the transformer's name-and-import fallback does.
    const code = [
      `import { match } from "@typesugar/std";`,
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

  it("does NOT suppress TS18004 inside a chain whose match is a local function", () => {
    const code = [
      `declare function match(x: unknown): any;`,
      `type Shape = { kind: "circle"; r: number };`,
      `function area(sh: Shape): number {`,
      `  return match(sh).case({ kind: "circle", r }).then(r).else(0);`,
      `}`,
    ].join("\n");
    const { sf, checker, diags } = diagnose(code);
    const shorthand18004 = diags.filter((d) => d.code === 18004);
    expect(shorthand18004.length).toBeGreaterThan(0);
    for (const d of shorthand18004) {
      expect(rule.shouldSuppress(d, checker, sf)).toBe(false);
    }
  });
});

describe("NewtypeAssignment rule — no longer needed by @typesugar/type-system", () => {
  // The rule exists to hide a spurious TS2345 on `wrap<UserId>(42)` that the
  // OLD `UnwrapNewtype<T> = T extends Newtype<infer Base, string> ? Base : T`
  // produced. Since 6a99751a the real type reads a phantom `[__base]` slot, so
  // TypeScript itself accepts every constructor call: with NO suppression rule
  // registered there is nothing for the rule to hide, while real errors stay.
  const newtypeModule = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../type-system/src/newtype.ts"
  );
  const code = `
import { wrap, unwrap, newtypeCtor, validatedNewtype, type Newtype } from ${JSON.stringify(newtypeModule)};
type UserId = Newtype<number, "UserId">;
type Email = Newtype<string, "Email">;
export const a: UserId = wrap<UserId>(42);
const U = newtypeCtor<UserId>();
export const b: UserId = U(7);
const E = validatedNewtype<Email>((s) => s.includes("@"));
export const e: Email = E("a@b");
export const n: number = unwrap(a);
export const bad1: UserId = 42;
export const bad2 = U("x");
`;

  function check() {
    const fileName = path.join(path.dirname(newtypeModule), "__newtype_rule_probe__.ts");
    const options: ts.CompilerOptions = {
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      allowImportingTsExtensions: true,
    };
    const host = ts.createCompilerHost(options);
    const orig = { getSourceFile: host.getSourceFile, fileExists: host.fileExists };
    host.getSourceFile = (fn, lv, ...rest) =>
      fn === fileName
        ? ts.createSourceFile(fn, code, lv, true)
        : orig.getSourceFile.call(host, fn, lv, ...rest);
    host.fileExists = (fn) => fn === fileName || orig.fileExists.call(host, fn);
    const program = ts.createProgram([fileName], options, host);
    const sf = program.getSourceFile(fileName)!;
    const diags = ts.getPreEmitDiagnostics(program, sf);
    const line = (d: ts.Diagnostic) =>
      code.split("\n")[sf.getLineAndCharacterOfPosition(d.start!).line];
    return { diags, checker: program.getTypeChecker(), sf, line };
  }

  it("wrap / newtypeCtor / validatedNewtype type-check with no rule registered", () => {
    const { diags, line } = check();
    const summary = diags.map((d) => `TS${d.code}: ${line(d).trim()}`);
    // Exactly the two real errors, and no TS2345 on any constructor argument.
    expect(summary).toEqual([
      "TS2322: export const bad1: UserId = 42;",
      'TS2345: export const bad2 = U("x");',
    ]);
  });

  it("the rule would suppress nothing in that program", () => {
    const { diags, checker, sf } = check();
    const rule = createNewtypeAssignmentRule();
    expect(diags.filter((d) => rule.shouldSuppress(d, checker, sf))).toEqual([]);
  });
});

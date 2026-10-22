import { describe, it, expect, beforeAll } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  createMacroCallChainRule,
  createExtensionMethodCallRule,
  createMatchSwitchRule,
  createContractBlockRule,
  createComprehensionBlockRule,
} from "./diagnostic-suppression-rules.js";
import { registerTypeclassMacros } from "./typeclass.js";
import { globalResolutionScope } from "@typesugar/core";

/**
 * Build an in-memory Program for `code` and return its semantic diagnostics.
 * `noLib`/`noResolve` keep it self-contained. The MacroCallChain rule accepts an
 * unresolvable `match` import when its specifier is `@typesugar/std`.
 */
function diagnose(code: string, fileName = "t.ts") {
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
  return {
    sf,
    program,
    checker: program.getTypeChecker(),
    diags: program.getSemanticDiagnostics(sf),
  };
}

describe("ExtensionMethodCall diagnostic suppression rule — typeclass instance method sugar (PEP-033 N3)", () => {
  const rule = createExtensionMethodCallRule();

  beforeAll(() => {
    // Populate the typeclass registry so getTypeclassesForMethod("equals") finds Eq.
    registerTypeclassMacros();
    // The transformer rewrites `p.equals(q)` only where Eq method syntax is
    // activated (an `@typesugar/std/syntax/eq` import), so the rule does too.
    globalResolutionScope.activateMethodSyntax("t.ts", "Eq");
  });

  function ts2339(code: string, fileName?: string) {
    const { sf, checker, diags } = diagnose(code, fileName);
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

  it("does NOT suppress `.equals` on a @derive(Eq) type where Eq method syntax isn't activated", () => {
    // No `@typesugar/std/syntax/eq` import: the transformer leaves
    // `u1.equals(u2)` as written (a TypeError at run time), so the error stays.
    const code = [
      `/** @derive(Eq) */`,
      `interface User { id: number }`,
      `declare const u1: User, u2: User;`,
      `const r = u1.equals(u2);`,
    ].join("\n");
    const { sf, checker, diags } = ts2339(code, "derive-eq-not-activated.ts");
    const equalsDiag = diags.find((d) =>
      (typeof d.messageText === "string" ? d.messageText : d.messageText.messageText).includes(
        "'equals'"
      )
    );
    expect(equalsDiag).toBeDefined();
    expect(rule.shouldSuppress(equalsDiag!, checker, sf)).toBe(false);
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

describe("ExtensionMethodCall: method-syntax activation read from the program (typesugar check)", () => {
  // `typesugar check` filters diagnostics BEFORE it runs the transform, so
  // the global activation scope has no entry for the file yet; the rule
  // reads the activation from the file's imports as the transform does.
  const rule = createExtensionMethodCallRule();
  beforeAll(() => registerTypeclassMacros());

  function realProgram(code: string, name: string) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const fileName = path.join(here, `__${name}__.ts`);
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      skipLibCheck: true,
      types: [],
    };
    const host = ts.createCompilerHost(options);
    const readFile = host.readFile.bind(host);
    const fileExists = host.fileExists.bind(host);
    const getSourceFile = host.getSourceFile.bind(host);
    host.readFile = (f) => (f === fileName ? code : readFile(f));
    host.fileExists = (f) => f === fileName || fileExists(f);
    host.getSourceFile = (f, v, ...rest) =>
      f === fileName ? ts.createSourceFile(f, code, v, true) : getSourceFile(f, v, ...rest);
    const program = ts.createProgram([fileName], options, host);
    const sf = program.getSourceFile(fileName)!;
    const diags = program
      .getSemanticDiagnostics(sf)
      .filter(
        (d) =>
          d.code === 2339 && ts.flattenDiagnosticMessageText(d.messageText, "").includes("'equals'")
      );
    return { program, sf, checker: program.getTypeChecker(), diags };
  }

  const derived = [
    `/** @derive(Eq) */`,
    `interface P { x: number }`,
    `declare const p: P;`,
    `export const r = p.equals(p);`,
  ];

  it("suppresses with the activation import, nothing in the global scope", () => {
    const { program, sf, checker, diags } = realProgram(
      [`import "@typesugar/std/syntax/eq";`, ...derived].join("\n"),
      "activated-by-import"
    );
    expect(globalResolutionScope.isMethodSyntaxActivated(sf.fileName, "Eq")).toBe(false);
    expect(diags).toHaveLength(1);
    expect(rule.shouldSuppress(diags[0], checker, sf, { program })).toBe(true);
  });

  it("does not suppress without it", () => {
    const { program, sf, checker, diags } = realProgram(derived.join("\n"), "not-activated");
    expect(diags).toHaveLength(1);
    expect(rule.shouldSuppress(diags[0], checker, sf, { program })).toBe(false);
  });
});

describe("ExtensionMethodCall: a typeclass the file itself defines (typesugar check)", () => {
  // The rule mapped a method name to typeclasses through the standard
  // definitions only, so `.show()` for a `/** @typeclass */ interface Show`
  // declared in the file was a TS2339 under `typesugar check` (typeclass
  // package example), although the transform rewrites it.
  const rule = createExtensionMethodCallRule();
  beforeAll(() => registerTypeclassMacros());

  function realProgram(code: string, name: string) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const fileName = path.join(here, `__${name}__.ts`);
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      skipLibCheck: true,
      types: [],
    };
    const host = ts.createCompilerHost(options);
    const readFile = host.readFile.bind(host);
    const fileExists = host.fileExists.bind(host);
    const getSourceFile = host.getSourceFile.bind(host);
    host.readFile = (f) => (f === fileName ? code : readFile(f));
    host.fileExists = (f) => f === fileName || fileExists(f);
    host.getSourceFile = (f, v, ...rest) =>
      f === fileName ? ts.createSourceFile(f, code, v, true) : getSourceFile(f, v, ...rest);
    const program = ts.createProgram([fileName], options, host);
    const sf = program.getSourceFile(fileName)!;
    const diags = program
      .getSemanticDiagnostics(sf)
      .filter(
        (d) =>
          d.code === 2339 && ts.flattenDiagnosticMessageText(d.messageText, "").includes("'show'")
      );
    return { program, sf, checker: program.getTypeChecker(), diags };
  }

  const showTc = [`/** @typeclass */`, `interface Show<A> { show(a: A): string; }`];

  it("suppresses on a type deriving the file's own typeclass", () => {
    const { program, sf, checker, diags } = realProgram(
      [
        ...showTc,
        `/** @derive(Show) */`,
        `interface User { id: number }`,
        `declare const u: User;`,
        `export const r = u.show();`,
      ].join("\n"),
      "own-tc-derived"
    );
    expect(diags).toHaveLength(1);
    expect(rule.shouldSuppress(diags[0], checker, sf, { program })).toBe(true);
  });

  it("suppresses on a primitive with an @impl of the file's own typeclass", () => {
    const { program, sf, checker, diags } = realProgram(
      [
        ...showTc,
        `/** @impl Show<number> */`,
        `const numberShow: Show<number> = { show: (n) => String(n) };`,
        `const seven: number = 7;`,
        `export const r = seven.show();`,
      ].join("\n"),
      "own-tc-primitive"
    );
    expect(diags).toHaveLength(1);
    expect(rule.shouldSuppress(diags[0], checker, sf, { program })).toBe(true);
  });

  it("does not suppress when nothing provides it", () => {
    const { program, sf, checker, diags } = realProgram(
      [
        ...showTc,
        `interface User { id: number }`,
        `declare const u: User;`,
        `export const r = u.show();`,
      ].join("\n"),
      "own-tc-none"
    );
    expect(diags).toHaveLength(1);
    expect(rule.shouldSuppress(diags[0], checker, sf, { program })).toBe(false);
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
    return { sf, program, checker: program.getTypeChecker(), diags };
  }

  it("suppresses TS2339 for `.equals` on a number when Eq method syntax is activated and an Eq<number> is in scope", () => {
    const fileName = "primitive-eq-on.ts";
    globalResolutionScope.activateMethodSyntax(fileName, "Eq");

    const code = [
      `/** @impl Eq<number> */`,
      `const eqNum = { equals: (a: number, b: number) => a === b };`,
      `declare const n: number;`,
      `const r = n.equals(5);`,
      `const lit = (7).equals(7);`,
    ].join("\n");
    const { sf, checker, diags, program } = ts2339(code, fileName);
    const equalsDiags = diags.filter((d) =>
      (typeof d.messageText === "string" ? d.messageText : d.messageText.messageText).includes(
        "'equals'"
      )
    );
    expect(equalsDiags).toHaveLength(2);
    for (const d of equalsDiags) {
      expect(rule.shouldSuppress(d, checker, sf, { program })).toBe(true);
    }
  });

  it("does NOT suppress `.equals` on a number with Eq method syntax activated but no Eq<number> in scope", () => {
    // `import "@typesugar/std/syntax/eq"` without importing an instance: the
    // transformer finds none and leaves `n.equals(5)` as written, so `build`
    // emitted a TypeError at run time while `check` reported TS2339. The
    // rule now resolves the instance as the rewrite does.
    const fileName = "primitive-eq-no-instance.ts";
    globalResolutionScope.activateMethodSyntax(fileName, "Eq");

    const code = `declare const n: number;\nconst r = n.equals(5);`;
    const { sf, checker, diags, program } = ts2339(code, fileName);
    const equalsDiag = diags.find((d) =>
      (typeof d.messageText === "string" ? d.messageText : d.messageText.messageText).includes(
        "'equals'"
      )
    );
    expect(equalsDiag).toBeDefined();
    expect(rule.shouldSuppress(equalsDiag!, checker, sf, { program })).toBe(false);
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

describe("@typesugar/type-system newtypes need no diagnostic suppression", () => {
  // A NewtypeAssignment suppression rule used to hide a spurious TS2345 on
  // `wrap<UserId>(42)` that the OLD
  // `UnwrapNewtype<T> = T extends Newtype<infer Base, string> ? Base : T`
  // produced. Since 6a99751a the real type reads a phantom `[__base]` slot, so
  // TypeScript itself accepts every constructor call, and the rule was
  // removed (2026-10). With NO suppression rule registered, the real library
  // produces no spurious TS2345 and still reports the real errors.
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
    // Raw checker output: no suppression rule is consulted at all.
    const { diags, line } = check();
    const summary = diags.map((d) => `TS${d.code}: ${line(d).trim()}`);
    // Exactly the two real errors, and no TS2345 on any constructor argument.
    expect(summary).toEqual([
      "TS2322: export const bad1: UserId = 42;",
      'TS2345: export const bad2 = U("x");',
    ]);
  });
});

describe("MacroCallChain — 'possibly null' on a chain continued after a nullish arm (F20)", () => {
  // With the typed fluent chain in @typesugar/std (it used to be `never`), an
  // arm whose result may be null/undefined, followed by more arms, makes the
  // chain "possibly null" to the checker (the result type can't carry the
  // chain's methods on its nullish part). The macro consumes the chain, so
  // typesugar's own checks hide exactly that error, on that receiver.
  const rule = createMacroCallChainRule();
  const runtimeModule = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../std/src/macros/match-runtime.ts"
  );

  function check(code: string) {
    const fileName = path.join(path.dirname(runtimeModule), "__match_chain_probe__.ts");
    const full = `import { match } from "./match-runtime.js";\n${code}`;
    const options: ts.CompilerOptions = {
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      types: [],
    };
    const host = ts.createCompilerHost(options);
    const orig = { getSourceFile: host.getSourceFile, fileExists: host.fileExists };
    host.getSourceFile = (fn, lv, ...rest) =>
      fn === fileName
        ? ts.createSourceFile(fn, full, lv, true)
        : orig.getSourceFile.call(host, fn, lv, ...rest);
    host.fileExists = (fn) => fn === fileName || orig.fileExists.call(host, fn);
    const program = ts.createProgram([fileName], options, host);
    const sf = program.getSourceFile(fileName)!;
    return { sf, checker: program.getTypeChecker(), diags: program.getSemanticDiagnostics(sf) };
  }

  it("suppresses TS2531 on the receiver of the next .case()", () => {
    const { sf, checker, diags } = check(
      `declare const k: "a" | "b" | "c";\n` +
        `export const r = match(k).case("a").then(null).case("b").then(undefined).case("c").then(1);\n`
    );
    const nullish = diags.filter((d) => [2531, 2532, 2533, 18047, 18048, 18049].includes(d.code));
    expect(nullish.length).toBeGreaterThan(0); // sanity: the stub types really report it
    expect(rule.errorCodes).toEqual(expect.arrayContaining(nullish.map((d) => d.code)));
    for (const d of nullish) expect(rule.shouldSuppress(d, checker, sf)).toBe(true);
  });

  it("does NOT suppress a genuine 'possibly null' outside a match chain", () => {
    const { sf, checker, diags } = check(
      `declare const o: { case(): number } | null;\nexport const n = o.case();\n`
    );
    const nullish = diags.filter((d) => [2531, 18047].includes(d.code));
    expect(nullish.length).toBe(1);
    expect(rule.shouldSuppress(nullish[0], checker, sf)).toBe(false);
  });

  it("does NOT suppress 'possibly null' inside an arm's own result expression", () => {
    const { sf, checker, diags } = check(
      `declare const k: "a" | "b";\ndeclare const o: { n: number } | null;\n` +
        `export const r = match(k).case("a").then(o.n).else(0);\n`
    );
    const nullish = diags.filter((d) => [2531, 18047].includes(d.code));
    expect(nullish.length).toBe(1);
    expect(rule.shouldSuppress(nullish[0], checker, sf)).toBe(false);
  });
});

describe("MatchSwitch — names bound by a match: switch case (F21)", () => {
  const rule = createMatchSwitchRule();
  const markerDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../std/src/syntax"
  );

  function check(code: string, options: ts.CompilerOptions = {}) {
    const fileName = path.join(markerDir, "__match_switch_probe__.ts");
    const compilerOptions: ts.CompilerOptions = {
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      types: [],
      ...options,
    };
    const host = ts.createCompilerHost(compilerOptions);
    const orig = { getSourceFile: host.getSourceFile, fileExists: host.fileExists };
    host.getSourceFile = (fn, lv, ...rest) =>
      fn === fileName
        ? ts.createSourceFile(fn, code, lv, true)
        : orig.getSourceFile.call(host, fn, lv, ...rest);
    host.fileExists = (fn) => fn === fileName || orig.fileExists.call(host, fn);
    const program = ts.createProgram([fileName], compilerOptions, host);
    const sf = program.getSourceFile(fileName)!;
    const diags = program.getSemanticDiagnostics(sf);
    const suppressed = (d: ts.Diagnostic) =>
      rule.shouldSuppress(d, program.getTypeChecker(), sf, { program });
    const text = (d: ts.Diagnostic) => code.slice(d.start!, d.start! + d.length!);
    return { diags, suppressed, text };
  }

  const GEOMETRY = `type Geometry =
  | { type: "Point"; coordinates: number[] }
  | { type: "LineString"; coordinates: number[][] };
`;

  it("suppresses TS2304/TS18004 for a case's own bindings, in its pattern and statements", () => {
    const { diags, suppressed, text } = check(`import "./match.js";
${GEOMETRY}
export function f(geom: Geometry): number {
  match: switch (geom) {
    case { type: "Point", coordinates: [x, y] }:
      return x + y;
    case { type: "LineString", coordinates }:
      return coordinates.length;
  }
}
`);
    const binders = diags.filter((d) => d.code === 2304 || d.code === 18004);
    expect(binders.map(text).sort()).toEqual(["coordinates", "coordinates", "x", "x", "y", "y"]);
    for (const d of binders) expect(suppressed(d)).toBe(true);
  });

  it("does NOT suppress a name bound by a different case, or an unknown value case", () => {
    const { diags, suppressed, text } = check(`import "./match.js";
${GEOMETRY}
export function f(geom: Geometry): number {
  match: switch (geom) {
    case { type: "Point", coordinates: [x] }:
      return x;
    case { type: "LineString" }:
      return x;
    case typo:
      return 0;
  }
}
`);
    const reported = diags.filter((d) => d.code === 2304 && !suppressed(d)).map(text);
    expect(reported).toEqual(["x", "typo"]);
  });

  it("does NOT suppress anything in a file that doesn't activate match:", () => {
    const { diags, suppressed } = check(`${GEOMETRY}
export function f(geom: Geometry): number {
  match: switch (geom) {
    case { type: "Point", coordinates: [x] }:
      return x;
  }
  return 0;
}
`);
    const binders = diags.filter((d) => d.code === 2304);
    expect(binders.length).toBe(2);
    for (const d of binders) expect(suppressed(d)).toBe(false);
  });

  const SHAPE = `type Shape = { kind: "circle"; r: number } | { kind: "rect"; w: number; h: number };
`;

  it("suppresses TS2366 / TS7030 when the function ends in a match: switch every case of which returns", () => {
    const { diags, suppressed, text } = check(
      `import "./match.js";
${SHAPE}
export function area(s: Shape): number {
  match: switch (s) {
    case { kind: "circle", r }:
      return Math.PI * r * r;
    case { kind: "rect", w, h }: {
      if (w < 0) throw new Error("negative");
      return w * h;
    }
  }
}
export const arrow = (s: Shape): number => {
  match: switch (s) {
    case { kind: "circle", r }:
      return r;
    case { kind: "rect" }:
      throw new Error("not a circle");
  }
};
`
    );
    const fallsOff = diags.filter((d) => d.code === 2366);
    expect(fallsOff.map(text)).toEqual(["number", "number"]);
    for (const d of fallsOff) expect(suppressed(d)).toBe(true);

    // Without strictNullChecks, noImplicitReturns reports TS7030 instead.
    const loose = check(
      `import "./match.js";
${SHAPE}
export class C {
  name(s: Shape): string {
    match: switch (s) {
      case { kind: "circle" }:
      case { kind: "rect" }:
        return s.kind;
    }
  }
}
`,
      { strict: false, noImplicitReturns: true }
    );
    const notAll = loose.diags.filter((d) => d.code === 7030);
    expect(notAll.map(loose.text)).toEqual(["string"]);
    expect(loose.suppressed(notAll[0])).toBe(true);
  });

  it("does NOT suppress TS2366 when the match: switch can complete: a break, a case that falls off, code after it", () => {
    const { diags, suppressed } = check(`import "./match.js";
${SHAPE}
export function brk(s: Shape): number {
  match: switch (s) {
    case { kind: "circle", r }:
      if (r > 1) break;
      return r;
    case { kind: "rect", w }:
      return w;
  }
}
export function labelled(s: Shape): number {
  match: switch (s) {
    case { kind: "circle", r }:
      for (;;) {
        if (r > 1) break match;
        return r;
      }
    case { kind: "rect", w }:
      return w;
  }
}
export function fallsOff(s: Shape): number {
  match: switch (s) {
    case { kind: "circle", r }:
      return r;
    case { kind: "rect", w }:
      console.log(w);
  }
}
export function nested(s: Shape, c: boolean): number {
  if (c) {
    match: switch (s) {
      case { kind: "circle", r }:
        return r;
      case { kind: "rect", w }:
        return w;
    }
  } else return 0;
}
`);
    const fallsOff = diags.filter((d) => d.code === 2366);
    expect(fallsOff.length).toBe(4);
    for (const d of fallsOff) expect(suppressed(d)).toBe(false);
  });

  it("does NOT suppress TS2366 in a file that doesn't activate match:", () => {
    const { diags, suppressed } = check(`${SHAPE}
export function area(s: Shape): number {
  match: switch (s) {
    case { kind: "circle", r }:
      return r;
    case { kind: "rect", w }:
      return w;
  }
}
`);
    const fallsOff = diags.filter((d) => d.code === 2366);
    expect(fallsOff.length).toBe(1);
    expect(suppressed(fallsOff[0])).toBe(false);
  });

  it("suppresses TS7028 (unused label) on the match label only", () => {
    const { diags, suppressed, text } = check(
      `import "./match.js";
export function f(t: "a" | "b"): number {
  match: switch (t) {
    case "a":
      return 1;
    case "b":
      return 2;
  }
}
export function g(): void {
  other: switch (1) {
    case 1:
      break;
  }
}
`,
      { allowUnusedLabels: false }
    );
    const unused = diags.filter((d) => d.code === 7028);
    expect(unused.map(text)).toEqual(["match", "other"]);
    expect(unused.map(suppressed)).toEqual([true, false]);
  });
});

describe("ContractBlock diagnostic suppression rule (contracts' requires:/ensures: labels)", () => {
  // The contracts guide writes `ensures: { result >= 0; }` (an implicit
  // `result`) and `ensures: (result) => { ... }`. The macro binds both, but
  // `typesugar check` and the IDE reported TS2304 "Cannot find name 'result'"
  // and TS7006 "Parameter 'result' implicitly has an 'any' type".
  const rule = createContractBlockRule();

  function realProgram(code: string, name: string) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const fileName = path.join(here, `__${name}__.ts`);
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      skipLibCheck: true,
      types: [],
    };
    const host = ts.createCompilerHost(options);
    const readFile = host.readFile.bind(host);
    const fileExists = host.fileExists.bind(host);
    const getSourceFile = host.getSourceFile.bind(host);
    host.readFile = (f) => (f === fileName ? code : readFile(f));
    host.fileExists = (f) => f === fileName || fileExists(f);
    host.getSourceFile = (f, v, ...rest) =>
      f === fileName ? ts.createSourceFile(f, code, v, true) : getSourceFile(f, v, ...rest);
    const program = ts.createProgram([fileName], options, host);
    const sf = program.getSourceFile(fileName)!;
    const diags = program
      .getSemanticDiagnostics(sf)
      .filter((d) => d.code === 2304 || d.code === 7006);
    return { program, sf, checker: program.getTypeChecker(), diags };
  }

  const body = [
    `export function abs(n: number): number {`,
    `  ensures: { result >= 0; }`,
    `  return n < 0 ? -n : n;`,
    `}`,
    `export function dbl(n: number): number {`,
    `  ensures: (r) => { r === n * 2; }`,
    `  return n * 2;`,
    `}`,
  ];

  it("suppresses the implicit result and the arrow's parameter when contracts syntax is active", () => {
    const { program, sf, checker, diags } = realProgram(
      [`import "@typesugar/contracts/syntax";`, ...body].join("\n"),
      "contract-active"
    );
    expect(diags.map((d) => d.code).sort()).toEqual([2304, 7006]);
    for (const d of diags) expect(rule.shouldSuppress(d, checker, sf, { program })).toBe(true);
  });

  it("suppresses nothing without the activation import", () => {
    const { program, sf, checker, diags } = realProgram(body.join("\n"), "contract-inactive");
    expect(diags).toHaveLength(2);
    for (const d of diags) expect(rule.shouldSuppress(d, checker, sf, { program })).toBe(false);
  });

  it("does not suppress another unknown name in an ensures block, or result outside one", () => {
    const { program, sf, checker, diags } = realProgram(
      [
        `import "@typesugar/contracts/syntax";`,
        `export function f(n: number): number {`,
        `  ensures: { result >= missing; }`,
        `  return result;`,
        `}`,
      ].join("\n"),
      "contract-real-errors"
    );
    const flagged = diags.map((d) => ({
      text: sf.text.slice(d.start!, d.start! + d.length!),
      suppressed: rule.shouldSuppress(d, checker, sf, { program }),
    }));
    expect(flagged).toEqual([
      { text: "result", suppressed: true },
      { text: "missing", suppressed: false },
      { text: "result", suppressed: false },
    ]);
  });
});

describe("ExtensionMethodCall: a generic method of an imported extension object (EffectExt)", () => {
  // `Effect.succeed(21).map(f)` with `import { EffectExt }` is rewritten to
  // `EffectExt.map(eff, f)`, but the rule matched the receiver against the
  // generic first parameter (`Effect<A, E, R>`) with plain assignability,
  // which is false while A/E/R are unbound, so `typesugar check` kept
  // TS2339; and the callback's parameter, with no contextual type, was
  // TS7006. The transformer erases the type parameters to their constraints
  // (receiverMatchesFirstParam); the rule now does the same.
  const rule = createExtensionMethodCallRule();
  const callbackRule = rule;

  function program(files: Record<string, string>) {
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
      noLib: true,
      types: [],
    };
    const host: ts.CompilerHost = {
      getSourceFile: (name, lv) =>
        name in files ? ts.createSourceFile(name, files[name], lv, true) : undefined,
      getDefaultLibFileName: () => "/lib.d.ts",
      writeFile: () => {},
      getCurrentDirectory: () => "/",
      getDirectories: () => [],
      fileExists: (f) => f in files,
      readFile: (f) => files[f],
      getCanonicalFileName: (f) => f,
      useCaseSensitiveFileNames: () => true,
      getNewLine: () => "\n",
    };
    const p = ts.createProgram(Object.keys(files), options, host);
    const sf = p.getSourceFile("/main.ts")!;
    return { program: p, sf, checker: p.getTypeChecker(), diags: p.getSemanticDiagnostics(sf) };
  }

  const LIB = `
    interface Array<T> { length: number }
    interface Boolean {} interface Function {} interface IArguments {} interface Number {}
    interface Object {} interface RegExp {} interface String {} interface CallableFunction {}
    interface NewableFunction {}
  `;
  const EXT = `
    export interface Box<A> { readonly value: A }
    export const BoxExt = {
      map<A, B>(self: Box<A>, f: (a: A) => B): Box<B> { return { value: f(self.value) }; },
    };
  `;

  it("suppresses TS2339 and the callback's TS7006 with the object imported", () => {
    const {
      program: p,
      sf,
      checker,
      diags,
    } = program({
      "/lib.d.ts": LIB,
      "/ext.ts": EXT,
      "/main.ts": `
        import { BoxExt, type Box } from "./ext";
        declare const b: Box<number>;
        export const r = b.map((x) => x + 1);
      `,
    });
    const codes = diags.map((d) => d.code).sort();
    expect(codes).toEqual([2339, 7006]);
    const d2339 = diags.find((d) => d.code === 2339)!;
    const d7006 = diags.find((d) => d.code === 7006)!;
    expect(rule.shouldSuppress(d2339, checker, sf, { program: p })).toBe(true);
    expect(callbackRule.shouldSuppress(d7006, checker, sf, { program: p })).toBe(true);
  });

  it("suppresses neither without the import", () => {
    const {
      program: p,
      sf,
      checker,
      diags,
    } = program({
      "/lib.d.ts": LIB,
      "/ext.ts": EXT,
      "/main.ts": `
        import type { Box } from "./ext";
        declare const b: Box<number>;
        export const r = b.map((x) => x + 1);
      `,
    });
    const d2339 = diags.find((d) => d.code === 2339)!;
    const d7006 = diags.find((d) => d.code === 7006)!;
    expect(rule.shouldSuppress(d2339, checker, sf, { program: p })).toBe(false);
    expect(callbackRule.shouldSuppress(d7006, checker, sf, { program: p })).toBe(false);
  });

  it("does not suppress TS7006 for a callback of an ordinary unknown method", () => {
    const {
      program: p,
      sf,
      checker,
      diags,
    } = program({
      "/lib.d.ts": LIB,
      "/ext.ts": EXT,
      "/main.ts": `
        import { BoxExt, type Box } from "./ext";
        declare const b: Box<number>;
        export const r = b.nope((x) => x + 1);
      `,
    });
    const d7006 = diags.find((d) => d.code === 7006)!;
    expect(callbackRule.shouldSuppress(d7006, checker, sf, { program: p })).toBe(false);
  });
});

describe("ComprehensionBlock — do-notation's own syntax before expansion (let:/par:/yield:)", () => {
  // `typesugar check` and `build` type-check the source as written, where a
  // comprehension is not valid TypeScript: they reported TS1214 on the
  // `let`/`yield` labels, TS2304 on every bound name and TS2363 on every
  // `a << e` bind, and `build` exited 1 although its output was right.
  const rule = createComprehensionBlockRule();
  const markerDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../std/src/syntax"
  );

  function check(code: string, options: ts.CompilerOptions = {}) {
    const fileName = path.join(markerDir, "__comprehension_probe__.ts");
    const compilerOptions: ts.CompilerOptions = {
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      types: [],
      ...options,
    };
    const host = ts.createCompilerHost(compilerOptions);
    const orig = { getSourceFile: host.getSourceFile, fileExists: host.fileExists };
    host.getSourceFile = (fn, lv, ...rest) =>
      fn === fileName
        ? ts.createSourceFile(fn, code, lv, true)
        : orig.getSourceFile.call(host, fn, lv, ...rest);
    host.fileExists = (fn) => fn === fileName || orig.fileExists.call(host, fn);
    const program = ts.createProgram([fileName], compilerOptions, host);
    const sf = program.getSourceFile(fileName)!;
    const diags = program.getSemanticDiagnostics(sf);
    const suppressed = (d: ts.Diagnostic) =>
      rule.errorCodes.includes(d.code) &&
      rule.shouldSuppress(d, program.getTypeChecker(), sf, { program });
    const text = (d: ts.Diagnostic) => code.slice(d.start!, d.start! + d.length!);
    const reported = () => diags.filter((d) => !suppressed(d)).map(text);
    return { diags, suppressed, text, reported };
  }

  const DECLS = `declare function fetchUser(id: number): Promise<{ id: number; name: string }>;
declare function fetchAge(name: string): Promise<number>;
declare function fallback(): Promise<number>;
`;

  const CLEAN = `${DECLS}
export function f(id: number) {
  let: {
    user << fetchUser(id);
    age << fetchAge(user.name) || fallback();
    _ << fetchAge("x");
    label = \`\${user.name}:\${age}\`;
    if (age > 0) {}
    par: {
      a << fetchAge(label);
      b << fetchAge(user.name);
    }
    c << fetchAge(label) ?? fallback();
  }
  yield: ({ user, age, label, a, b, c });
}
export function g() {
  par: { x << fetchUser(1); y << fetchUser(2); }
  yield: x.name + y.name;
}
export function h() {
  seq: { x << fetchUser(1); }
  pure: { x }
}
let: { top << fetchUser(3); }
yield: top.id;
`;

  it("suppresses everything the comprehension syntax itself causes, in every step form", () => {
    const { diags, reported } = check(`import "./do.js";\n${CLEAN}`, { allowUnusedLabels: false });
    // The syntax does cause these (the test would pass vacuously otherwise),
    // and `c << e ?? fallback()` is TS2869 (TypeScript 5.6+: `<<` is a number,
    // never nullish).
    const codes = new Set(diags.map((d) => d.code));
    for (const c of [1214, 2304, 2363, 2869, 7028, 18004]) expect(codes).toContain(c);
    expect(reported()).toEqual([]);
  });

  it("does NOT suppress anything in a file that doesn't activate the labels", () => {
    const { diags, reported } = check(CLEAN);
    expect(diags.length).toBeGreaterThan(0);
    expect(reported().length).toBe(diags.length);
  });

  it("still reports a real error inside a step: unknown names, wrong argument types, scope", () => {
    const { reported } = check(`import "./do.js";
${DECLS}
export function f(id: number) {
  let: {
    user << fetchUsr(id);
    age << fetchAge(42);
    posts << fetchAge(usr.name);
    early << fetchAge(late);
    late << fetchAge("x");
    par: {
      p << fetchAge("p");
      q << fetchAge(p);
    }
  }
  yield: ({ user, nope });
}
export const outside = user;
`);
    // q's use of p is a TS9xxx from the macro (par: binds are independent);
    // TypeScript's TS2304 on it is a real one too, so it stays.
    expect(reported()).toEqual(["fetchUsr", "42", "usr", "late", "p", "nope", "user"]);
  });

  it("a bound name that also names an outer declaration is checked as the binding, not as it", () => {
    // \`name\` and \`top\` are DOM globals (\`void\`, \`Window\`); \`count\` an outer const.
    const { diags, reported } = check(`import "./do.js";
declare function fetchName(): Promise<string>;
declare function fetchUser(id: number): Promise<{ id: number }>;
const count = 3;
export function f() {
  let: {
    name << fetchName();
    count = name.length;
    top << fetchUser(count);
    upper << Promise.resolve(name.toUpperCase());
  }
  yield: name.trim() + count.toFixed(0) + upper + top!.id;
}
export const after = name.length + top.length;
`);
    const codes = new Set(diags.map((d) => d.code));
    for (const c of [2339, 2362, 2588]) expect(codes).toContain(c);
    // Outside the comprehension they are the globals: still reported.
    expect(reported()).toEqual(["length", "top"]);
  });

  it("suppresses TS2304 on the expression-position preprocessor's __letyield_N tag, right after the comprehension only", () => {
    // The text arrow-comprehension-preprocess.ts serves for
    // \`(id) => let: {...} yield: ...\` and \`const r = let: {...}\`.
    const { diags, reported } = check(`import "./do.js";
${DECLS}
export const g = (id: number) => {
  let: { user << fetchUser(id); }
  yield: user.name;
  return __letyield_0;
};
let: { a << fetchAge("a"); }
export const r = __letyield_1;
export const elsewhere = __letyield_2;
`);
    expect(diags.filter((d) => d.code === 2304).length).toBeGreaterThan(2);
    expect(reported()).toEqual(["__letyield_2"]);
  });

  it("reports an ordinary label, and a comprehension label not on a block", () => {
    const { reported } = check(
      `import "./do.js";
export function f(): void {
  other: for (;;) { break; }
  seq: while (false) {}
}
`,
      { allowUnusedLabels: false }
    );
    expect(reported()).toEqual(["other", "seq"]);
  });
});

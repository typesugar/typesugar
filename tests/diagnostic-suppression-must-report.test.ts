/**
 * "Must still report" tests for the built-in diagnostic suppression rules.
 *
 * A suppression rule may only hide a diagnostic when typesugar will actually
 * make that code valid. Each case below is a real TypeScript error the rules
 * used to hide (deep-review macros-other #9, #10, #17, #18), next to the
 * narrower case each rule still legitimately suppresses. Every case is built
 * on a real ts.Program and real checker diagnostics.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as ts from "typescript";
import {
  clearDiagnosticSuppressionRules,
  registerDiagnosticSuppressionRule,
  filterDiagnostics,
  registerTypeRewrite,
  clearTypeRewrites,
  type DiagnosticSuppressionRule,
} from "@typesugar/core";
import {
  createMacroCallChainRule,
  createNewtypeAssignmentRule,
  createOperatorOverloadRule,
  createTypeRewriteAssignmentRule,
} from "@typesugar/macros";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createProgram(
  files: Record<string, string>,
  extraOptions: ts.CompilerOptions = {}
): { program: ts.Program; checker: ts.TypeChecker; diagnostics: readonly ts.Diagnostic[] } {
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    ...extraOptions,
  };
  const fileMap = new Map(Object.entries(files));
  const dirs = new Set<string>();
  for (const name of fileMap.keys()) {
    for (let d = name.slice(0, name.lastIndexOf("/")); d; d = d.slice(0, d.lastIndexOf("/"))) {
      dirs.add(d);
    }
  }

  const host = ts.createCompilerHost(compilerOptions);
  const origGetSourceFile = host.getSourceFile;
  const origFileExists = host.fileExists;
  const origReadFile = host.readFile;
  const origDirectoryExists = host.directoryExists?.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError) => {
    const content = fileMap.get(fileName);
    if (content !== undefined) return ts.createSourceFile(fileName, content, languageVersion, true);
    return origGetSourceFile.call(host, fileName, languageVersion, onError);
  };
  host.fileExists = (fileName) => fileMap.has(fileName) || origFileExists.call(host, fileName);
  host.readFile = (fileName) => fileMap.get(fileName) ?? origReadFile.call(host, fileName);
  host.directoryExists = (dir) => dirs.has(dir) || (origDirectoryExists?.(dir) ?? false);

  const roots = [...fileMap.keys()].filter((f) => !f.includes("/node_modules/"));
  const program = ts.createProgram(roots, compilerOptions, host);
  return {
    program,
    checker: program.getTypeChecker(),
    diagnostics: ts.getPreEmitDiagnostics(program),
  };
}

function messageOf(d: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(d.messageText, "\n");
}

/** Run `rule` over the file's diagnostics with `code`; return [raw, kept]. */
function runRule(
  rule: DiagnosticSuppressionRule,
  files: Record<string, string>,
  code: number,
  fileName = "/test.ts",
  extraOptions?: ts.CompilerOptions
): { raw: ts.Diagnostic[]; kept: ts.Diagnostic[] } {
  clearDiagnosticSuppressionRules();
  registerDiagnosticSuppressionRule(rule);
  const { program, checker, diagnostics } = createProgram(files, extraOptions);
  const raw = diagnostics.filter((d) => d.file?.fileName === fileName && d.code === code);
  const kept = filterDiagnostics(raw, checker, (f) => program.getSourceFile(f), { program });
  return { raw, kept };
}

/** Text of the source line a diagnostic points at. */
function lineOf(d: ts.Diagnostic): string {
  const sf = d.file!;
  const { line } = sf.getLineAndCharacterOfPosition(d.start!);
  return sf.text.split("\n")[line].trim();
}

afterEach(() => {
  clearDiagnosticSuppressionRules();
  clearTypeRewrites();
});

// ---------------------------------------------------------------------------
// NewtypeAssignment (#9)
// ---------------------------------------------------------------------------

const NEWTYPE_LIB = `
declare const __brand: unique symbol;
type Newtype<Base, Brand extends string> = Base & { readonly [__brand]: Brand };
type UnwrapNewtype<T> = T extends Newtype<infer Base, string> ? Base : T;
declare function wrap<T>(value: UnwrapNewtype<T>): T;
declare function newtypeCtor<T>(): (value: UnwrapNewtype<T>) => T;
type UserId = Newtype<number, "UserId">;
type Meters = Newtype<number, "Meters">;
type Feet = Newtype<number, "Feet">;
`;

describe("NewtypeAssignment — must still report (deep-review macros-other #9)", () => {
  const rule = () => createNewtypeAssignmentRule();

  it("reports getUser(42) — passing a raw number where a UserId is required", () => {
    const { raw, kept } = runRule(
      rule(),
      { "/test.ts": `${NEWTYPE_LIB}\nfunction getUser(id: UserId): void {}\ngetUser(42);\n` },
      2345
    );
    expect(raw.length).toBe(1);
    expect(kept).toHaveLength(1);
  });

  it("reports const id: UserId = 42", () => {
    const { raw, kept } = runRule(
      rule(),
      { "/test.ts": `${NEWTYPE_LIB}\nconst id: UserId = 42;\n` },
      2322
    );
    expect(raw.length).toBe(1);
    expect(kept).toHaveLength(1);
  });

  it("reports a Feet passed where Meters is required, while hiding wrap()'s spurious error", () => {
    const { raw, kept } = runRule(
      rule(),
      {
        "/test.ts": `${NEWTYPE_LIB}
function area(w: Meters, h: Meters): number { return 0; }
area(wrap<Meters>(10), wrap<Feet>(5));
`,
      },
      2345
    );
    // raw: wrap<Meters>(10)'s arg, wrap<Feet>(5)'s arg, and the Feet → Meters argument.
    expect(raw.length).toBe(3);
    expect(kept).toHaveLength(1);
    expect(messageOf(kept[0])).toContain('"Feet"');
  });

  it("reports a user's own string-keyed __brand type (not a typesugar Newtype)", () => {
    const { raw, kept } = runRule(
      rule(),
      {
        "/test.ts": `
type Token = string & { readonly __brand: "Token" };
function use(t: Token): void {}
use("abc");
`,
      },
      2345
    );
    expect(raw.length).toBe(1);
    expect(kept).toHaveLength(1);
  });

  it("reports wrap<UserId>() of the wrong base type and re-wrapping another newtype", () => {
    const { raw, kept } = runRule(
      rule(),
      {
        "/test.ts": `${NEWTYPE_LIB}
declare const feet: Feet;
const a = wrap<UserId>("not a number");
const b = wrap<Meters>(feet);
`,
      },
      2345
    );
    expect(raw.length).toBe(2);
    expect(kept).toHaveLength(2);
  });

  it("still suppresses wrap<UserId>(42) and a newtypeCtor constructor call", () => {
    const { raw, kept } = runRule(
      rule(),
      {
        "/test.ts": `${NEWTYPE_LIB}
const id = wrap<UserId>(42);
const mkUserId = newtypeCtor<UserId>();
const id2 = mkUserId(7);
`,
      },
      2345
    );
    expect(raw.length).toBe(2);
    expect(kept).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// OperatorOverload (#10)
// ---------------------------------------------------------------------------

const NUMERIC_TC = `
/** @typeclass */
interface Numeric<A> {
  /** @op + */ add(a: A, b: A): A;
  /** @op > */ gt(a: A, b: A): boolean;
}
`;

describe("OperatorOverload — must still report (deep-review macros-other #10)", () => {
  it("reports operators on object types with no @op typeclass in scope", () => {
    const { raw, kept } = runRule(
      createOperatorOverloadRule(),
      {
        "/test.ts": `
interface Money { amount: number }
declare const m: Money;
export const a = m + 1;
export const b = m > 5;
export const c = [1, 2] + 3;
export const e = { n: 1 } + { n: 2 };
`,
      },
      2365
    );
    expect(raw.length).toBe(4);
    expect(kept).toHaveLength(4);
  });

  it("reports an operator on a type with no instance even when the typeclass is active", () => {
    const { raw, kept } = runRule(
      createOperatorOverloadRule(),
      {
        "/test.ts": `${NUMERIC_TC}
interface Vec3 { x: number; y: number; z: number }
declare const a: Vec3;
declare const b: Vec3;
export const c = a + b;
export const d = [1, 2] + 3;
`,
      },
      2365
    );
    expect(raw.length).toBe(2);
    expect(kept).toHaveLength(2);
  });

  it("suppresses an operator the transformer rewrites (typeclass + instance in scope)", () => {
    const { raw, kept } = runRule(
      createOperatorOverloadRule(),
      {
        "/test.ts": `${NUMERIC_TC}
interface Point { x: number; y: number }
/** @impl Numeric<Point> */
const numericPoint: Numeric<Point> = {
  add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y }),
  gt: (a, b) => a.x > b.x,
};
declare const p: Point;
declare const q: Point;
export const sum = p + q;
export const bad = 1 + p;
`,
      },
      2365
    );
    expect(raw.length).toBe(2);
    // `1 + p` has a primitive LEFT operand: the transformer leaves it alone.
    expect(kept.map(lineOf)).toEqual(["export const bad = 1 + p;"]);
  });

  it("suppresses nothing when the caller does not pass the program", () => {
    clearDiagnosticSuppressionRules();
    registerDiagnosticSuppressionRule(createOperatorOverloadRule());
    const { program, checker, diagnostics } = createProgram({
      "/test.ts": `${NUMERIC_TC}
interface Point { x: number; y: number }
/** @impl Numeric<Point> */
const numericPoint: Numeric<Point> = { add: (a, b) => a, gt: () => true };
declare const p: Point;
export const sum = p + p;
`,
    });
    const raw = diagnostics.filter((d) => d.code === 2365);
    expect(raw.length).toBe(1);
    expect(filterDiagnostics(raw, checker, (f) => program.getSourceFile(f))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// MacroCallChain (#17)
// ---------------------------------------------------------------------------

const STD_MATCH_DTS = `export declare function match(value: unknown): never;\n`;

describe("MacroCallChain — must still report (deep-review macros-other #17)", () => {
  it("reports errors inside a non-typesugar match() chain (ts-pattern style)", () => {
    const files = {
      "/test.ts": `
declare function match<T>(x: T): { with(p: unknown, f: (v: T) => unknown): { otherwise(f: () => unknown): unknown } };
declare const user: { name: string };
export const r = match(user)
  .with({}, (u) => u.nmae.toUpperCase() + undefinedVariable)
  .otherwise(() => 0);
`,
    };
    const ts2339 = runRule(createMacroCallChainRule(), files, 2339);
    expect(ts2339.raw.length).toBe(1);
    expect(ts2339.kept).toHaveLength(1);
    const ts2304 = runRule(createMacroCallChainRule(), files, 2304);
    expect(ts2304.raw.length).toBe(1);
    expect(ts2304.kept).toHaveLength(1);
  });

  it("reports chain errors for a locally declared match (the transformer won't expand it)", () => {
    const { raw, kept } = runRule(
      createMacroCallChainRule(),
      {
        "/test.ts": `
declare function match(value: unknown): never;
export const x = match(42).case(1).then("one");
`,
      },
      2339
    );
    expect(raw.length).toBe(1);
    expect(kept).toHaveLength(1);
  });

  it("suppresses chain-method and bound-name errors for @typesugar/std's match, but not unbound names", () => {
    const files = {
      "/node_modules/@typesugar/std/package.json": `{ "name": "@typesugar/std", "types": "index.d.ts" }`,
      "/node_modules/@typesugar/std/index.d.ts": STD_MATCH_DTS,
      "/test.ts": `
import { match } from "@typesugar/std";
type Shape = { kind: "circle"; r: number } | { kind: "square"; s: number };
declare const sh: Shape;
export const area = match(sh)
  .case({ kind: "circle", r }).then(Math.PI * r ** 2)
  .case({ kind: "square", s }).then(s * notBound)
  .else(0);
export const firstPlus = match([1, 2, 3])
  .case([p, ...rest]).then(p + rest.length)
  .else(r);
`,
    };
    const ts2339 = runRule(createMacroCallChainRule(), files, 2339);
    expect(ts2339.raw.length).toBeGreaterThan(0); // `.case` on never
    expect(ts2339.kept).toHaveLength(0);

    const ts18004 = runRule(createMacroCallChainRule(), files, 18004);
    expect(ts18004.raw.length).toBe(2); // `r` and `s` shorthands
    expect(ts18004.kept).toHaveLength(0);

    const ts2304 = runRule(createMacroCallChainRule(), files, 2304);
    const keptNames = ts2304.kept.map((d) => messageOf(d)).sort();
    // `notBound` is bound by no pattern; `r` in the second chain's .else() is
    // bound by no arm of THAT chain.
    expect(keptNames).toEqual(["Cannot find name 'notBound'.", "Cannot find name 'r'."]);
    expect(ts2304.raw.length).toBeGreaterThan(keptNames.length);
  });

  it("recognises match imported from the monorepo's packages/std source (aliased import)", () => {
    const { raw, kept } = runRule(
      createMacroCallChainRule(),
      {
        "/repo/packages/std/src/index.ts": `export declare function match(value: unknown): never;`,
        "/repo/app/test.ts": `
import { match as m } from "@typesugar/std";
export const x = m(1).case(n).then(n + 1).else(0);
`,
      },
      2304,
      "/repo/app/test.ts",
      { baseUrl: "/repo", paths: { "@typesugar/std": ["packages/std/src/index.ts"] } }
    );
    expect(raw.length).toBeGreaterThan(0);
    expect(kept).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// TypeRewriteAssignment (#18)
// ---------------------------------------------------------------------------

describe("TypeRewriteAssignment — type params by name and symbol scope (deep-review macros-other #18)", () => {
  beforeEach(() => clearTypeRewrites());

  it("substitutes the declaration's own type-parameter name (Option<A> = A | null)", () => {
    registerTypeRewrite({ typeName: "Option", underlyingTypeText: "A | null" });
    const { raw, kept } = runRule(
      createTypeRewriteAssignmentRule(),
      {
        "/test.ts": `
interface Option<A> { map<B>(f: (a: A) => B): Option<B>; }
interface Box<T> { get(): T }
declare const n: number | null;
declare const s: string | null;
export const o: Option<number> = n;
export const wrong: Option<number> = s;
export const b: Box<number> = n;
`,
      },
      2322
    );
    expect(raw.length).toBe(3);
    expect(kept.map(lineOf)).toEqual([
      "export const wrong: Option<number> = s;",
      "export const b: Box<number> = n;",
    ]);
  });

  it("substitutes several parameters by name, not position", () => {
    registerTypeRewrite({ typeName: "Pair", underlyingTypeText: "[A, B]" });
    const { raw, kept } = runRule(
      createTypeRewriteAssignmentRule(),
      {
        "/test.ts": `
interface Pair<A, B> { readonly _pair: unique symbol; fst(): A; snd(): B }
declare const good: [string, number];
declare const swapped: [number, string];
export const p1: Pair<string, number> = good;
export const p2: Pair<string, number> = swapped;
`,
      },
      2322
    );
    expect(raw.length).toBe(2);
    expect(kept.map(lineOf)).toEqual(["export const p2: Pair<string, number> = swapped;"]);
  });

  it("does not apply an entry declared in another file to a same-named local type", () => {
    registerTypeRewrite({
      typeName: "Option",
      underlyingTypeText: "A | null",
      declarationFile: "/node_modules/@typesugar/fp/dist/data/option.d.ts",
    });
    const { raw, kept } = runRule(
      createTypeRewriteAssignmentRule(),
      {
        "/test.ts": `
interface Option<A> { readonly _o: unique symbol; get(): A }
declare const n: number | null;
export const o: Option<number> = n;
`,
      },
      2322
    );
    expect(raw.length).toBe(1);
    expect(kept).toHaveLength(1);
  });

  it("applies an entry to the type declared in its declarationFile", () => {
    registerTypeRewrite({
      typeName: "Option",
      underlyingTypeText: "A | null",
      declarationFile: "/lib/option.ts",
    });
    const { raw, kept } = runRule(
      createTypeRewriteAssignmentRule(),
      {
        "/lib/option.ts": `export interface Option<A> { readonly _o: unique symbol; get(): A }`,
        "/test.ts": `
import type { Option } from "./lib/option";
declare const n: number | null;
export const o: Option<number> = n;
`,
      },
      2322
    );
    expect(raw.length).toBe(1);
    expect(kept).toHaveLength(0);
  });
});

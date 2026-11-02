/**
 * Pre-merge code-review findings for transformer-core (2026-11-02).
 *
 * 1. isMacroModuleSpecifier's memo was keyed on the registry's SIZE, so a
 *    `clear()` followed by registering the same number of different macros
 *    kept the old module set; and it copied the whole registry on every call.
 * 2. isNodeInProgram cached its verdict per SourceFile for whichever program
 *    asked first; a SourceFile reused by the next program (watch, LSP) kept it.
 * 3. A removed macro-only import's leading comments are copied onto a
 *    placeholder: the file header must still be printed exactly once.
 * 5. The right-operand check of a binary `@op` (`add(a: A, b: A)`) must not
 *    reject a nullable right operand of the instance type (`p === maybeP`).
 * 6. In a file that activated no typeclass, the TS9804 pre-check must not ask
 *    the checker about literal operands, nor print every primitive operand's type.
 * 7. JSDoc `@schema https://...` and `@contract` lines are ordinary
 *    documentation in a project without @typesugar/sql / @typesugar/contracts:
 *    no "Unknown JSDoc macro tag" warning when no such macro is registered.
 * 8. A decorator whose name several modules register picks the one the file
 *    imports (lookupMacroByName), like every other bare-name site.
 * 9. A spread argument (`f(...args)`) fills as many parameters as its tuple
 *    has elements, not one, when deciding whether an `= implicit()` parameter
 *    is left unfilled.
 *
 * Each test drives the real `transformCode` pipeline over a real on-disk
 * program, and executes the output where the bug would show at run time.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

import {
  clearTypeRewrites,
  standaloneExtensionRegistry,
  defineAttributeMacro,
  defineExpressionMacro,
  globalRegistry,
  type MacroDefinition,
} from "@typesugar/core";
import "@typesugar/macros";

import { transformCode, type TransformCodeResult } from "../src/transform.js";
import { isMacroModuleSpecifier, isNodeInProgram } from "../src/import-resolution.js";
import { resetDtsDiscovery } from "../src/dts-opaque-discovery.js";

const OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
};

/** Write `files` to a temp dir and build a program rooted at `main.ts` (+ `roots`). */
function makeProject(
  files: Record<string, string>,
  roots: string[] = []
): { dir: string; program: ts.Program; fileName: string; cleanup(): void } {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pre-merge-review-")));
  for (const [name, content] of Object.entries(files)) {
    const p = path.join(dir, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  const fileName = path.join(dir, "main.ts");
  const host = ts.createCompilerHost(OPTIONS);
  const orig = host.getSourceFile.bind(host);
  host.getSourceFile = (fn, lang, onErr, shouldCreate) => {
    const sf = orig(fn, lang, onErr, shouldCreate);
    if (sf && fn === fileName) return ts.createSourceFile(fn, sf.text, lang, true);
    return sf;
  };
  const program = ts.createProgram(
    [fileName, ...roots.map((r) => path.join(dir, r))],
    OPTIONS,
    host
  );
  return {
    dir,
    program,
    fileName,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

function transform(
  main: string,
  extraFiles: Record<string, string> = {},
  roots: string[] = []
): TransformCodeResult {
  const project = makeProject({ ...extraFiles, "main.ts": main }, roots);
  try {
    const sf = project.program.getSourceFile(project.fileName)!;
    return transformCode(sf.text, { program: project.program, fileName: project.fileName });
  } finally {
    project.cleanup();
  }
}

/** A fake npm package: `package.json` + its files. */
function fakePackage(name: string, files: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {
    [`node_modules/${name}/package.json`]: JSON.stringify({
      name,
      version: "1.0.0",
      types: "index.d.ts",
    }),
  };
  for (const [f, content] of Object.entries(files)) out[`node_modules/${name}/${f}`] = content;
  return out;
}

/** Transpile to CJS and run; `log` collects its arguments. */
function run(code: string, modules: Record<string, unknown> = {}): unknown[] {
  const js = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const logged: unknown[] = [];
  const req = (m: string) => {
    if (m in modules) return modules[m];
    throw new Error(`unexpected runtime import of '${m}'`);
  };
  new Function("exports", "require", "log", js)({}, req, (v: unknown) => logged.push(v));
  return logged;
}

const errors = (r: TransformCodeResult) => r.diagnostics.filter((d) => d.severity === "error");

beforeEach(() => {
  clearTypeRewrites();
  resetDtsDiscovery();
  standaloneExtensionRegistry.length = 0;
});

afterEach(() => {
  clearTypeRewrites();
  resetDtsDiscovery();
  standaloneExtensionRegistry.length = 0;
});

// ---------------------------------------------------------------------------
// 1. isMacroModuleSpecifier's memo
// ---------------------------------------------------------------------------

describe("isMacroModuleSpecifier sees every registry change", () => {
  let saved: MacroDefinition[];
  beforeEach(() => {
    saved = globalRegistry.getAll();
  });
  afterEach(() => {
    globalRegistry.clear();
    for (const m of saved) globalRegistry.register(m);
  });

  const macroOf = (module: string) =>
    defineExpressionMacro({
      name: "__memoProbe",
      module,
      expand: (_ctx, call) => call,
    });

  it("clear() then registering the same number of different macros", () => {
    globalRegistry.clear();
    globalRegistry.register(macroOf("memo-mod-one"));
    expect(isMacroModuleSpecifier("memo-mod-one")).toBe(true);

    globalRegistry.clear();
    globalRegistry.register(macroOf("memo-mod-two"));
    expect(isMacroModuleSpecifier("memo-mod-two")).toBe(true);
    expect(isMacroModuleSpecifier("memo-mod-one")).toBe(false);
  });

  it("does not copy the registry on every call when it has a version", () => {
    const registry = globalRegistry as unknown as { version?: number };
    const hadVersion = typeof registry.version === "number";
    // A @typesugar/core dist built before `version` existed: emulate it.
    if (!hadVersion) registry.version = 1;
    const getAll = vi.spyOn(globalRegistry, "getAll");
    try {
      registry.version = (registry.version ?? 0) + 1;
      isMacroModuleSpecifier("memo-hot-path");
      const afterFirst = getAll.mock.calls.length;
      for (let i = 0; i < 50; i++) isMacroModuleSpecifier("memo-hot-path");
      expect(getAll.mock.calls.length).toBe(afterFirst);
    } finally {
      getAll.mockRestore();
      if (!hadVersion) delete registry.version;
    }
  });
});

// ---------------------------------------------------------------------------
// 2. isNodeInProgram is per program
// ---------------------------------------------------------------------------

describe("isNodeInProgram's verdict is per program", () => {
  it("a SourceFile owned by one program is not owned by the next, which replaced it", () => {
    const fileName = "/virtual/in-program.ts";
    const first = ts.createSourceFile(
      fileName,
      "export const a = 1;",
      ts.ScriptTarget.ES2020,
      true
    );
    const second = ts.createSourceFile(
      fileName,
      "export const a = 2;",
      ts.ScriptTarget.ES2020,
      true
    );
    const programWith = (sf: ts.SourceFile) => {
      const host = ts.createCompilerHost(OPTIONS);
      const orig = host.getSourceFile.bind(host);
      host.getSourceFile = (fn, ...rest) => (fn === fileName ? sf : orig(fn, ...rest));
      return ts.createProgram([fileName], OPTIONS, host);
    };
    const programA = programWith(first);
    const programB = programWith(second);
    const node = first.statements[0];
    expect(isNodeInProgram(programA, node)).toBe(true);
    expect(isNodeInProgram(programB, node)).toBe(false);
    expect(isNodeInProgram(programB, second.statements[0])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. A removed macro-only import's comments are printed once
// ---------------------------------------------------------------------------

describe("removing a macro-only import prints the file header once", () => {
  const NAME = "__testHeaderOnce";
  beforeEach(() => {
    if (!globalRegistry.getExpression(NAME)) {
      globalRegistry.register(
        defineExpressionMacro({
          name: NAME,
          description: "expands to its argument",
          expand: (_ctx, _call, args) => args[0],
        })
      );
    }
  });

  const count = (text: string, needle: string) => text.split(needle).length - 1;

  for (const [label, header] of [
    ["a detached license block", ["/*!", " * License MIT", " */", "", "// second line"]],
    ["an attached header", ["// header line", "/** doc comment */"]],
  ] as const) {
    it(`${label}: transformCode output and its emitted JavaScript`, () => {
      const code = [
        ...header,
        `import { ${NAME} } from "test-macros-header";`,
        "",
        `export const a = ${NAME}(1);`,
      ].join("\n");
      const out = transformCode(code, { fileName: "/virtual/header.ts" }).code;
      expect(out).not.toContain("test-macros-header");
      const js = ts.transpileModule(out, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
      }).outputText;
      for (const text of [out, js]) {
        for (const line of header.filter((l) => l.trim() !== "")) {
          expect(count(text, line)).toBe(1);
        }
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 5. The right-operand check accepts a nullable operand of the instance type
// ---------------------------------------------------------------------------

const POINT_EQ = [
  `declare function log(v: unknown): void;`,
  `interface Point { x: number; y: number }`,
  `/** @typeclass */`,
  `interface Same<A> {`,
  `  /** @op === */`,
  `  same(a: A, b: A): boolean;`,
  `}`,
  `/** @impl Same<Point> */`,
  `const samePoint: Same<Point> = { same: (a, b) => a.x === b.x && a.y === b.y };`,
  `const p: Point = { x: 1, y: 2 };`,
].join("\n");

describe("binary @op right-operand check with a nullable operand", () => {
  it("p === cached (Point | undefined) is not an error, and keeps the native nullish result", () => {
    const result = transform(
      [
        POINT_EQ,
        `let cached: Point | undefined = Math.random() > 2 ? p : undefined;`,
        `log(p === cached);`,
        `cached = { x: 1, y: 2 };`,
        `log(p === cached);`,
      ].join("\n")
    );
    expect(errors(result)).toEqual([]);
    expect(run(result.code)).toEqual([false, true]);
  });
});

// ---------------------------------------------------------------------------
// 6. The TS9804 pre-check in a file that activated nothing
// ---------------------------------------------------------------------------

/** A typeclass mapping `+`, `-`, `*` and `<` in the program, activated nowhere. */
const OPS_LIB = [
  `export interface Vec2 { x: number; y: number }`,
  `/** @typeclass */`,
  `export interface VecOps<A> {`,
  `  /** @op + */`,
  `  add(a: A, b: A): A;`,
  `  /** @op - */`,
  `  sub(a: A, b: A): A;`,
  `  /** @op * */`,
  `  mul(a: A, b: A): A;`,
  `  /** @op < */`,
  `  lt(a: A, b: A): boolean;`,
  `}`,
].join("\n");

describe("TS9804 pre-check: no checker work on what cannot need the hint", () => {
  /** Transform `main` with the checker's getTypeAtLocation/typeToString counted. */
  function countChecker(main: string) {
    const project = makeProject({ "lib.ts": OPS_LIB, "main.ts": main }, ["lib.ts"]);
    try {
      const checker = project.program.getTypeChecker();
      const sf = project.program.getSourceFile(project.fileName)!;
      const literalsAsked: string[] = [];
      let typeToStringCalls = 0;
      const getTypeAtLocation = checker.getTypeAtLocation.bind(checker);
      const typeToString = checker.typeToString.bind(checker);
      const spyAt = vi.spyOn(checker, "getTypeAtLocation").mockImplementation((n: ts.Node) => {
        if (n.getSourceFile?.() === sf && (ts.isNumericLiteral(n) || ts.isStringLiteral(n))) {
          literalsAsked.push(n.getText(sf));
        }
        return getTypeAtLocation(n);
      });
      const spyStr = vi
        .spyOn(checker, "typeToString")
        .mockImplementation((...args: Parameters<ts.TypeChecker["typeToString"]>) => {
          typeToStringCalls++;
          return typeToString(...args);
        });
      try {
        const result = transformCode(sf.text, {
          program: project.program,
          fileName: project.fileName,
        });
        return { result, literalsAsked, typeToStringCalls };
      } finally {
        spyAt.mockRestore();
        spyStr.mockRestore();
      }
    } finally {
      project.cleanup();
    }
  }

  it("never asks the checker for the type of a literal left operand", () => {
    const { result, literalsAsked } = countChecker(
      [
        `declare const n: number;`,
        `declare const s: string;`,
        `export const r = [1 + n, 2 * n, 3 - n, 4 < n, "a" + s, \`t\${n}\` + s];`,
      ].join("\n")
    );
    expect(result.diagnostics).toEqual([]);
    expect(literalsAsked).toEqual([]);
  });

  it("does not print the type of each primitive operand", () => {
    const op = (i: number) => `n${i} + n${i}`;
    const src = (k: number) =>
      [
        ...Array.from({ length: k }, (_, i) => `declare const n${i}: number;`),
        `export const r = [${Array.from({ length: k }, (_, i) => op(i)).join(", ")}];`,
      ].join("\n");
    const one = countChecker(src(1));
    const ten = countChecker(src(10));
    expect(ten.result.diagnostics).toEqual([]);
    expect(ten.typeToStringCalls).toBe(one.typeToStringCalls);
  });
});

// ---------------------------------------------------------------------------
// 7. Optional-package JSDoc tags with no macro registered
// ---------------------------------------------------------------------------

describe("@schema / @contract doc tags when their package is not loaded", () => {
  it("are left alone without an 'Unknown JSDoc macro tag' warning", () => {
    // This file loads @typesugar/macros only: no `schema` or `contract` macro.
    expect(globalRegistry.getCandidates("schema", "attribute")).toEqual([]);
    expect(globalRegistry.getCandidates("contract", "attribute")).toEqual([]);
    const code = [
      `/**`,
      ` * A row.`,
      ` * @schema https://example.com/row.json`,
      ` */`,
      `export interface Row { id: number }`,
      `/**`,
      ` * Adds.`,
      ` * @contract see docs/contracts.md`,
      ` */`,
      `export function add(a: number, b: number) { return a + b; }`,
    ].join("\n");
    const result = transformCode(code, { fileName: "/virtual/plain-doc-tags.ts" });
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("@schema https://example.com/row.json");
    expect(result.code).toContain("@contract see docs/contracts.md");
  });

  it("an unregistered tag that is not package-specific is still reported", () => {
    // `operators` is a built-in tag no macro implements (kept for parity).
    const result = transformCode(`/** @operators */\nexport interface T { a: number }`, {
      fileName: "/virtual/unknown-tag.ts",
    });
    expect(result.diagnostics.map((d) => d.message)).toEqual([
      "Unknown JSDoc macro tag @operators",
    ]);
  });
});

// ---------------------------------------------------------------------------
// 8. A decorator name several modules register
// ---------------------------------------------------------------------------

describe("decorator macros resolve by the file's imports when several modules register the name", () => {
  const stamp = (module: string) =>
    defineAttributeMacro({
      name: "__stamped",
      module,
      validTargets: ["class"],
      expand(ctx, _decorator, target) {
        if (!ts.isClassDeclaration(target)) return target;
        const f = ctx.factory;
        return [
          f.updateClassDeclaration(
            target,
            target.modifiers?.filter((m) => !ts.isDecorator(m)),
            target.name,
            target.typeParameters,
            target.heritageClauses,
            target.members
          ),
          f.createExpressionStatement(
            f.createCallExpression(f.createIdentifier("log"), undefined, [
              f.createStringLiteral(module),
            ])
          ),
        ];
      },
    });
  const FILES = {
    ...fakePackage("stamp-a", { "index.d.ts": "export {};" }),
    ...fakePackage("stamp-b", { "index.d.ts": "export {};" }),
  };

  beforeEach(() => {
    globalRegistry.register(stamp("stamp-a"));
    globalRegistry.register(stamp("stamp-b"));
  });

  it("@__stamped in a file that imports only stamp-b expands stamp-b's macro", () => {
    const result = transform(
      [
        `import "stamp-b";`,
        `declare function log(v: unknown): void;`,
        `// @ts-ignore`,
        `@__stamped`,
        `class C {}`,
      ].join("\n"),
      FILES
    );
    expect(result.code).not.toContain("@__stamped");
    expect(run(result.code, { "stamp-b": {} })).toEqual(["stamp-b"]);
  });

  it("@__stamped in a file that imports neither is left as written, with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = transform(
        [
          `declare function log(v: unknown): void;`,
          `// @ts-ignore`,
          `@__stamped`,
          `class C {}`,
        ].join("\n"),
        FILES
      );
      expect(result.code).toContain("@__stamped");
      expect(warn.mock.calls.some(([m]) => /__stamped.*imports none of them/.test(String(m)))).toBe(
        true
      );
    } finally {
      warn.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// 9. A spread argument fills its tuple's parameters
// ---------------------------------------------------------------------------

const SORT_WITH = [
  `import { implicit } from "typesugar";`,
  `declare function log(v: unknown): void;`,
  `interface Ord<A> { compare(a: A, b: A): number }`,
  `/** @impl Ord<number> */`,
  `const numberOrd: Ord<number> = {`,
  `  compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0),`,
  `};`,
  `function sortWith<T>(items: T[], ord: Ord<T> = implicit()): T[] {`,
  `  return items.slice().sort((a, b) => ord.compare(a, b));`,
  `}`,
].join("\n");

const implicitWarnings = (r: TransformCodeResult) =>
  r.diagnostics.filter((d) => /TS9602.*without its = implicit\(\) argument/.test(d.message));

describe("auto-specialization: a spread argument that supplies the = implicit() parameter", () => {
  it("a spread that supplies every parameter does not block specialization", () => {
    const result = transform(
      [
        SORT_WITH,
        `function sortVia<T>(items: T[], ord: Ord<T> = implicit()): T[] {`,
        `  const args: [T[], Ord<T>] = [items, ord];`,
        `  return sortWith(...args);`,
        `}`,
        `log(sortVia([3, 1, 2], numberOrd));`,
      ].join("\n")
    );
    expect(errors(result)).toEqual([]);
    expect(implicitWarnings(result)).toEqual([]);
    expect(run(result.code, { typesugar: { implicit: () => undefined } })).toEqual([[1, 2, 3]]);
  });

  it("a spread too short to reach the parameter is still reported, and runs", () => {
    const result = transform(
      [
        SORT_WITH,
        `function sortOne<T>(items: T[], ord: Ord<T> = implicit()): T[] {`,
        `  const args: [T[]] = [items];`,
        `  return sortWith(...args);`,
        `}`,
        `log(sortOne([3, 1, 2], numberOrd));`,
      ].join("\n")
    );
    expect(errors(result)).toEqual([]);
    expect(implicitWarnings(result)).toHaveLength(1);
    expect(run(result.code, { typesugar: { implicit: () => undefined } })).toEqual([[1, 2, 3]]);
  });
});

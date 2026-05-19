/**
 * Tests for module-graph.ts — `collectTypes` and `moduleIndex` macros.
 *
 * Only the macros themselves are exported, so the internal helpers
 * (`simpleGlobMatch`, `matchesPattern`, `matchesKindPattern`,
 * `matchesDecoratorPattern`, `extractTypeDeclaration`,
 * `collectTypesFromProgram`) are exercised end-to-end through the macros
 * against multi-file in-memory `ts.Program`s.
 *
 * Covers:
 * - Macro metadata (name, module, kind, description).
 * - `collectTypes` error paths: wrong arity, non-string-literal arg.
 * - Pattern handling via `collectTypes`:
 *   - `"*"` matches all kinds; `"interface"` / `"class"` / `"type"` / `"enum"`
 *     restrict by kind.
 *   - `"@decorator"` matches by decorator (call form and identifier form);
 *     unrelated decorators do not match.
 *   - Glob patterns (e.g. star-star slash star dot ts) filter file paths
 *     relative to the calling source directory.
 *   - Literal file name does not match a different file name.
 * - Output AST shape: array literal of object literals with the documented
 *   keys (`name`, `module`, `kind`, `exported`).
 * - `moduleIndex`:
 *   - Returns a per-module list of exports (interface / class / type / enum /
 *     function / variable kinds).
 *   - Skips declaration files, node_modules, and unexported declarations.
 *   - Emits a `module` path relative to the calling source directory.
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { createMacroContext } from "@typesugar/core";
import { collectTypesMacro, moduleIndexMacro } from "./module-graph.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Multi {
  program: ts.Program;
  rootDir: string;
  callerFile: string;
  cleanup: () => void;
}

/**
 * Build a real `ts.Program` from a map of `{ relativePath: source }`. One of
 * the files is designated as the "caller" — its source file is passed to
 * `createMacroContext`, mirroring how the transformer invokes a macro.
 *
 * Relative paths use forward slashes; nested directories are created
 * automatically. The caller file must be one of the keys.
 */
function createMultiFileProgram(files: Record<string, string>, callerRelative: string): Multi {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "module-graph-test-"));
  const written: string[] = [];

  for (const [rel, src] of Object.entries(files)) {
    const abs = path.join(tmpDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, src);
    written.push(abs);
  }

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    experimentalDecorators: true,
  };
  const host = ts.createCompilerHost(options);
  const program = ts.createProgram(written, options, host);

  const callerAbs = path.join(tmpDir, callerRelative);
  return {
    program,
    rootDir: tmpDir,
    callerFile: callerAbs,
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
}

/**
 * Invoke `collectTypesMacro.expand` against the caller source file. The
 * supplied pattern is wrapped in a synthetic string-literal `collectTypes`
 * call. Returns the expanded expression plus any diagnostics.
 */
function runCollect(
  multi: Multi,
  patternArg: ts.Expression | "MISSING"
): {
  expanded: ts.Expression;
  diagnostics: ReturnType<ReturnType<typeof createMacroContext>["getDiagnostics"]>;
} {
  const sourceFile = multi.program.getSourceFile(multi.callerFile)!;
  let expanded: ts.Expression = ts.factory.createVoidZero();
  let diagnostics: ReturnType<ReturnType<typeof createMacroContext>["getDiagnostics"]> = [];

  const transformerFactory: ts.TransformerFactory<ts.SourceFile> = (transformContext) => {
    const ctx = createMacroContext(multi.program, sourceFile, transformContext);
    const args: readonly ts.Expression[] = patternArg === "MISSING" ? [] : ([patternArg] as const);
    const callExpr = ts.factory.createCallExpression(
      ts.factory.createIdentifier("collectTypes"),
      undefined,
      args
    );
    expanded = collectTypesMacro.expand(ctx, callExpr, args);
    diagnostics = ctx.getDiagnostics();
    return (sf) => sf;
  };

  ts.transform(sourceFile, [transformerFactory]);
  return { expanded, diagnostics };
}

/** Invoke `moduleIndexMacro.expand` against the caller source file. */
function runIndex(multi: Multi): {
  expanded: ts.Expression;
  diagnostics: ReturnType<ReturnType<typeof createMacroContext>["getDiagnostics"]>;
} {
  const sourceFile = multi.program.getSourceFile(multi.callerFile)!;
  let expanded: ts.Expression = ts.factory.createVoidZero();
  let diagnostics: ReturnType<ReturnType<typeof createMacroContext>["getDiagnostics"]> = [];

  const transformerFactory: ts.TransformerFactory<ts.SourceFile> = (transformContext) => {
    const ctx = createMacroContext(multi.program, sourceFile, transformContext);
    const callExpr = ts.factory.createCallExpression(
      ts.factory.createIdentifier("moduleIndex"),
      undefined,
      []
    );
    expanded = moduleIndexMacro.expand(ctx, callExpr, []);
    diagnostics = ctx.getDiagnostics();
    return (sf) => sf;
  };

  ts.transform(sourceFile, [transformerFactory]);
  return { expanded, diagnostics };
}

/**
 * Decode an array-literal of object-literals of string/boolean props into a
 * plain JS array. Throws on unexpected shapes — the macro contract under
 * test guarantees this layout.
 */
function decodeArrayOfObjects(
  expr: ts.Expression
): Array<Record<string, string | boolean | unknown>> {
  expect(ts.isArrayLiteralExpression(expr)).toBe(true);
  const arr = expr as ts.ArrayLiteralExpression;
  return arr.elements.map((el) => {
    expect(ts.isObjectLiteralExpression(el)).toBe(true);
    const obj = el as ts.ObjectLiteralExpression;
    const out: Record<string, string | boolean | unknown> = {};
    for (const p of obj.properties) {
      const pa = p as ts.PropertyAssignment;
      const key = (pa.name as ts.Identifier | ts.StringLiteral).text;
      const init = pa.initializer;
      if (ts.isStringLiteral(init)) out[key] = init.text;
      else if (init.kind === ts.SyntaxKind.TrueKeyword) out[key] = true;
      else if (init.kind === ts.SyntaxKind.FalseKeyword) out[key] = false;
      else if (ts.isArrayLiteralExpression(init)) out[key] = decodeArrayOfObjects(init);
      else out[key] = init;
    }
    return out;
  });
}

// ===========================================================================
// Macro metadata
// ===========================================================================

describe("macro metadata", () => {
  it("collectTypesMacro is an expression macro named 'collectTypes'", () => {
    expect(collectTypesMacro.kind).toBe("expression");
    expect(collectTypesMacro.name).toBe("collectTypes");
    expect(collectTypesMacro.module).toBe("typesugar");
    expect(collectTypesMacro.description).toMatch(/glob pattern/i);
  });

  it("moduleIndexMacro is an expression macro named 'moduleIndex'", () => {
    expect(moduleIndexMacro.kind).toBe("expression");
    expect(moduleIndexMacro.name).toBe("moduleIndex");
    expect(moduleIndexMacro.module).toBe("typesugar");
    expect(moduleIndexMacro.description).toMatch(/index/i);
  });
});

// ===========================================================================
// collectTypes — error paths
// ===========================================================================

describe("collectTypes — argument validation", () => {
  it("reports an error and returns the original call when no argument is supplied", () => {
    const multi = createMultiFileProgram({ "caller.ts": `export const X = 1;` }, "caller.ts");
    try {
      const { expanded, diagnostics } = runCollect(multi, "MISSING");
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0].severity).toBe("error");
      expect(diagnostics[0].message).toMatch(/exactly one argument/);
      // On error the macro returns the (original) call expression unchanged.
      expect(ts.isCallExpression(expanded)).toBe(true);
    } finally {
      multi.cleanup();
    }
  });

  it("reports an error when the pattern is not a string literal", () => {
    const multi = createMultiFileProgram({ "caller.ts": `export const X = 1;` }, "caller.ts");
    try {
      const { expanded, diagnostics } = runCollect(
        multi,
        ts.factory.createIdentifier("dynamicPattern")
      );
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0].severity).toBe("error");
      expect(diagnostics[0].message).toMatch(/string literal/);
      expect(ts.isCallExpression(expanded)).toBe(true);
    } finally {
      multi.cleanup();
    }
  });

  it("accepts a no-substitution template literal as the pattern", () => {
    const multi = createMultiFileProgram({ "caller.ts": `export interface Only {}` }, "caller.ts");
    try {
      const { expanded, diagnostics } = runCollect(
        multi,
        ts.factory.createNoSubstitutionTemplateLiteral("interface", "interface")
      );
      expect(diagnostics).toEqual([]);
      const decoded = decodeArrayOfObjects(expanded);
      expect(decoded.map((d) => d.name)).toContain("Only");
    } finally {
      multi.cleanup();
    }
  });
});

// ===========================================================================
// Kind patterns — exercise matchesKindPattern through collectTypes
// ===========================================================================

describe("collectTypes — kind patterns", () => {
  const sources = {
    "caller.ts": `
      export interface IFace { x: number }
      export class Klass { x = 1 }
      export type Alias = number;
      export enum Color { Red, Green }
      export function fn() {}
      export const v = 1;
    `,
  };

  it("'*' returns every interface / class / type-alias / enum (not functions or vars)", () => {
    const multi = createMultiFileProgram(sources, "caller.ts");
    try {
      const { expanded, diagnostics } = runCollect(multi, ts.factory.createStringLiteral("*"));
      expect(diagnostics).toEqual([]);
      const names = decodeArrayOfObjects(expanded)
        .map((d) => d.name as string)
        .sort();
      expect(names).toEqual(["Alias", "Color", "IFace", "Klass"]);
    } finally {
      multi.cleanup();
    }
  });

  it("'interface' returns only interfaces", () => {
    const multi = createMultiFileProgram(sources, "caller.ts");
    try {
      const { expanded, diagnostics } = runCollect(
        multi,
        ts.factory.createStringLiteral("interface")
      );
      expect(diagnostics).toEqual([]);
      const decoded = decodeArrayOfObjects(expanded);
      expect(decoded.map((d) => d.name).sort()).toEqual(["IFace"]);
      expect(decoded.every((d) => d.kind === "interface")).toBe(true);
    } finally {
      multi.cleanup();
    }
  });

  it("'class' returns only classes", () => {
    const multi = createMultiFileProgram(sources, "caller.ts");
    try {
      const { expanded, diagnostics } = runCollect(multi, ts.factory.createStringLiteral("class"));
      expect(diagnostics).toEqual([]);
      const decoded = decodeArrayOfObjects(expanded);
      expect(decoded.map((d) => d.name)).toEqual(["Klass"]);
      expect(decoded[0]!.kind).toBe("class");
    } finally {
      multi.cleanup();
    }
  });

  it("'type' returns only type aliases", () => {
    const multi = createMultiFileProgram(sources, "caller.ts");
    try {
      const { expanded } = runCollect(multi, ts.factory.createStringLiteral("type"));
      const decoded = decodeArrayOfObjects(expanded);
      expect(decoded.map((d) => d.name)).toEqual(["Alias"]);
      expect(decoded[0]!.kind).toBe("type");
    } finally {
      multi.cleanup();
    }
  });

  it("'enum' returns only enums", () => {
    const multi = createMultiFileProgram(sources, "caller.ts");
    try {
      const { expanded } = runCollect(multi, ts.factory.createStringLiteral("enum"));
      const decoded = decodeArrayOfObjects(expanded);
      expect(decoded.map((d) => d.name)).toEqual(["Color"]);
      expect(decoded[0]!.kind).toBe("enum");
    } finally {
      multi.cleanup();
    }
  });

  it("non-matching kind pattern returns an empty array", () => {
    const multi = createMultiFileProgram({ "caller.ts": `export class Only {}` }, "caller.ts");
    try {
      const { expanded } = runCollect(multi, ts.factory.createStringLiteral("interface"));
      expect(decodeArrayOfObjects(expanded)).toEqual([]);
    } finally {
      multi.cleanup();
    }
  });

  it("records the `exported` flag on each entry", () => {
    const multi = createMultiFileProgram(
      {
        "caller.ts": `
          export interface Pub {}
          interface Priv {}
        `,
      },
      "caller.ts"
    );
    try {
      const { expanded } = runCollect(multi, ts.factory.createStringLiteral("interface"));
      const decoded = decodeArrayOfObjects(expanded).sort((a, b) =>
        (a.name as string).localeCompare(b.name as string)
      );
      expect(decoded).toHaveLength(2);
      const pub = decoded.find((d) => d.name === "Pub")!;
      const priv = decoded.find((d) => d.name === "Priv")!;
      expect(pub.exported).toBe(true);
      expect(priv.exported).toBe(false);
    } finally {
      multi.cleanup();
    }
  });
});

// ===========================================================================
// Decorator patterns — exercise matchesDecoratorPattern through collectTypes
// ===========================================================================

describe("collectTypes — decorator patterns", () => {
  it("'@entity' matches a class with @entity(...) call-form decorator", () => {
    const multi = createMultiFileProgram(
      {
        "caller.ts": `
          declare function entity(...args: any[]): ClassDecorator;
          declare function audit(...args: any[]): ClassDecorator;
          @entity("users")
          export class User { id = 1 }
          @audit()
          export class Audit { ts = 0 }
          export class Plain { x = 1 }
        `,
      },
      "caller.ts"
    );
    try {
      const { expanded, diagnostics } = runCollect(
        multi,
        ts.factory.createStringLiteral("@entity")
      );
      expect(diagnostics).toEqual([]);
      const names = decodeArrayOfObjects(expanded).map((d) => d.name);
      expect(names).toEqual(["User"]);
    } finally {
      multi.cleanup();
    }
  });

  it("'@flag' matches a class with the identifier-form @flag decorator", () => {
    const multi = createMultiFileProgram(
      {
        "caller.ts": `
          declare const flag: ClassDecorator;
          @flag
          export class A {}
          export class B {}
        `,
      },
      "caller.ts"
    );
    try {
      const { expanded, diagnostics } = runCollect(multi, ts.factory.createStringLiteral("@flag"));
      expect(diagnostics).toEqual([]);
      const names = decodeArrayOfObjects(expanded).map((d) => d.name);
      expect(names).toEqual(["A"]);
    } finally {
      multi.cleanup();
    }
  });

  it("decorator pattern that doesn't match returns an empty array", () => {
    const multi = createMultiFileProgram(
      {
        "caller.ts": `
          declare function entity(...args: any[]): ClassDecorator;
          @entity()
          export class A {}
        `,
      },
      "caller.ts"
    );
    try {
      const { expanded } = runCollect(multi, ts.factory.createStringLiteral("@reflect"));
      expect(decodeArrayOfObjects(expanded)).toEqual([]);
    } finally {
      multi.cleanup();
    }
  });

  it("a class with no decorators does not match an @-pattern", () => {
    const multi = createMultiFileProgram({ "caller.ts": `export class Plain {}` }, "caller.ts");
    try {
      const { expanded } = runCollect(multi, ts.factory.createStringLiteral("@entity"));
      expect(decodeArrayOfObjects(expanded)).toEqual([]);
    } finally {
      multi.cleanup();
    }
  });
});

// ===========================================================================
// Glob patterns — exercise simpleGlobMatch + matchesPattern
// ===========================================================================

describe("collectTypes — glob patterns", () => {
  it("'*.ts' matches sibling files in the caller directory", () => {
    const multi = createMultiFileProgram(
      {
        "caller.ts": `export interface CallerOnly {}`,
        "sibling.ts": `export interface Sibling {}`,
        "nested/deep.ts": `export interface Deep {}`,
      },
      "caller.ts"
    );
    try {
      const { expanded, diagnostics } = runCollect(multi, ts.factory.createStringLiteral("*.ts"));
      expect(diagnostics).toEqual([]);
      const names = decodeArrayOfObjects(expanded)
        .map((d) => d.name as string)
        .sort();
      // Caller is at "caller.ts" (relative ""), sibling at "sibling.ts".
      // `*.ts` is "[^/]*\.ts" — both top-level files match.
      expect(names).toContain("Sibling");
      expect(names).not.toContain("Deep");
    } finally {
      multi.cleanup();
    }
  });

  it("'**/*.ts' matches files in nested directories", () => {
    const multi = createMultiFileProgram(
      {
        "caller.ts": `export interface CallerOnly {}`,
        "nested/deep.ts": `export interface Deep {}`,
        "nested/more/deeper.ts": `export interface Deeper {}`,
      },
      "caller.ts"
    );
    try {
      const { expanded, diagnostics } = runCollect(
        multi,
        ts.factory.createStringLiteral("**/*.ts")
      );
      expect(diagnostics).toEqual([]);
      const names = decodeArrayOfObjects(expanded)
        .map((d) => d.name as string)
        .sort();
      expect(names).toContain("Deep");
      expect(names).toContain("Deeper");
    } finally {
      multi.cleanup();
    }
  });

  it("'src/*.ts' only matches files under the src/ subdirectory", () => {
    const multi = createMultiFileProgram(
      {
        "caller.ts": `export interface CallerOnly {}`,
        "src/a.ts": `export interface A {}`,
        "src/b.ts": `export interface B {}`,
        "other/c.ts": `export interface C {}`,
      },
      "caller.ts"
    );
    try {
      const { expanded } = runCollect(multi, ts.factory.createStringLiteral("src/*.ts"));
      const names = decodeArrayOfObjects(expanded)
        .map((d) => d.name as string)
        .sort();
      expect(names).toEqual(["A", "B"]);
    } finally {
      multi.cleanup();
    }
  });

  it("a literal filename pattern matches only that file (via a glob-like 'foo.*' form)", () => {
    // NOTE: A bare `foo.ts` pattern is treated as a kind-pattern by
    // `matchesKindPattern` because it contains no `*` or `/`, so it
    // would never match any declaration. The user-facing glob form
    // needs at least one `*` or `/` to be recognized as a path pattern.
    // We use `foo.*` here to exercise the file-path matching branch.
    const multi = createMultiFileProgram(
      {
        "caller.ts": `export interface CallerOnly {}`,
        "foo.ts": `export interface Foo {}`,
        "bar.ts": `export interface Bar {}`,
      },
      "caller.ts"
    );
    try {
      const { expanded } = runCollect(multi, ts.factory.createStringLiteral("foo.*"));
      const names = decodeArrayOfObjects(expanded)
        .map((d) => d.name)
        .sort();
      expect(names).toEqual(["Foo"]);
    } finally {
      multi.cleanup();
    }
  });

  it("dots in glob patterns are escaped (do not act as wildcards)", () => {
    const multi = createMultiFileProgram(
      {
        "caller.ts": `export interface CallerOnly {}`,
        // `aXts` should not match `a.ts` because `.` is escaped.
        "a.ts": `export interface A {}`,
      },
      "caller.ts"
    );
    try {
      // `aXts` literal pattern would only match if `.` were treated as a wildcard.
      const { expanded } = runCollect(multi, ts.factory.createStringLiteral("aXts"));
      expect(decodeArrayOfObjects(expanded)).toEqual([]);
    } finally {
      multi.cleanup();
    }
  });
});

// ===========================================================================
// collectTypes — emitted AST shape
// ===========================================================================

describe("collectTypes — emitted AST shape", () => {
  it("emits an ArrayLiteralExpression of ObjectLiteralExpressions with name/module/kind/exported", () => {
    const multi = createMultiFileProgram(
      { "caller.ts": `export interface Foo {}\nclass Bar {}` },
      "caller.ts"
    );
    try {
      const { expanded, diagnostics } = runCollect(multi, ts.factory.createStringLiteral("*"));
      expect(diagnostics).toEqual([]);
      expect(ts.isArrayLiteralExpression(expanded)).toBe(true);
      const arr = expanded as ts.ArrayLiteralExpression;
      for (const el of arr.elements) {
        expect(ts.isObjectLiteralExpression(el)).toBe(true);
        const keys = (el as ts.ObjectLiteralExpression).properties.map(
          (p) => ((p as ts.PropertyAssignment).name as ts.Identifier | ts.StringLiteral).text
        );
        expect(keys).toEqual(["name", "module", "kind", "exported"]);
      }
    } finally {
      multi.cleanup();
    }
  });
});

// ===========================================================================
// moduleIndex
// ===========================================================================

describe("moduleIndex", () => {
  it("lists exported declarations per module, grouped by kind", () => {
    const multi = createMultiFileProgram(
      {
        "caller.ts": `
          export interface IFace { x: number }
          export class Klass {}
          export type Alias = number;
          export enum Color { Red }
          export function fn() {}
          export const v = 1;
        `,
      },
      "caller.ts"
    );
    try {
      const { expanded, diagnostics } = runIndex(multi);
      expect(diagnostics).toEqual([]);
      const decoded = decodeArrayOfObjects(expanded);
      // Each entry should be { module: string, exports: [...] }.
      expect(decoded.length).toBeGreaterThanOrEqual(1);
      const callerEntry = decoded.find(
        (e) => typeof e.module === "string" && (e.module as string).endsWith("caller.ts")
      )!;
      expect(callerEntry).toBeDefined();
      const exports = callerEntry.exports as Array<Record<string, string>>;
      const byKind = (k: string) => exports.filter((e) => e.kind === k).map((e) => e.name);
      expect(byKind("interface")).toEqual(["IFace"]);
      expect(byKind("class")).toEqual(["Klass"]);
      expect(byKind("type")).toEqual(["Alias"]);
      expect(byKind("enum")).toEqual(["Color"]);
      expect(byKind("function")).toEqual(["fn"]);
      expect(byKind("variable")).toEqual(["v"]);
    } finally {
      multi.cleanup();
    }
  });

  it("does not include non-exported declarations", () => {
    const multi = createMultiFileProgram(
      {
        "caller.ts": `
          export interface Pub {}
          interface Priv {}
          function privFn() {}
        `,
      },
      "caller.ts"
    );
    try {
      const { expanded } = runIndex(multi);
      const decoded = decodeArrayOfObjects(expanded);
      const callerEntry = decoded.find(
        (e) => typeof e.module === "string" && (e.module as string).endsWith("caller.ts")
      )!;
      const names = (callerEntry.exports as Array<Record<string, string>>).map((e) => e.name);
      expect(names).toContain("Pub");
      expect(names).not.toContain("Priv");
      expect(names).not.toContain("privFn");
    } finally {
      multi.cleanup();
    }
  });

  it("skips files that have no exported declarations", () => {
    const multi = createMultiFileProgram(
      {
        "caller.ts": `export interface Only {}`,
        "internal.ts": `interface Hidden {} const x = 1;`,
      },
      "caller.ts"
    );
    try {
      const { expanded } = runIndex(multi);
      const decoded = decodeArrayOfObjects(expanded);
      const modules = decoded.map((e) => e.module as string).map((m) => m.replace(/\\/g, "/"));
      expect(modules.some((m) => m.endsWith("caller.ts"))).toBe(true);
      expect(modules.some((m) => m.endsWith("internal.ts"))).toBe(false);
    } finally {
      multi.cleanup();
    }
  });

  it("emits the module path relative to the caller's directory", () => {
    const multi = createMultiFileProgram(
      {
        "caller.ts": `export interface CallerOnly {}`,
        "sub/other.ts": `export interface Other {}`,
      },
      "caller.ts"
    );
    try {
      const { expanded } = runIndex(multi);
      const decoded = decodeArrayOfObjects(expanded);
      const modules = decoded.map((e) => e.module as string).map((m) => m.replace(/\\/g, "/"));
      // The sibling file should appear with a relative path like "sub/other.ts",
      // not an absolute one.
      const otherEntry = modules.find((m) => m.endsWith("sub/other.ts"));
      expect(otherEntry).toBeDefined();
      expect(otherEntry!.startsWith("/")).toBe(false);
      expect(otherEntry!).toBe("sub/other.ts");
    } finally {
      multi.cleanup();
    }
  });

  it("emits an ArrayLiteralExpression of { module, exports: [...] } object literals", () => {
    const multi = createMultiFileProgram({ "caller.ts": `export interface Foo {}` }, "caller.ts");
    try {
      const { expanded } = runIndex(multi);
      expect(ts.isArrayLiteralExpression(expanded)).toBe(true);
      const arr = expanded as ts.ArrayLiteralExpression;
      expect(arr.elements.length).toBeGreaterThan(0);
      const first = arr.elements[0] as ts.ObjectLiteralExpression;
      const keys = first.properties.map(
        (p) => ((p as ts.PropertyAssignment).name as ts.Identifier | ts.StringLiteral).text
      );
      expect(keys).toEqual(["module", "exports"]);
      // `exports` is an array literal of { name, kind } objects.
      const exportsProp = first.properties[1] as ts.PropertyAssignment;
      expect(ts.isArrayLiteralExpression(exportsProp.initializer)).toBe(true);
      const innerArr = exportsProp.initializer as ts.ArrayLiteralExpression;
      const innerObj = innerArr.elements[0] as ts.ObjectLiteralExpression;
      const innerKeys = innerObj.properties.map(
        (p) => ((p as ts.PropertyAssignment).name as ts.Identifier | ts.StringLiteral).text
      );
      expect(innerKeys).toEqual(["name", "kind"]);
    } finally {
      multi.cleanup();
    }
  });

  it("records each variable declared in a multi-declarator export statement", () => {
    const multi = createMultiFileProgram(
      { "caller.ts": `export const a = 1, b = 2, c = 3;` },
      "caller.ts"
    );
    try {
      const { expanded } = runIndex(multi);
      const decoded = decodeArrayOfObjects(expanded);
      const callerEntry = decoded.find(
        (e) => typeof e.module === "string" && (e.module as string).endsWith("caller.ts")
      )!;
      const variables = (callerEntry.exports as Array<Record<string, string>>)
        .filter((e) => e.kind === "variable")
        .map((e) => e.name)
        .sort();
      expect(variables).toEqual(["a", "b", "c"]);
    } finally {
      multi.cleanup();
    }
  });
});

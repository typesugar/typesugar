/**
 * Diagnostics / type-string / import-suggestion / cfg / source-map regressions
 * (deep review 2026-10: core #16, #25 (core side), #32, #41 (core side), #46,
 * #47, #49).
 */
import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";
import {
  DiagnosticBuilder,
  renderDiagnosticCLI,
  type DiagnosticDescriptor,
  type RichDiagnostic,
} from "../src/diagnostics.js";
import {
  extractTypeArgumentsContent,
  parseTypeInstantiation,
  splitTopLevelTypeArgs,
} from "../src/type-string-utils.js";
import { getExportIndex, generateImportFix, resetExportIndex } from "../src/import-suggestions.js";
import { evaluateConditionExpr } from "../src/ast-utils.js";
import { ExpansionTracker } from "../src/source-map.js";

const sf = ts.createSourceFile("a.ts", "const x = 1;\n", ts.ScriptTarget.Latest, true);

function build(template: string, args: Record<string, string>): string {
  const descriptor: DiagnosticDescriptor = {
    code: 9999,
    severity: "error",
    category: "test",
    messageTemplate: template,
  } as DiagnosticDescriptor;
  let out: RichDiagnostic | undefined;
  new DiagnosticBuilder(descriptor, sf, (d) => (out = d)).withArgs(args).emit();
  return out!.message;
}

describe("core #46: message interpolation is literal and single-pass", () => {
  it("does not interpret $ patterns in argument values", () => {
    expect(build("No instance found for `Eq<{type}>`", { type: "Foo$&Bar" })).toBe(
      "No instance found for `Eq<Foo$&Bar>`"
    );
    expect(build("{t}", { t: "`${string}$`" })).toBe("`${string}$`");
  });

  it("does not re-substitute a placeholder that appears inside a value", () => {
    expect(build("{a} and {b}", { a: "{b}", b: "B" })).toBe("{b} and B");
  });

  it("leaves unknown placeholders alone", () => {
    expect(build("{a} {missing}", { a: "A" })).toBe("A {missing}");
  });
});

describe("core #49: renderDiagnosticCLI", () => {
  const base = (node: ts.Node): RichDiagnostic =>
    ({
      code: 9001,
      severity: "error",
      category: "test",
      message: "boom",
      primarySpan: { node, sourceFile: sf },
      labels: [],
      notes: [],
      suggestions: [],
    }) as unknown as RichDiagnostic;

  const prev = { ...process.env };
  afterEach(() => {
    process.env = { ...prev };
  });

  it("honours colors: false even when the environment enables color", () => {
    delete process.env.NO_COLOR;
    delete process.env.TYPESUGAR_NO_COLOR;
    process.env.FORCE_COLOR = "1";
    const node = (sf.statements[0] as ts.VariableStatement).declarationList.declarations[0];
    const out = renderDiagnosticCLI(base(node), { colors: false });
    expect(out).not.toMatch(/\x1b\[/);
    expect(out).toContain("a.ts:1:7");
  });

  it("honours colors: true", () => {
    process.env.NO_COLOR = "1";
    const node = sf.statements[0];
    expect(renderDiagnosticCLI(base(node), { colors: true })).toMatch(/\x1b\[/);
  });

  it("does not crash on a synthetic primary span", () => {
    const out = renderDiagnosticCLI(base(ts.factory.createIdentifier("x")), { colors: false });
    expect(out).toContain("boom");
    expect(out).toContain("a.ts");
  });
});

describe("core #47: type-string utilities skip the > of =>", () => {
  it("extractTypeArgumentsContent", () => {
    expect(extractTypeArgumentsContent("Option<(x: number) => string>")).toBe(
      "(x: number) => string"
    );
  });

  it("parseTypeInstantiation", () => {
    expect(parseTypeInstantiation("Eq<() => void>")).toEqual({ base: "Eq", args: "() => void" });
  });

  it("splitTopLevelTypeArgs tracks () [] {} depth and =>", () => {
    expect(splitTopLevelTypeArgs("(a: A, b: B) => C, D")).toEqual(["(a: A, b: B) => C", "D"]);
    expect(splitTopLevelTypeArgs("{ a: A, b: B }, [X, Y], Map<K, V>")).toEqual([
      "{ a: A, b: B }",
      "[X, Y]",
      "Map<K, V>",
    ]);
  });

  it("existing nested-generic behaviour is unchanged", () => {
    expect(extractTypeArgumentsContent("Impl<Either<Option<A>, B>>")).toBe("Either<Option<A>, B>");
  });
});

// ---------------------------------------------------------------------------
// #32: every import suggestion must name a real export of its module.
// Checked against each package's built .d.ts (the API users import from).
// ---------------------------------------------------------------------------

const PACKAGES = path.resolve(__dirname, "../..");
const MODULE_DIRS: Record<string, string> = {
  "@typesugar/std": "std",
  "@typesugar/fp": "fp",
  "@typesugar/macros": "macros",
  typesugar: "typesugar",
};

function exportsOf(modules: string[]): Map<string, Set<string>> {
  const files = modules.map((m) => path.join(PACKAGES, MODULE_DIRS[m], "dist/index.d.ts"));
  const program = ts.createProgram(files, {
    noEmit: true,
    skipLibCheck: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
  });
  const checker = program.getTypeChecker();
  const out = new Map<string, Set<string>>();
  modules.forEach((m, i) => {
    const file = program.getSourceFile(files[i])!;
    const sym = checker.getSymbolAtLocation(file)!;
    out.set(m, new Set(checker.getExportsOfModule(sym).map((s) => s.name)));
  });
  return out;
}

describe("core #32: import-suggestion table names real exports", () => {
  afterEach(() => resetExportIndex());

  const index = getExportIndex();
  const modules = [...index.byModule.keys()];
  const built = modules.every((m) =>
    fs.existsSync(path.join(PACKAGES, MODULE_DIRS[m] ?? "__none__", "dist/index.d.ts"))
  );

  it.skipIf(!built)(
    "every default entry is exported by its module",
    () => {
      expect(modules.every((m) => m in MODULE_DIRS)).toBe(true);
      const exports = exportsOf(modules);
      const missing: string[] = [];
      for (const [mod, entries] of index.byModule) {
        for (const e of entries) {
          if (!exports.get(mod)!.has(e.name)) missing.push(`${e.name} from ${mod}`);
        }
      }
      expect(missing).toEqual([]);
    },
    60_000
  );
});

describe("core #25 (core side): generateImportFix keeps the directive prologue first", () => {
  const suggestion = { importStatement: 'import { Eq } from "@typesugar/std";' } as never;

  it("inserts after 'use client' when the file has no imports", () => {
    const file = ts.createSourceFile(
      "c.tsx",
      '"use client";\nexport const x = 1;\n',
      ts.ScriptTarget.Latest,
      true
    );
    const fix = generateImportFix(file, suggestion);
    const out = file.text.slice(0, fix.range.start) + fix.text + file.text.slice(fix.range.end);
    expect(out.startsWith('"use client";')).toBe(true);
    expect(out).toContain('import { Eq } from "@typesugar/std";');
    const reparsed = ts.createSourceFile("o.tsx", out, ts.ScriptTarget.Latest, true);
    const first = reparsed.statements[0];
    expect(ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression)).toBe(true);
  });
});

describe("core #16: cfg conditions with === / !==", () => {
  it("platform === 'node' is true for { platform: 'node' }", () => {
    expect(evaluateConditionExpr("platform === 'node'", { platform: "node" })).toBe(true);
  });

  it("!== and || work", () => {
    const cfg = { platform: "node", env: "prod" };
    expect(evaluateConditionExpr("env !== 'dev'", cfg)).toBe(true);
    expect(evaluateConditionExpr("platform === 'web' || platform === 'node'", cfg)).toBe(true);
    expect(evaluateConditionExpr("platform == 'node' && !debug", cfg)).toBe(true);
  });

  it("an unsupported condition throws instead of silently being false", () => {
    expect(() => evaluateConditionExpr("platform ~= 'node'", { platform: "node" })).toThrow();
  });
});

describe("core #41 (core side): expanded code and its source map come as a pair", () => {
  it("generateExpandedCodeWithMap returns the text the map describes", () => {
    const tracker = new ExpansionTracker();
    const src = "const a = 1;\n\nconst b = mac(1);\n";
    const file = ts.createSourceFile("a.ts", src, ts.ScriptTarget.Latest, true);
    const call = (file.statements[1] as ts.VariableStatement).declarationList.declarations[0]
      .initializer!;
    tracker.recordExpansion("mac", call, file, "42");
    const pair = tracker.generateExpandedCodeWithMap(src, "a.ts");
    expect(pair).not.toBeNull();
    expect(pair!.code).toBe("const a = 1;\n\nconst b = 42;\n");
    expect(pair!.map.mappings.length).toBeGreaterThan(0);
  });
});

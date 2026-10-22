/**
 * End-to-end tests for the `grammar` tagged-template macro: run the real
 * transformer over a source file, then execute the emitted code.
 */
import { describe, it, expect } from "vitest";
import * as path from "path";
import * as ts from "typescript";
import { grammarMacro } from "../macros.js";
import * as parserRuntime from "../index.js";
// @ts-ignore -- the transformer is not a dependency of this package; load its built pipeline directly
import { transformCode } from "../../../transformer/dist/pipeline.js";

const FILE = path.resolve(__dirname, "../../__grammar_macro_input.ts");

function expand(src: string): { code: string; diagnostics: string[] } {
  const r = transformCode(src, { fileName: FILE });
  return {
    code: r.code,
    diagnostics: (r.diagnostics ?? []).map((d: any) =>
      typeof d.message === "string"
        ? d.message
        : ts.flattenDiagnosticMessageText(d.messageText, "\n")
    ),
  };
}

function run(code: string): Record<string, any> {
  const js = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} as Record<string, any> };
  const req = (id: string) => {
    if (id === "@typesugar/parser") return parserRuntime;
    throw new Error("unexpected require: " + id);
  };
  new Function("require", "module", "exports", js)(req, mod, mod.exports);
  return mod.exports;
}

const IDENT = `import { grammar } from "@typesugar/parser";
export const g = grammar\`
  ident  = letter (letter | digit)*
  letter = 'a'..'z' | 'A'..'Z' | '_'
  digit  = '0'..'9'
\`;
`;

/** Type errors in `code` under strict (`@typesugar/parser` resolved to this package's src). */
function typeErrors(code: string): string[] {
  const fileName = path.resolve(__dirname, "../../__grammar_macro_typecheck.ts");
  const pkgDir = path.resolve(__dirname, "../..");
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
    baseUrl: pkgDir,
    paths: { "@typesugar/parser": ["src/index.ts"] },
  };
  const host = ts.createCompilerHost(options);
  const read = host.getSourceFile.bind(host);
  host.getSourceFile = (f, v, ...rest) =>
    path.resolve(f) === fileName ? ts.createSourceFile(f, code, v, true) : read(f, v, ...rest);
  const exists = host.fileExists.bind(host);
  host.fileExists = (f) => path.resolve(f) === fileName || exists(f);
  const program = ts.createProgram([fileName], options, host);
  return ts
    .getPreEmitDiagnostics(program, program.getSourceFile(fileName))
    .map((d) => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
}

describe("grammar macro: the expansion type-checks (check --strict)", () => {
  // The generated parser's functions had untyped parameters (TS7006 for
  // every `input`/`pos`/`value`), `var best = null` read as `never`
  // (TS2339 on `best.pos`), and `parse(input, pos)` required `pos` (TS2554
  // for `p.parse("x")`): 75 errors in parser's grammar.test.ts.
  it("has no type errors, and parse's position is optional", () => {
    const { code, diagnostics } = expand(`import { grammar } from "@typesugar/parser";
export const g = grammar\`
  start  = "(" item+ ")" | !"x" digit* | "y"?
  item   = letter (letter | digit)*
  letter = 'a'..'z'
  digit  = '0'..'9'
\`;
export const r = g.parse("(ab1)");
`);
    expect(diagnostics).toEqual([]);
    expect(typeErrors(code)).toEqual([]);
    expect(run(code).r.ok).toBe(true);
  });
});

describe("grammar macro: AST codegen (TSP-8)", () => {
  it("expands to an inline parser that works at runtime", () => {
    const { code, diagnostics } = expand(IDENT);
    expect(diagnostics).toEqual([]);
    expect(code).not.toContain("grammar`");
    const { g } = run(code);
    expect(g.startRule).toBe("ident");
    expect(g.parse("hello_42").ok).toBe(true);
    expect(g.parse("hello_42").pos).toBe(8);
    expect(() => g.parseAll("42nope")).toThrow(/line 1, col 1/);
    expect(g.rules.get("digit")).toEqual({ type: "charRange", from: "0", to: "9" });
  });

  it("builds the expansion without string->AST parsing", () => {
    const sf = ts.createSourceFile(
      "t.ts",
      'grammar`a = "x" b\nb = "y"*`',
      ts.ScriptTarget.Latest,
      true
    );
    const node = (sf.statements[0] as ts.ExpressionStatement)
      .expression as ts.TaggedTemplateExpression;
    const errors: string[] = [];
    const ctx: any = {
      factory: ts.factory,
      sourceFile: sf,
      parseExpression: () => {
        throw new Error("parseExpression must not be called");
      },
      parseStatements: () => {
        throw new Error("parseStatements must not be called");
      },
      reportError: (_n: ts.Node, m: string) => errors.push(m),
      reportWarning: (_n: ts.Node, m: string) => errors.push(m),
      ensureImport: (name: string) => ts.factory.createIdentifier(name),
    };
    const out = grammarMacro.expand(ctx, node);
    expect(errors).toEqual([]);
    const printed = ts
      .createPrinter()
      .printNode(
        ts.EmitHint.Expression,
        out,
        ts.createSourceFile("o.ts", "", ts.ScriptTarget.Latest)
      );
    // TypeScript (its parameters are typed): transpiled before it is run.
    const js = ts.transpileModule(`module.exports = ${printed};`, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const mod = { exports: {} as any };
    new Function("module", "exports", js)(mod, mod.exports);
    const g = mod.exports;
    expect(g.parseAll("xyy")).toEqual(["x", ["y", "y"]]);
  });
});

describe("grammar macro: interpolation (TSP-9)", () => {
  it("reports one clear 'not supported' error and no fallback", () => {
    const { code, diagnostics } = expand(`import { grammar } from "@typesugar/parser";
const y = '"y"';
export const g = grammar\`a = "x" \${y}\`;
`);
    expect(diagnostics.some((m) => /interpolation.*not supported/i.test(m))).toBe(true);
    expect(diagnostics.some((m) => /Invalid grammar/.test(m))).toBe(false);
    expect(diagnostics.some((m) => /falling back/i.test(m))).toBe(false);
    expect(code).not.toContain("__typesugar_parser");
  });
});

describe("docs B#21 / W#24: the inlined grammar throws ParseError", () => {
  it("parseAll failures are ParseError instances with pos/expected/line/col", () => {
    const { code, diagnostics } = expand(IDENT);
    expect(diagnostics).toEqual([]);
    const { g } = run(code);
    let err: any;
    try {
      g.parseAll("42nope");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(parserRuntime.ParseError);
    expect(err.pos).toBe(0);
    expect(err.expected).toBe("'a'..'z'");
    expect(err.line).toBe(1);
    expect(err.col).toBe(1);

    let tail: any;
    try {
      g.parseAll("ab\n!");
    } catch (e) {
      tail = e;
    }
    expect(tail).toBeInstanceOf(parserRuntime.ParseError);
    expect(tail.expected).toBe("end of input");
    expect([tail.pos, tail.line, tail.col]).toEqual([2, 1, 3]);
  });

  it("an existing ParseError binding in the file is not shadowed", () => {
    const { code, diagnostics } = expand(
      IDENT.replace("import { grammar }", "import { grammar, ParseError }") +
        `export const isPE = (e: unknown) => e instanceof ParseError;\n`
    );
    expect(diagnostics).toEqual([]);
    const { g, isPE } = run(code);
    expect(() => g.parseAll("42")).toThrow(parserRuntime.ParseError);
    try {
      g.parseAll("42");
    } catch (e) {
      expect(isPE(e)).toBe(true);
    }
  });
});

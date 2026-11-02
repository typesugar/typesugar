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
    const g = new Function(`return ${printed}`)();
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

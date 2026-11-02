/**
 * Review finding macros-other #4: validator<T>() generated checks.
 *
 * Runs the generated validator against real values. Before the fix:
 * literal unions / enums / `boolean | undefined` were skipped silently;
 * methods were rejected (required `typeof === "object"`); `string | null`
 * rejected null; a `"first-name"` key emitted `value.first-name` (invalid JS);
 * and the non-object error read "Expected object, got object".
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { createMacroContext } from "@typesugar/core";
import { validatorMacro } from "./reflect.js";

type Result = { success: true; value: unknown } | { success: false; errors: string[] };

function buildValidator(source: string): {
  validate: (v: unknown) => Result;
  warnings: string[];
  printed: string;
} {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "validator-test-"));
  const filePath = path.join(tmpDir, "test.ts");
  fs.writeFileSync(filePath, `declare function validator<T>(): any;\n${source}`);
  try {
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      strict: true,
      noEmit: true,
    };
    const program = ts.createProgram([filePath], options, ts.createCompilerHost(options));
    const sf = program.getSourceFile(filePath)!;
    let call: ts.CallExpression | undefined;
    const find = (n: ts.Node): void => {
      if (call) return;
      if (
        ts.isCallExpression(n) &&
        ts.isIdentifier(n.expression) &&
        n.expression.text === "validator"
      ) {
        call = n;
        return;
      }
      n.forEachChild(find);
    };
    sf.forEachChild(find);
    let printed = "";
    let warnings: string[] = [];
    ts.transform(sf, [
      (tctx) => {
        const ctx = createMacroContext(program, sf, tctx);
        const out = validatorMacro.expand(ctx, call!, call!.arguments);
        printed = ts.createPrinter().printNode(ts.EmitHint.Expression, out, sf);
        warnings = ctx
          .getDiagnostics()
          .filter((d) => d.severity === "warning")
          .map((d) => d.message);
        return (s) => s;
      },
    ]);
    // Bind to a name and return that, rather than `return ${js}`: TypeScript 6
    // prefixes the output with a "use strict"; directive, which `return` would
    // have returned instead of the expression.
    const js = ts.transpileModule(`const __value = (${printed});`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const validate = new Function(`${js}\nreturn __value;`)() as (v: unknown) => Result;
    return { validate, warnings, printed };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

const SOURCE = `
enum Role { A = "a", B = "b" }
enum Level { Low, High }
interface U {
  "first-name": string;
  kind: "admin" | "user";
  active?: boolean;
  flag: boolean | undefined;
  nick: string | null;
  greet(): string;
  role: Role;
  level: Level;
  tags: string[];
  n: 1 | 2;
}
export const v = validator<U>();
`;

const good = {
  "first-name": "Ann",
  kind: "admin",
  flag: undefined,
  nick: null,
  greet: () => "hi",
  role: "a",
  level: 1,
  tags: [],
  n: 2,
};

describe("validator<T>() generated checks", () => {
  const { validate, printed } = buildValidator(SOURCE);

  it("accepts a valid value (methods, null variants, literal/enum members, odd keys)", () => {
    expect(validate(good)).toEqual({ success: true, value: good });
  });

  it("uses element access for non-identifier keys", () => {
    expect(printed).toContain(`(value as Record<string, unknown>)["first-name"]`);
    expect(validate({ ...good, "first-name": 5 }).success).toBe(false);
  });

  it("checks literal unions with ===", () => {
    const r = validate({ ...good, kind: "root" });
    expect(r.success).toBe(false);
    expect((r as { errors: string[] }).errors.join()).toContain("'kind'");
  });

  it("checks string and numeric enums", () => {
    expect(validate({ ...good, role: "z" }).success).toBe(false);
    expect(validate({ ...good, level: 7 }).success).toBe(false);
  });

  it("checks boolean | undefined and optional boolean", () => {
    expect(validate({ ...good, flag: "yes" }).success).toBe(false);
    expect(validate({ ...good, active: "yes" }).success).toBe(false);
    expect(validate({ ...good, active: true }).success).toBe(true);
  });

  it("accepts null for string | null but rejects other types", () => {
    expect(validate({ ...good, nick: "n" }).success).toBe(true);
    expect(validate({ ...good, nick: 3 }).success).toBe(false);
  });

  it("requires methods to be functions", () => {
    expect(validate({ ...good, greet: "hi" }).success).toBe(false);
  });

  it("checks numeric literal unions", () => {
    expect(validate({ ...good, n: 3 }).success).toBe(false);
  });

  it("reports the actual type for a non-object input", () => {
    expect(validate(null)).toEqual({ success: false, errors: ["Expected object, got null"] });
    expect(validate(5)).toEqual({ success: false, errors: ["Expected object, got number"] });
  });
});

describe("validator<T>() unsupported field types", () => {
  it("warns instead of silently skipping", () => {
    const { warnings, validate } = buildValidator(`
      interface A { a: number } interface B { b: string }
      export function mk<T>() { return validator<{ g: T; both: A & B; x: number }>(); }
    `);
    expect(warnings.some((w) => w.includes("'g'"))).toBe(true);
    // object intersections are checked as objects, not skipped
    expect(warnings.some((w) => w.includes("'both'"))).toBe(false);
    expect(validate({ g: 1, both: 5, x: 1 }).success).toBe(false);
  });
});

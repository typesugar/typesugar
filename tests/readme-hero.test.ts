/**
 * The README hero example (the first ```typescript block in README.md) must
 * actually work: run it through the real transformer, transpile, EXECUTE it,
 * and check every expression statement evaluates to what its trailing comment
 * claims.
 *
 * Regression: derived `Ord` used to emit only `compare`, while the `<` operator
 * rewrite produces `User.Ord.lessThan(alice, bob)` — a runtime
 * "lessThan is not a function" on the very first example a user sees.
 */

import { describe, it, expect } from "vitest";
import { transformCode } from "@typesugar/transformer";
import "@typesugar/macros";
import "@typesugar/std";
import * as ts from "typescript";
import * as fs from "fs";
import * as path from "path";
import * as vm from "vm";

const ROOT = path.resolve(__dirname, "..");

function heroExample(): string {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf-8");
  const m = readme.match(/```typescript\n([\s\S]*?)```/);
  if (!m) throw new Error("README.md has no ```typescript block");
  return m[1];
}

/**
 * Replace each top-level expression statement `e;` with `__results.push(e);`
 * (AST transform) so the values the README comments describe can be checked.
 */
function captureExpressionStatements(js: string): string {
  const sf = ts.createSourceFile("hero.js", js, ts.ScriptTarget.ES2020, true);
  const f = ts.factory;
  const statements = sf.statements.flatMap((s): ts.Statement[] => {
    if (ts.isImportDeclaration(s)) return [];
    // Skip the `(function (User) { ... })(User || (User = {}))` IIFEs that
    // transpiled companion namespaces become.
    const isNamespaceIife =
      ts.isExpressionStatement(s) &&
      ts.isCallExpression(s.expression) &&
      ts.isParenthesizedExpression(s.expression.expression) &&
      ts.isFunctionExpression(s.expression.expression.expression);
    if (ts.isExpressionStatement(s) && !isNamespaceIife) {
      return [
        f.createExpressionStatement(
          f.createCallExpression(
            f.createPropertyAccessExpression(f.createIdentifier("__results"), "push"),
            undefined,
            [s.expression]
          )
        ),
      ];
    }
    return [s];
  });
  return ts.createPrinter().printFile(f.updateSourceFile(sf, statements));
}

describe("README hero example", () => {
  it("transforms, executes, and every line does what its comment says", () => {
    const source = heroExample();
    const result = transformCode(source, { fileName: path.join(ROOT, "__readme_hero__.ts") });
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    expect(errors.map((d) => d.message)).toEqual([]);

    const js = ts.transpileModule(result.code, {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
    }).outputText;

    const results: unknown[] = [];
    vm.runInNewContext(captureExpressionStatements(js), { __results: results });

    const [eq, lt, cloned, json] = results;
    expect(results).toHaveLength(4);
    const alice = { id: 1, name: "Alice", email: "alice@example.com" };
    // alice === bob; // false
    expect(eq).toBe(false);
    // alice < bob; // true  (lexicographic field comparison)
    expect(lt).toBe(true);
    // alice.clone(); // deep copy
    expect(cloned).toEqual(alice);
    // alice.toJson(); // JSON serialization
    expect(json).toEqual(alice);
  });

  it("derived Ord provides every Ord method, consistent with compare (product and sum)", () => {
    const source = `
import { derive, Ord } from "typesugar";
import "@typesugar/std/syntax/ord/ops";

@derive(Ord)
interface P { x: number; y: string; }

@derive(Ord)
type Shape = { kind: "circle"; r: number } | { kind: "square"; s: number };

const a: P = { x: 1, y: "b" };
const b: P = { x: 1, y: "c" };
a < b;
a <= b;
a > b;
a >= b;
P.Ord.equals(a, a);
P.Ord.notEquals(a, b);
P.Ord.compare(b, a);
const c1: Shape = { kind: "circle", r: 5 };
const c2: Shape = { kind: "circle", r: 2 };
const sq: Shape = { kind: "square", s: 1 };
// (Called directly: assignment narrowing gives c1/sq their variant types,
// so the operator lookup would not see the union's instance.)
Shape.Ord.lessThan(c1, sq);
Shape.Ord.greaterThan(c1, c2);
Shape.Ord.greaterThanOrEqual(sq, c1);
`;
    const result = transformCode(source, { fileName: path.join(ROOT, "__readme_ord__.ts") });
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    expect(errors.map((d) => d.message)).toEqual([]);
    const js = ts.transpileModule(result.code, {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
    }).outputText;
    const results: unknown[] = [];
    vm.runInNewContext(captureExpressionStatements(js), { __results: results });
    expect(results).toEqual([true, true, false, false, true, true, 1, true, true, true]);
  });
});

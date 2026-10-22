/**
 * specialization.ts's constant check (`nothingEvaluatedBeforeIn`): when the
 * checker fails on a name read before an inlined call, the name is taken as
 * not constant (nothing is moved before the statement) and the failure is
 * reported, not swallowed (CLAUDE.md; review 8).
 */
import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

import { nothingEvaluatedBeforeIn } from "../src/specialization.js";

describe("nothingEvaluatedBeforeIn", () => {
  it("reports a checker failure on a name it then treats as not constant", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hoist-constant-"));
    try {
      const file = path.join(dir, "t.ts");
      fs.writeFileSync(
        file,
        `const k = 1;\ndeclare function f(): number;\nexport const r = k + f();\n`
      );
      const program = ts.createProgram([file], { strict: true, noEmit: true, types: [] });
      const sf = program.getSourceFile(file)!;
      const real = program.getTypeChecker();
      const checker = new Proxy(real, {
        get(target, prop) {
          const value = Reflect.get(target, prop);
          if (prop === "getSymbolAtLocation") {
            return () => {
              throw new Error("boom");
            };
          }
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const anchor = sf.statements[2];
      let call: ts.CallExpression | undefined;
      const visit = (n: ts.Node): void => {
        if (ts.isCallExpression(n)) call = n;
        else ts.forEachChild(n, visit);
      };
      visit(anchor);
      const failures: string[] = [];
      expect(nothingEvaluatedBeforeIn(anchor, call!, real)).toBe(true); // `k` is a const
      expect(
        nothingEvaluatedBeforeIn(anchor, call!, checker, (n, e) =>
          failures.push(`${(n as ts.Identifier).text}: ${e}`)
        )
      ).toBe(false);
      expect(failures).toEqual(["k: Error: boom"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

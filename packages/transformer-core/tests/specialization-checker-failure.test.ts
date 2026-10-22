/**
 * specialization.ts: a caught checker failure that skips a specialization
 * is reported once, at the call (CLAUDE.md; review 8). The mechanism is
 * `warnCheckerFailure`; it is driven here through return-type-driven
 * specialization, whose type lookup used to fail silently, with a checker
 * wrapped to throw. `resolveAutoSpecFunctionBody` tells its caller the same
 * way.
 */
import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { createMacroContext, type MacroContextImpl } from "@typesugar/core";
import { SpecializationCache } from "@typesugar/macros";

import {
  resolveAutoSpecFunctionBody,
  tryReturnTypeDrivenSpecialize,
} from "../src/specialization.js";

const SOURCE = `declare function parse(s: string): number;
export const a = parse("1");
export const b = parse("2");
`;

function withFixture<T>(
  run: (program: ts.Program, sf: ts.SourceFile, calls: ts.CallExpression[]) => T
): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-checker-failure-"));
  try {
    const file = path.join(dir, "t.ts");
    fs.writeFileSync(file, SOURCE);
    const program = ts.createProgram([file], { strict: true, noEmit: true, types: [] });
    const sf = program.getSourceFile(file)!;
    const calls: ts.CallExpression[] = [];
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) calls.push(n);
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return run(program, sf, calls);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** `program` whose checker throws from `method`. */
function throwingProgram(program: ts.Program, method: keyof ts.TypeChecker): ts.Program {
  const real = program.getTypeChecker();
  const checker = new Proxy(real, {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      if (prop === method) {
        return () => {
          throw new Error(`boom-${String(method)}`);
        };
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return new Proxy(program, {
    get(target, prop) {
      if (prop === "getTypeChecker") return () => checker;
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function warningsOf(
  program: ts.Program,
  sf: ts.SourceFile,
  run: (ctx: MacroContextImpl) => void
): string[] {
  let warnings: string[] = [];
  ts.transform(sf, [
    (transformContext) => {
      const ctx = createMacroContext(program, sf, transformContext);
      run(ctx);
      warnings = ctx
        .getDiagnostics()
        .filter((d) => d.severity === "warning")
        .map((d) => d.message);
      return (s) => s;
    },
  ]);
  return warnings;
}

describe("specialization: a caught checker failure warns, once per call", () => {
  it("return-type-driven specialization of a call whose type the checker can't read", () => {
    withFixture((program, sf, calls) => {
      expect(
        warningsOf(program, sf, (ctx) =>
          calls.forEach((c) =>
            tryReturnTypeDrivenSpecialize(ctx, false, new SpecializationCache(), c)
          )
        )
      ).toEqual([]);
      const warnings = warningsOf(throwingProgram(program, "getTypeAtLocation"), sf, (ctx) => {
        for (const c of [...calls, calls[0]]) {
          expect(tryReturnTypeDrivenSpecialize(ctx, false, new SpecializationCache(), c)).toBe(
            undefined
          );
        }
      });
      // One per call, the repeat of the first not again.
      expect(warnings).toEqual([
        "typesugar skipped return-type-driven specialization of this call: the type checker failed (Error: boom-getTypeAtLocation).",
        "typesugar skipped return-type-driven specialization of this call: the type checker failed (Error: boom-getTypeAtLocation).",
      ]);
    });
  });

  it("resolveAutoSpecFunctionBody tells its caller when the checker fails", () => {
    withFixture((program, _sf, calls) => {
      const failures: unknown[] = [];
      const checker = throwingProgram(program, "getSymbolAtLocation").getTypeChecker();
      expect(
        resolveAutoSpecFunctionBody(checker, calls[0].expression, (e) => failures.push(e))
      ).toBeUndefined();
      expect(String(failures[0])).toBe("Error: boom-getSymbolAtLocation");
    });
  });
});

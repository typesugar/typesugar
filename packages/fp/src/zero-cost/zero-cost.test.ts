/**
 * Packaging + zero-cost macro regression tests (deep-review findings #8, #9, #19).
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import * as ts from "typescript";
import { zeroCostOptionMacro, zeroCostResultMacro } from "./macros.js";
import { ZeroCostOptionOps, ZeroCostResultOps } from "./index.js";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dist = path.join(pkgDir, "dist");
const built = existsSync(path.join(dist, "index.cjs")) && existsSync(path.join(dist, "macros.cjs"));

function nodeIn(cwd: string, code: string): string {
  return execFileSync(process.execPath, ["-e", code], { cwd, encoding: "utf8" });
}

describe("runtime barrel does not load the compiler (#8)", () => {
  it.runIf(built)("require('@typesugar/fp') loads neither typescript nor @typesugar/core", () => {
    const out = nodeIn(
      pkgDir,
      `require(${JSON.stringify(path.join(dist, "index.cjs"))});
       const ks = Object.keys(require.cache);
       console.log(JSON.stringify({
         ts: ks.filter((k) => /[\\\\/]typescript[\\\\/]/.test(k)).length,
         core: ks.filter((k) => /[\\\\/]core[\\\\/]dist[\\\\/]/.test(k)).length,
         cosmiconfig: ks.filter((k) => /cosmiconfig/.test(k)).length,
       }));`
    );
    expect(JSON.parse(out)).toEqual({ ts: 0, core: 0, cosmiconfig: 0 });
  });

  it.runIf(built)(
    "loading the manifest's macros entry registers the zero-cost macros and the Show marker",
    () => {
      const manifest = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8")).typesugar
        .macros as string;
      expect(manifest).toBe("./macros");
      const out = nodeIn(
        pkgDir,
        `const core = require("@typesugar/core");
         require(${JSON.stringify(path.join(dist, "macros.cjs"))});
         console.log(JSON.stringify({
           opt: !!core.globalRegistry.getExpression("ZeroCostOptionOps"),
           res: !!core.globalRegistry.getExpression("ZeroCostResultOps"),
           show: !!core.getSyntaxMarkerFallback("@typesugar/fp/syntax/show"),
         }));`
      );
      expect(JSON.parse(out)).toEqual({ opt: true, res: true, show: true });
    }
  );

  it("package.json marks only the macro entries as side-effectful", () => {
    const pkg = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8"));
    expect(Array.isArray(pkg.sideEffects)).toBe(true);
    expect(pkg.sideEffects.every((p: string) => p.includes("macros"))).toBe(true);
  });
});

describe("./effect export (#9)", () => {
  it("every exports target that names a concrete file exists after build", () => {
    const pkg = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8"));
    for (const [key, target] of Object.entries(pkg.exports as Record<string, unknown>)) {
      if (key.includes("*")) continue;
      const t = target as Record<string, string>;
      for (const cond of ["import", "require"]) {
        if (built) expect([key, existsSync(path.join(pkgDir, t[cond]))]).toEqual([key, true]);
      }
    }
    expect(pkg.exports["./effect"]).toBeUndefined();
  });
});

describe("zero-cost Option macro (#19)", () => {
  const sf = (code: string) => ts.createSourceFile("x.ts", code, ts.ScriptTarget.Latest, true);
  const firstCall = (code: string): ts.CallExpression => {
    const stmt = sf(code).statements[0] as ts.ExpressionStatement;
    return stmt.expression as ts.CallExpression;
  };
  const ctx = { factory: ts.factory } as never;
  const print = (n: ts.Node) => ts.createPrinter().printNode(ts.EmitHint.Expression, n, sf(""));

  it("does not expand method chains (which duplicated the receiver per step)", () => {
    const call = firstCall("ZeroCostOptionOps.from(load()).map(f).map(g).unwrapOr(0);");
    const out = zeroCostOptionMacro.expand(ctx, call, call.arguments);
    expect(out).toBe(call);
  });

  it("inlines single-use forms, evaluating the argument once", () => {
    const from = firstCall("ZeroCostOptionOps.from(load());");
    expect(print(zeroCostOptionMacro.expand(ctx, from, from.arguments))).toBe("load() ?? null");
    const isSome = firstCall("ZeroCostOptionOps.isSome(load());");
    expect(print(zeroCostOptionMacro.expand(ctx, isSome, isSome.arguments))).toBe("load() != null");
    const ok = firstCall("ZeroCostResultOps.isOk(r);");
    expect(print(zeroCostResultMacro.expand(ctx, ok, ok.arguments))).toBe("r.ok");
  });

  it("runtime ops agree with the macro semantics", () => {
    expect(ZeroCostOptionOps.from(undefined)).toBeNull();
    expect(ZeroCostOptionOps.isSome(0)).toBe(true);
    expect(ZeroCostResultOps.isOk(ZeroCostResultOps.ok(1))).toBe(true);
  });
});

/**
 * 2026-10 deep review (findings-macros-typeclass) — unit-level regressions
 * that need a hand-built MacroContext:
 *
 * - #6: the disk-cache key for a derivation includes the type's name, so two
 *   structurally identical types (Point / Vec2) don't share `Show` output.
 * - #19: collectTypes emits caller-relative `/` module paths (never absolute
 *   build paths) and `@name` matches JSDoc tags as well as decorators.
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createMacroContext, MacroExpansionCache } from "@typesugar/core";
import type { MacroContext } from "@typesugar/core";
import { tryDeriveViaGeneric } from "./auto-derive.js";
import { collectTypesMacro } from "./module-graph.js";

function withProgram<T>(
  files: Record<string, string>,
  caller: string,
  fn: (ctx: MacroContext, dir: string) => T
): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tc-review-"));
  try {
    const abs: string[] = [];
    for (const [rel, src] of Object.entries(files)) {
      const p = path.join(dir, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, src);
      abs.push(p);
    }
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
    };
    const host = ts.createCompilerHost(options);
    const orig = host.getSourceFile.bind(host);
    // setParentNodes so JSDoc tags are visible
    host.getSourceFile = (f, lv, ...r) => {
      const sf = orig(f, lv, ...r);
      return sf && abs.includes(f) ? ts.createSourceFile(f, sf.text, lv, true) : sf;
    };
    const program = ts.createProgram(abs, options, host);
    const sourceFile = program.getSourceFile(path.join(dir, caller))!;
    let result!: T;
    ts.transform(sourceFile, [
      (tc) => {
        result = fn(createMacroContext(program, sourceFile, tc), dir);
        return (sf) => sf;
      },
    ]);
    return result;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const print = (e: ts.Expression) =>
  ts.createPrinter().printNode(ts.EmitHint.Expression, e, ts.createSourceFile("x.ts", "", 99));

describe("#6 derivation disk cache key includes the type name", () => {
  it("Show<Vec2> doesn't reuse Show<Point>'s cached output", () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "tc-review-cache-"));
    try {
      const cache = new MacroExpansionCache(cacheDir);
      const derive = (decl: string, name: string) =>
        withProgram({ "a.ts": `${decl}\nexport {};` }, "a.ts", (ctx) => {
          (ctx as { expansionCache?: MacroExpansionCache }).expansionCache = cache;
          const r = tryDeriveViaGeneric(ctx, "Show", name);
          return r.expression ? print(r.expression) : null;
        });
      expect(derive("interface Point { x: number }", "Point")).toContain("Point(");
      const vec = derive("interface Vec2 { x: number }", "Vec2");
      expect(vec).toContain("Vec2(");
      expect(vec).not.toContain("Point(");
    } finally {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    }
  });
});

describe("#19 collectTypes module paths and JSDoc tags", () => {
  function collect(pattern: string) {
    return withProgram(
      {
        "caller.ts": `export const x = 1;`,
        "models/user.ts": `/** @entity */\nexport interface User { id: number }\nexport interface Other {}`,
      },
      "caller.ts",
      (ctx, dir) => {
        const call = ts.factory.createCallExpression(
          ts.factory.createIdentifier("collectTypes"),
          undefined,
          [ts.factory.createStringLiteral(pattern)]
        );
        const out = collectTypesMacro.expand(
          ctx,
          call,
          call.arguments
        ) as ts.ArrayLiteralExpression;
        const rows = out.elements.map((el) => {
          const o: Record<string, string> = {};
          for (const p of (el as ts.ObjectLiteralExpression).properties) {
            const pa = p as ts.PropertyAssignment;
            if (ts.isStringLiteral(pa.initializer))
              o[(pa.name as ts.Identifier).text] = pa.initializer.text;
          }
          return o;
        });
        return { rows, dir };
      }
    );
  }

  it("emits caller-relative, '/'-separated module paths", () => {
    const { rows, dir } = collect("models/*.ts");
    const user = rows.find((r) => r.name === "User")!;
    expect(user.module).toBe("models/user.ts");
    expect(rows.every((r) => !r.module.startsWith("/") && !r.module.includes(dir))).toBe(true);
  });

  it("'@entity' matches a JSDoc @entity tag", () => {
    const { rows } = collect("@entity");
    expect(rows.map((r) => r.name)).toEqual(["User"]);
  });
});

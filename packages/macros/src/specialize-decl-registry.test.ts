/**
 * `@impl` / `impl()` register instance methods for specialization keyed by
 * the DECLARATION as well as by bare name, so two unrelated same-named
 * instances (different files) stay distinguishable on the fallback path.
 * The name-keyed entry is last-writer-wins.
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createMacroContext } from "@typesugar/core";
import type { MacroContext } from "@typesugar/core";
import { implAttribute, implMacro } from "./typeclass.js";
import { getInstanceMethods, getInstanceMethodsForDeclaration } from "./specialize.js";

function withProgram(files: Record<string, string>, fn: (program: ts.Program) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-decl-"));
  try {
    const abs = Object.entries(files).map(([rel, src]) => {
      const p = path.join(dir, rel);
      fs.writeFileSync(p, src);
      return p;
    });
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      strict: true,
      noEmit: true,
    };
    fn(ts.createProgram(abs, options));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function inContext(program: ts.Program, sf: ts.SourceFile, fn: (ctx: MacroContext) => void) {
  ts.transform(sf, [
    (tc) => {
      fn(createMacroContext(program, sf, tc));
      return (s) => s;
    },
  ]);
}

function firstVarDecl(sf: ts.SourceFile): ts.VariableDeclaration {
  const stmt = sf.statements.find(ts.isVariableStatement)!;
  return stmt.declarationList.declarations[0];
}

const bodyText = (n: ts.Node | undefined) => (n ? n.getText() : undefined);

describe("registerInstanceMethodsFromAST — declaration identity", () => {
  it("impl(): same-named instances in two files are kept apart by declaration", () => {
    const src = (body: string) =>
      `interface Eq<A> { equals(a: A, b: A): boolean }\n` +
      `declare function impl<T>(d: string, o: T): T;\n` +
      `const eqThing = impl("Eq<Thing>", { equals: (a: number, b: number) => ${body} });\n`;
    withProgram({ "a.ts": src("a === b"), "b.ts": src("a !== b") }, (program) => {
      const decls: ts.VariableDeclaration[] = [];
      for (const f of ["a.ts", "b.ts"]) {
        const sf = program.getSourceFiles().find((s) => s.fileName.endsWith(`/${f}`))!;
        const decl = firstVarDecl(sf);
        decls.push(decl);
        const call = decl.initializer as ts.CallExpression;
        inContext(program, sf, (ctx) => implMacro.expand(ctx, call, call.arguments));
      }
      const [a, b] = decls.map((d) => getInstanceMethodsForDeclaration(d));
      expect(bodyText(a?.methods.get("equals")?.node)).toContain("a === b");
      expect(bodyText(b?.methods.get("equals")?.node)).toContain("a !== b");
      // The name-keyed entry can only hold one of them.
      expect(getInstanceMethods("eqThing", program)).toBe(b);
    });
  });

  it("@impl: registers by the decorated declaration", () => {
    const code =
      `interface Eq<A> { equals(a: A, b: A): boolean }\n` +
      `interface Thing { n: number }\n` +
      `const eqThingAttr: Eq<Thing> = { equals: (a, b) => a.n === b.n };\n`;
    withProgram({ "c.ts": code }, (program) => {
      const sf = program.getSourceFiles().find((s) => s.fileName.endsWith("/c.ts"))!;
      const stmt = sf.statements.find(ts.isVariableStatement)!;
      inContext(program, sf, (ctx) => {
        const dec = ctx.factory.createDecorator(ctx.factory.createIdentifier("impl"));
        implAttribute.expand(ctx, dec, stmt as unknown as ts.Declaration, [
          ctx.factory.createStringLiteral("Eq<Thing>"),
        ]);
      });
      const entry = getInstanceMethodsForDeclaration(firstVarDecl(sf));
      expect(entry?.brand).toBe("Thing");
      expect(bodyText(entry?.methods.get("equals")?.node)).toContain("a.n === b.n");
    });
  });
});

/**
 * A caught type-checker failure that degrades leaves a visible trace
 * (CLAUDE.md "Calling the type checker on macro-generated nodes"; review 8):
 * hkt's type-function test, typeInfo's method signatures, the deferral check
 * behind `companionAssignedBefore`, and the free-name scan behind `@impl`
 * inlining (`methodInlineSymbols`). Each runs on a real program whose checker
 * is wrapped to throw where the test says.
 */
import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { createMacroContext, type MacroContext } from "@typesugar/core";
import { resolveTypeConstructorViaTypeChecker } from "./hkt.js";
import { typeInfoMacro } from "./reflect.js";
import { companionAssignedBefore } from "./instance-resolver.js";
import { methodInlineSymbols } from "./instance-extraction.js";

interface Fixture {
  program: ts.Program;
  sourceFile: ts.SourceFile;
  cleanup: () => void;
}

function programOf(source: string): Fixture {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "checker-failure-"));
  const file = path.join(dir, "test.ts");
  fs.writeFileSync(file, source);
  const program = ts.createProgram([file], {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    types: [],
  });
  return {
    program,
    sourceFile: program.getSourceFile(file)!,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

/** `checker` with `method` throwing whenever `when` holds for its arguments. */
function throwing(
  checker: ts.TypeChecker,
  method: keyof ts.TypeChecker,
  when: (...args: unknown[]) => boolean = () => true
): ts.TypeChecker {
  return new Proxy(checker, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop !== method || typeof value !== "function") {
        return typeof value === "function" ? value.bind(target) : value;
      }
      return (...args: unknown[]) => {
        if (when(...args)) throw new Error(`boom-${String(method)}`);
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}

/** A macro context over `fixture` whose checker is `checker`; returns it and its warnings. */
function withContext<T>(
  fixture: Fixture,
  checker: ts.TypeChecker,
  run: (ctx: MacroContext) => T
): { result: T; warnings: string[] } {
  const program = new Proxy(fixture.program, {
    get(target, prop, receiver) {
      if (prop === "getTypeChecker") return () => checker;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  let result!: T;
  let warnings: string[] = [];
  ts.transform(fixture.sourceFile, [
    (transformContext) => {
      const ctx = createMacroContext(program, fixture.sourceFile, transformContext);
      result = run(ctx);
      warnings = ctx
        .getDiagnostics()
        .filter((d) => d.severity === "warning")
        .map((d) => d.message);
      return (sf) => sf;
    },
  ]);
  return { result, warnings };
}

function find<T extends ts.Node>(root: ts.Node, pred: (n: ts.Node) => n is T): T {
  let found: T | undefined;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (pred(n)) found = n;
    else ts.forEachChild(n, visit);
  };
  visit(root);
  if (!found) throw new Error("node not found");
  return found;
}

describe("a caught checker failure that degrades is reported", () => {
  it("hkt: a type the checker can't read is treated as a data type, with a warning", () => {
    const fx = programOf(`export interface Box<A> { readonly value: A }\n`);
    try {
      const checker = throwing(fx.program.getTypeChecker(), "getDeclaredTypeOfSymbol");
      const { result, warnings } = withContext(fx, checker, (ctx) =>
        resolveTypeConstructorViaTypeChecker(ctx, "Box")
      );
      expect(result?.isTypeFunction).toBe(false);
      expect(warnings.join("\n")).toMatch(
        /treated 'Box' as a data type.*boom-getDeclaredTypeOfSymbol/
      );
    } finally {
      fx.cleanup();
    }
  });

  it("typeInfo: a method whose signature the checker fails on is named in a warning", () => {
    const fx = programOf(
      `declare function typeInfo<T>(): unknown;
class Calc { label = "c"; add(a: number, b: number): number { return a + b; } }
const t = typeInfo<Calc>();\n`
    );
    try {
      // Fields are typed at their declarations; methods at the call.
      const checker = throwing(
        fx.program.getTypeChecker(),
        "getTypeOfSymbolAtLocation",
        (_symbol, location) => ts.isCallExpression(location as ts.Node)
      );
      const call = find(
        fx.sourceFile,
        (n): n is ts.CallExpression => ts.isCallExpression(n) && !!n.typeArguments
      );
      const { warnings } = withContext(fx, checker, (ctx) =>
        typeInfoMacro.expand(ctx, call, call.arguments)
      );
      expect(warnings.join("\n")).toMatch(/typeInfo<Calc>\(\) left out method 'add'/);
    } finally {
      fx.cleanup();
    }
  });

  it("companionAssignedBefore: a member reference the checker can't resolve is reported", () => {
    const fx = programOf(
      `class C { m() { return P.Eq; } }
new C().m();
/** @derive(Eq) */
interface P { x: number }
declare namespace P { const Eq: unknown; }
`
    );
    try {
      const checker = throwing(
        fx.program.getTypeChecker(),
        "getSymbolAtLocation",
        (node) =>
          ts.isIdentifier(node as ts.Node) &&
          (node as ts.Identifier).text === "m" &&
          ts.isPropertyAccessExpression((node as ts.Node).parent)
      );
      const useSite = find(
        fx.sourceFile,
        (n): n is ts.Identifier => ts.isIdentifier(n) && n.text === "P"
      );
      const decl = find(fx.sourceFile, ts.isInterfaceDeclaration);
      const failures: string[] = [];
      const assigned = companionAssignedBefore(useSite, decl, checker, (_n, e, what) =>
        failures.push(`${what}: ${e}`)
      );
      expect(assigned).toBe(false); // the conservative answer: it may run first
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatch(/member reference.*boom-getSymbolAtLocation/);
    } finally {
      fx.cleanup();
    }
  });

  it("methodInlineSymbols: a body the checker can't read isn't inlined, and says so", () => {
    const fx = programOf(
      `const helper = (n: number) => n + 1;
export const inst = { f: (x: number) => helper(x) };\n`
    );
    try {
      const checker = throwing(
        fx.program.getTypeChecker(),
        "getSymbolAtLocation",
        (node) => ts.isIdentifier(node as ts.Node) && (node as ts.Identifier).text === "helper"
      );
      const fn = find(
        fx.sourceFile,
        (n): n is ts.ArrowFunction => ts.isArrowFunction(n) && ts.isPropertyAssignment(n.parent)
      );
      const failures: string[] = [];
      const symbols = methodInlineSymbols(checker, fn, fx.sourceFile, (_n, e) =>
        failures.push(String(e))
      );
      expect(symbols).toBeUndefined();
      expect(failures).toEqual(["Error: boom-getSymbolAtLocation"]);
    } finally {
      fx.cleanup();
    }
  });
});

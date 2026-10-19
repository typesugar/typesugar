/**
 * Docs review 2026-10, round 3 (macros): doc examples run through the REAL
 * transformer pipeline (built dist), type-checked (strictOutput) and executed.
 *
 * - #1 (guides-a #4, authoring #4): the `@impl FlatMap<Box>` companion was
 *   `namespace Box { export const FlatMap = flatMapBox as FlatMap<Box>; }`,
 *   which doesn't type-check ('FlatMap' is not a type in scope; `Box` needs a
 *   type argument). The assertion added nothing, so it is gone.
 * - #2 (authoring #5, Json JSDoc leak): derived companions printed user
 *   comments mid-expression (`a.name === // a < b, ...`). The string-parsed
 *   derivation kept its operator TOKENS positioned in the temporary parse
 *   file, and the printer read comments at those offsets from the user file.
 * - #3 (guides-b #9): `@tailrec` and GenericDerivation failures used the
 *   generic TS9999 instead of catalogue codes.
 */
import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createMacroContext } from "@typesugar/core";
// @ts-ignore -- load the transformer's built pipeline directly (as other e2e tests do)
import { transformCode } from "../../transformer/dist/index.js";
import { tryDeriveViaGeneric } from "../src/auto-derive.js";
// From dist: tryExpandGenericDerive lazily require()s ./auto-derive.js, which
// only resolves in the built bundle.
// @ts-ignore -- built output
import * as macrosDist from "../dist/index.js";
const { tryExpandGenericDerive, reportGenericDeriveFailure, GenericDeriveError } =
  macrosDist as typeof import("../src/index.js");

const here = path.dirname(fileURLToPath(import.meta.url));
let counter = 0;

interface Diag {
  severity?: string;
  message?: string;
}

function transformAndRun(code: string): {
  code: string;
  errors: string[];
  strict: string[];
  logs: unknown[];
} {
  const fileName = path.resolve(here, `__docs_r3_${counter++}.ts`);
  const r = transformCode(code, { fileName, strictOutput: true });
  const diags: Diag[] = r.diagnostics ?? [];
  const errors = diags.filter((d) => d.severity === "error").map((d) => String(d.message));
  const strict = diags.map((d) => String(d.message)).filter((m) => m.startsWith("[strictOutput]"));
  const logs: unknown[] = [];
  if (errors.length === 0) {
    const js = ts.transpileModule(r.code, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const mod = { exports: {} };
    const req = () => ({});
    new Function("require", "exports", "module", "console", js)(req, mod.exports, mod, {
      log: (v: unknown) => logs.push(v),
    });
  }
  return { code: r.code, errors, strict, logs };
}

describe("#1 @impl companion type-checks", () => {
  it("custom-Box let: example from the std README: no strictOutput errors, runs", () => {
    const r = transformAndRun(`interface Box<A> {
  value: A;
}
const box = <A>(value: A): Box<A> => ({ value });

/**
 * @impl FlatMap<Box>
 * @do-methods style=static receiver=flatMapBox
 */
export const flatMapBox = {
  map: <A, B>(fa: Box<A>, f: (a: A) => B): Box<B> => box(f(fa.value)),
  flatMap: <A, B>(fa: Box<A>, f: (a: A) => Box<B>): Box<B> => f(fa.value),
};

console.log(JSON.stringify(Box.FlatMap.flatMap(box(5), (x) => box(x * 2))));
`);
    expect(r.errors).toEqual([]);
    expect(r.code).toContain("export const FlatMap = flatMapBox");
    expect(r.strict).toEqual([]);
    expect(r.logs).toEqual(['{"value":10}']);
  });

  it("a proper-type instance companion keeps the instance's own type", () => {
    const r = transformAndRun(`/** @typeclass */
interface Show<A> { show(a: A): string; }
interface Point { x: number; y: number; }
/** @impl Show<Point> */
const showPoint: Show<Point> = { show: (p) => \`(\${p.x}, \${p.y})\` };
console.log(Point.Show.show({ x: 1, y: 2 }));
`);
    expect(r.errors).toEqual([]);
    expect(r.strict).toEqual([]);
    expect(r.logs).toEqual(["(1, 2)"]);
  });
});

describe("#2 derived companions carry no user comments", () => {
  it("authoring derive example: no comment from a later/earlier line inside the Eq body", () => {
    // Exact shape of the docs example: the `// a < b, ...` trailing comment
    // sat at the offset the parsed `===` token remembered.
    const r = transformAndRun(`import { derive, Eq, Ord, Clone, Debug } from "@typesugar/derive";
import "@typesugar/std/syntax/eq/ops"; // a === b, a !== b
import "@typesugar/std/syntax/ord/ops"; // a < b, ...
import "@typesugar/std/syntax/clone"; // a.clone()
import "@typesugar/std/syntax/debug"; // a.debug()

@derive(Eq, Ord, Clone, Debug)
interface User {
  id: number;
  name: string;
}

const alice: User = { id: 1, name: "Alice" };
console.log(User.Eq.equals(alice, { id: 1, name: "Alice" }), User.Ord.compare(alice, alice));
`);
    expect(r.errors).toEqual([]);
    const generated = r.code.slice(r.code.indexOf("namespace User"));
    expect(generated.slice(0, generated.indexOf("const alice"))).not.toMatch(/\/\/|\/\*/);
    expect(r.logs).toEqual([true]);
  });

  it("every node of a derived expression (tokens included) is synthetic", () => {
    const fileName = path.resolve(here, `__docs_r3_unit.ts`);
    const source = `/** @derive(Json) */\ninterface U { id: number; name: string }\n`;
    const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2020, strict: true };
    const host = ts.createCompilerHost(options);
    const orig = host.getSourceFile.bind(host);
    host.getSourceFile = (f, lv, ...rest) =>
      f === fileName ? ts.createSourceFile(f, source, lv, true) : orig(f, lv, ...rest);
    const program = ts.createProgram([fileName], options, host);
    const sf = program.getSourceFile(fileName)!;
    const decl = sf.statements[0] as ts.InterfaceDeclaration;
    let positioned: string[] = [];
    ts.transform(sf, [
      (tc) => {
        const ctx = createMacroContext(program, sf, tc);
        for (const tc2 of ["Eq", "Json"]) {
          const { expression } = tryDeriveViaGeneric(ctx, tc2, "U", decl);
          expect(expression).toBeTruthy();
          const walk = (n: ts.Node): void => {
            if (n.pos !== -1 || n.end !== -1) positioned.push(ts.SyntaxKind[n.kind]);
            ts.forEachChild(n, walk);
          };
          walk(expression!);
        }
        return (s) => s;
      },
    ]);
    expect(positioned).toEqual([]);
  });
});

describe("#3 catalogue codes instead of TS9999", () => {
  it("@tailrec with a non-tail recursive call reports TS9220", () => {
    const r = transformAndRun(`import { tailrec } from "typesugar";
/** @tailrec */
function factorial(n: number): number {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}
`);
    const msg = r.errors.join("\n");
    expect(msg).toContain("TS9220");
    expect(msg).toContain("not in tail position");
    expect(msg).not.toContain("TS9999");
  });

  it("reportGenericDeriveFailure turns tryExpandGenericDerive's failure into TS9106", () => {
    const fileName = path.resolve(here, `__docs_r3_unit2.ts`);
    const source = `interface UserProfile { id: number; metadata: unknown }\n`;
    const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2020, strict: true };
    const host = ts.createCompilerHost(options);
    const orig = host.getSourceFile.bind(host);
    host.getSourceFile = (f, lv, ...rest) =>
      f === fileName ? ts.createSourceFile(f, source, lv, true) : orig(f, lv, ...rest);
    const program = ts.createProgram([fileName], options, host);
    const sf = program.getSourceFile(fileName)!;
    const decl = sf.statements[0] as ts.InterfaceDeclaration;
    let messages: string[] = [];
    ts.transform(sf, [
      (tc) => {
        const ctx = createMacroContext(program, sf, tc);
        let thrown: unknown;
        try {
          tryExpandGenericDerive(ctx, "Eq", "UserProfile", decl);
        } catch (e) {
          thrown = e;
        }
        expect(thrown).toBeInstanceOf(GenericDeriveError);
        reportGenericDeriveFailure(ctx, decl.name, "Eq", thrown);
        messages = ctx.getDiagnostics().map((d) => d.message);
        return (s) => s;
      },
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("[TS9106] Cannot derive Eq for 'UserProfile'");
    expect(messages[0]).toContain("unknown lacks Eq");
  });

  // Needs transformer-core's @derive loop (macro-helpers.ts) to call
  // reportGenericDeriveFailure instead of ctx.reportError.
  it("a failed generic derivation reports TS9106 with the resolution trace", () => {
    const r = transformAndRun(`/** @derive(Eq) */
interface UserProfile {
  id: number;
  metadata: unknown;
}
`);
    const msg = r.errors.join("\n");
    expect(msg).toContain("TS9106");
    expect(msg).toContain("Cannot derive Eq for 'UserProfile'");
    expect(msg).toContain("unknown lacks Eq");
    expect(msg).not.toContain("TS9999");
  });
});

/**
 * Visitor-engine regressions from the 1.0 deep review (core group 1):
 * #2, #7, #8, #10, #11, #12, #13, #22 and contracts #6.
 *
 * Each test drives the real `transformCode()` entry point and, where the
 * output is runnable JS, executes it.
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as ts from "typescript";
import {
  defineAttributeMacro,
  defineExpressionMacro,
  globalRegistry,
  type MacroContext,
} from "@typesugar/core";
import { transformCode } from "../src/transform.js";
// Registers the real `pipe`, `implicit`, derive and typeclass macros.
import "@typesugar/macros";

const OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  experimentalDecorators: true,
  noEmit: true,
  skipLibCheck: true,
};

/** Transform `entry` inside a multi-file in-memory program. */
function run(files: Record<string, string>, entry: string) {
  const host: ts.CompilerHost = {
    getSourceFile: (name, lv) => {
      if (name in files) return ts.createSourceFile(name, files[name], lv, true);
      if (name.includes("lib.") && name.endsWith(".d.ts")) return ts.createSourceFile(name, "", lv);
      return undefined;
    },
    getDefaultLibFileName: () => "lib.d.ts",
    writeFile: () => {},
    getCurrentDirectory: () => "/",
    getDirectories: () => [],
    fileExists: (f) => f in files,
    readFile: (f) => files[f],
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
  };
  const program = ts.createProgram(Object.keys(files), OPTIONS, host);
  return transformCode(files[entry], { fileName: entry, program });
}

/** Strip TS types and evaluate the module body; returns its exports. */
function execute(code: string, globals: Record<string, unknown> = {}): Record<string, unknown> {
  const js = ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      experimentalDecorators: true,
    },
  }).outputText;
  const exports: Record<string, unknown> = {};
  const req = (m: string) => {
    throw new Error(`unexpected runtime import of "${m}"`);
  };
  const names = Object.keys(globals);
  new Function("exports", "require", ...names, js)(exports, req, ...names.map((n) => globals[n]));
  return exports;
}

const errorsOf = (r: ReturnType<typeof run>) =>
  r.diagnostics.filter((d) => d.severity === "error").map((d) => d.message);

// ---------------------------------------------------------------------------
// #2 obj.pipe(...) on a third-party type must not become the pipe macro
// ---------------------------------------------------------------------------
describe("#2 method call on a node_modules type that shares a macro's name", () => {
  it("leaves obs.pipe(...) alone when the file imports the pipe macro", () => {
    const r = run(
      {
        "/node_modules/fake-rx/index.d.ts": `
          export interface Observable<T> { pipe(...ops: Array<(x: any) => any>): Observable<any>; }
          export declare function map<A, B>(f: (a: A) => B): (x: any) => any;
        `,
        "/main.ts": `
          import { pipe } from "typesugar";
          import { Observable, map } from "fake-rx";
          declare const obs: Observable<number>;
          export const a = pipe(1, (x: number) => x + 1);
          export const b = obs.pipe(map((x: number) => x * 2), map((y: number) => y + 1));
        `,
      },
      "/main.ts"
    );
    expect(errorsOf(r)).toEqual([]);
    expect(r.code).toContain("obs.pipe(");
  });
});

// ---------------------------------------------------------------------------
// #10 expression macro must never be dispatched as an attribute macro
// ---------------------------------------------------------------------------
describe("#10 macro kind is part of symbol->macro resolution", () => {
  const calls: string[] = [];
  beforeAll(() => {
    globalRegistry.register(
      defineExpressionMacro({
        name: "__dualKind",
        expand(ctx: MacroContext, call) {
          calls.push(`expr:${ts.SyntaxKind[call.kind]}`);
          return ctx.factory.createNumericLiteral(42);
        },
      })
    );
    globalRegistry.register(
      defineAttributeMacro({
        name: "__dualKind",
        validTargets: ["class"],
        expand(_ctx, _dec, target) {
          calls.push("attr");
          return target;
        },
      })
    );
    globalRegistry.register(
      defineExpressionMacro({
        name: "__exprOnly",
        expand(ctx: MacroContext) {
          calls.push("exprOnly");
          return ctx.factory.createNumericLiteral(7);
        },
      })
    );
  });

  it("expression then decorator use of the same import keeps the class", () => {
    calls.length = 0;
    const r = run(
      {
        "/dual.ts": `export function __dualKind(...a: any[]): any { return 0; }`,
        "/main.ts": `
          import { __dualKind } from "./dual";
          export const v = __dualKind(1);
          @__dualKind
          export class X { a = 1; }
        `,
      },
      "/main.ts"
    );
    expect(r.code).toContain("class X");
    expect(calls).toEqual(["expr:CallExpression", "attr"]);
  });

  it("module-scoped macro registered as both kinds under one export resolves each kind", () => {
    calls.length = 0;
    for (const kind of ["expression", "attribute"] as const) {
      const def = {
        name: "__dualMod",
        module: "test-dual-mod",
        validTargets: ["class"] as const,
        expand(ctx: MacroContext, node: ts.Node, ...rest: unknown[]) {
          calls.push(`${kind}:${ts.SyntaxKind[node.kind]}`);
          return kind === "expression" ? ctx.factory.createNumericLiteral(1) : (rest[0] as ts.Node);
        },
      };
      globalRegistry.register(
        kind === "expression"
          ? defineExpressionMacro(def as never)
          : defineAttributeMacro({ ...def, validTargets: ["class"] } as never)
      );
    }
    const r = run(
      {
        "/node_modules/test-dual-mod/index.d.ts": `export declare function __dualMod(...a: any[]): any;`,
        "/main.ts": `
          import { __dualMod } from "test-dual-mod";
          @__dualMod
          export class Z { a = 1; }
          export const v = __dualMod(1);
        `,
      },
      "/main.ts"
    );
    expect(r.code).toContain("class Z");
    expect(calls).toEqual(["attribute:Decorator", "expression:CallExpression"]);
  });

  it("an expression-only macro used as a decorator is not invoked with a Decorator", () => {
    calls.length = 0;
    const r = run(
      {
        "/m.ts": `export function __exprOnly(...a: any[]): any { return 0; }`,
        "/main.ts": `
          import { __exprOnly } from "./m";
          export const v = __exprOnly();
          @__exprOnly
          export class Y { a = 1; }
        `,
      },
      "/main.ts"
    );
    expect(r.code).toContain("class Y");
    expect(calls).toEqual(["exprOnly"]);
  });
});

// ---------------------------------------------------------------------------
// #13 a throwing attribute macro must report once, not recurse
// ---------------------------------------------------------------------------
describe("#13 throwing attribute macro", () => {
  let calls = 0;
  beforeAll(() => {
    globalRegistry.register(
      defineAttributeMacro({
        name: "__boomAttr",
        validTargets: ["class"],
        expand() {
          calls++;
          throw new Error("kaboom");
        },
      })
    );
  });

  it("expands once and reports one error", () => {
    calls = 0;
    const r = run(
      {
        "/boom.ts": `export function __boomAttr(t: any): any { return t; }`,
        "/main.ts": `import { __boomAttr } from "./boom";\n@__boomAttr\nexport class X { a = 1; }\n`,
      },
      "/main.ts"
    );
    expect(calls).toBe(1);
    expect(errorsOf(r).filter((m) => m.includes("kaboom"))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// #7 arguments of inlined / specialised calls must be visited
// ---------------------------------------------------------------------------
describe("#7 macros inside arguments of an inlined instance call", () => {
  it("expands pipe() in the arguments of an inlined eqPoint.equals", () => {
    const r = run(
      {
        "/main.ts": `
          import { pipe } from "typesugar";
          interface Eq<A> { equals(a: A, b: A): boolean; }
          interface Point { x: number; y: number; }
          const eqPoint: Eq<Point> = { equals: (a: Point, b: Point) => a.x === b.x };
          const p1: Point = { x: 1, y: 2 };
          const f = (p: Point): Point => ({ x: p.x + 1, y: p.y });
          export const same = eqPoint.equals(pipe(p1, f), p1);
          export const other = pipe(1, (n: number) => n + 1);
        `,
      },
      "/main.ts"
    );
    expect(errorsOf(r)).toEqual([]);
    expect(r.code).not.toMatch(/\bpipe\(/);
    const out = execute(r.code);
    expect(out.same).toBe(false);
    expect(out.other).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// #8 block-bodied arrows get implicit-param scope and tryTransform
// ---------------------------------------------------------------------------
describe("#8 block-bodied arrow with implicit params", () => {
  it("fills display(a) from the arrow's implicit parameter like the expression-bodied form", () => {
    const common = `
      import { implicit } from "typesugar";
      interface Show<A> { show(a: A): string; }
      declare function display<A>(a: A, S: Show<A> = implicit()): string;
    `;
    const block = run(
      {
        "/main.ts": `${common}
          export const f = <A,>(a: A, S: Show<A> = implicit()): string => { return display(a); };
        `,
      },
      "/main.ts"
    );
    const expr = run(
      {
        "/main.ts": `${common}
          export const f = <A,>(a: A, S: Show<A> = implicit()): string => display(a);
        `,
      },
      "/main.ts"
    );
    // Sanity: the expression-bodied form is the reference behaviour.
    expect(expr.code).toContain("display(a, S)");
    expect(errorsOf(block)).toEqual(errorsOf(expr));
    expect(block.code).toContain("display(a, S)");
  });
});

// ---------------------------------------------------------------------------
// #11 macro imports still referenced at runtime are kept
// ---------------------------------------------------------------------------
describe("#11 macro import cleanup keeps still-referenced specifiers", () => {
  it("keeps `pipe` imported when a 'use no typesugar' function still calls it", () => {
    const r = run(
      {
        "/main.ts": `
          import { pipe } from "typesugar";
          export const a = pipe(1, (x: number) => x + 1);
          export function raw() {
            "use no typesugar";
            return pipe(1, (x: number) => x * 2);
          }
        `,
      },
      "/main.ts"
    );
    expect(r.code).toMatch(/import\s*\{\s*pipe\s*\}\s*from\s*"typesugar"/);
  });

  it("keeps `pipe` imported when it is used as a value", () => {
    const r = run(
      {
        "/main.ts": `
          import { pipe } from "typesugar";
          export const a = pipe(1, (x: number) => x + 1);
          export const p = pipe;
        `,
      },
      "/main.ts"
    );
    expect(r.code).toMatch(/import\s*\{\s*pipe\s*\}\s*from\s*"typesugar"/);
  });

  it("still removes the import when every use was expanded", () => {
    const r = run(
      {
        "/main.ts": `
          import { pipe } from "typesugar";
          export const a = pipe(1, (x: number) => x + 1);
        `,
      },
      "/main.ts"
    );
    expect(r.code).not.toContain("typesugar");
  });
});

// ---------------------------------------------------------------------------
// #12 JSDoc-macro targets are visited
// ---------------------------------------------------------------------------
describe("#12 nested macros inside a /** @derive */ class", () => {
  it("expands pipe() inside the class body like the decorator form", () => {
    const r = run(
      {
        "/main.ts": `
          import { pipe } from "typesugar";
          /** @derive(Eq) */
          export class P {
            x = 1;
            f() { return pipe(1, (a: number) => a + 1); }
          }
        `,
      },
      "/main.ts"
    );
    expect(r.code).not.toMatch(/\bpipe\(1/);
  });
});

// ---------------------------------------------------------------------------
// #22 `changed` reflects rewrites that do not go through the tracker
// ---------------------------------------------------------------------------
describe("#22 transformCode().changed", () => {
  it("is true when an instance call was inlined", () => {
    const r = transformCode(
      `interface Eq<A> { equals(a: A, b: A): boolean; }
interface Point { x: number; y: number; }
const eqPoint: Eq<Point> = { equals: (a: Point, b: Point) => a.x === b.x };
const p1: Point = { x: 1, y: 2 };
export const same = eqPoint.equals(p1, p1);
`,
      { fileName: "/x/input22.ts" }
    );
    expect(r.code).not.toContain("eqPoint.equals(");
    expect(r.changed).toBe(true);
  });

  it("is false for a file with nothing to rewrite", () => {
    const r = transformCode(`export const x = 1;\n`, { fileName: "/x/plain22.ts" });
    expect(r.changed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// contracts #6 requires:/ensures: in unsupported positions must not be silent
// ---------------------------------------------------------------------------
describe("contracts #6 trigger labels outside function/method declarations", () => {
  const SYNTAX_MODULE = "__test-unsupported-trigger-label-marker";
  let calls = 0;
  beforeAll(() => {
    globalRegistry.register(
      defineAttributeMacro({
        name: "__testUnsupportedTrigger",
        validTargets: ["function", "method"],
        triggerLabels: ["__requires6"],
        syntaxModule: SYNTAX_MODULE,
        expand(_ctx, _dec, target) {
          calls++;
          return target;
        },
      })
    );
  });

  for (const [what, body] of [
    ["arrow function", `export const f = (x: number) => { __requires6: { x > 0; } return x; };`],
    [
      "function expression",
      `export const f = function (x: number) { __requires6: { x > 0; } return x; };`,
    ],
    ["constructor", `export class C { constructor(x: number) { __requires6: { x > 0; } } }`],
    ["accessor", `export class C { get v() { __requires6: { true; } return 1; } }`],
  ] as const) {
    it(`reports an error for a trigger label in a(n) ${what}`, () => {
      calls = 0;
      const r = run({ "/main.ts": `import "${SYNTAX_MODULE}";\n${body}\n` }, "/main.ts");
      const errs = errorsOf(r).filter((m) => m.includes("__requires6"));
      expect(errs).toHaveLength(1);
      expect(calls).toBe(0);
    });
  }

  it("still applies to a function declaration without an error", () => {
    calls = 0;
    const r = run(
      {
        "/main.ts": `import "${SYNTAX_MODULE}";\nexport function g(x: number) { __requires6: { x > 0; } return x; }\n`,
      },
      "/main.ts"
    );
    expect(errorsOf(r)).toEqual([]);
    expect(calls).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// #17 bare `// @ts-no-typesugar` line opt-out
// ---------------------------------------------------------------------------
describe("#17 bare line opt-out", () => {
  // `it.fails`: this documents the open bug. The fix belongs in
  // packages/core/src/resolution-scope.ts (`hasInlineOptOut`, other owner);
  // when it lands this test starts failing -- flip it to `it`.
  it("leaves a call on a `// @ts-no-typesugar` line unexpanded", () => {
    const r = run(
      {
        "/main.ts": `
          import { pipe } from "typesugar";
          export const a = pipe(1, (x: number) => x + 1);
          export const b = pipe(2, (x: number) => x + 1); // @ts-no-typesugar
        `,
      },
      "/main.ts"
    );
    expect(r.code).toContain("pipe(2,");
  });
});

// ---------------------------------------------------------------------------
// Regression (orchestrator, std build): a receiver's own native method must
// never be redirected to an imported object's same-named member.
// ---------------------------------------------------------------------------
describe("native method vs imported object member", () => {
  it("leaves arr.map(f) alone when an imported instance has a compatible map(fa, f)", () => {
    const r = run(
      {
        // The in-memory lib is empty; give Array its native map.
        "/globals.d.ts": `interface Array<T> { length: number; map<U>(cb: (v: T) => U): U[]; }`,
        "/inst.ts": `
          export interface ParCombine<F> { map(fa: any, f: (a: any) => any): any; }
          export const parCombinePromise: ParCombine<unknown> = { map: (fa, f) => fa.then(f) };
        `,
        "/main.ts": `
          import { parCombinePromise } from "./inst";
          interface Step { name: string; effect: number; }
          export function build(bindSteps: Step[]) {
            const xs = [bindSteps.map((s) => s.effect)];
            return { xs, p: parCombinePromise };
          }
        `,
      },
      "/main.ts"
    );
    expect(r.code).toContain("bindSteps.map(");
    expect(r.code).not.toContain("parCombinePromise.map(");
  });
});

// ---------------------------------------------------------------------------
// Attribute macro returning several statements: every one is visited
// ---------------------------------------------------------------------------
describe("attribute macro results after the first are visited", () => {
  beforeAll(() => {
    globalRegistry.register(
      defineExpressionMacro({
        name: "__twiceInner",
        expand(ctx: MacroContext, _call, args) {
          return ctx.factory.createArrayLiteralExpression([args[0], args[0]]);
        },
      })
    );
    globalRegistry.register(
      defineAttributeMacro({
        name: "__emitArgAfter",
        validTargets: ["class"],
        expand(ctx, decorator, target, args) {
          // Second statement carries the decorator's (real) argument, which
          // itself is an expression-macro call.
          void decorator;
          return [
            target,
            ctx.factory.createVariableStatement(
              [ctx.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
              ctx.factory.createVariableDeclarationList(
                [ctx.factory.createVariableDeclaration("after", undefined, undefined, args[0])],
                ts.NodeFlags.Const
              )
            ),
          ];
        },
      })
    );
  });

  it("expands a macro inside result.slice(1)", () => {
    const r = run(
      {
        "/m.ts": [
          "export function __twiceInner(...a: any[]): any { return 0; }",
          "export function __emitArgAfter(...a: any[]): any { return () => {}; }",
        ].join("\n"),
        "/main.ts": `
          import { __twiceInner, __emitArgAfter } from "./m";
          @__emitArgAfter(__twiceInner(3))
          export class W { a = 1; }
        `,
      },
      "/main.ts"
    );
    expect(r.code).toContain("after = [3, 3]");
    expect(r.code).not.toContain("__twiceInner(3)");
  });
});

// ---------------------------------------------------------------------------
// Field / accessor / parameter attribute macros: the expanded decorator is
// removed (updateNodeDecorators handles those kinds), so it never re-expands.
// ---------------------------------------------------------------------------
describe("member and parameter attribute macros", () => {
  const calls: string[] = [];
  beforeAll(() => {
    globalRegistry.register(
      defineAttributeMacro({
        name: "__memberNoop",
        validTargets: ["property", "accessor", "parameter", "method"],
        expand(_ctx, _dec, target) {
          calls.push(ts.SyntaxKind[target.kind]);
          return target; // returned as-is: the engine must strip the decorator
        },
      })
    );
  });

  it("strips the decorator from a property, accessor and parameter and expands once each", () => {
    calls.length = 0;
    const r = run(
      {
        "/m.ts": "export function __memberNoop(...a: any[]): any { return () => {}; }",
        "/main.ts": `
          import { __memberNoop } from "./m";
          export class V {
            @__memberNoop x = 1;
            @__memberNoop get y() { return 2; }
            m(@__memberNoop p: number) { return p; }
          }
        `,
      },
      "/main.ts"
    );
    expect(r.code).not.toContain("@__memberNoop");
    expect(calls.sort()).toEqual(["GetAccessor", "Parameter", "PropertyDeclaration"]);
  });
});

// ---------------------------------------------------------------------------
// Decorator on a `const` (the documented `@layer(Svc) const x = ...` form):
// the attribute macro receives the VariableDeclaration and its result
// replaces it inside the statement.
// ---------------------------------------------------------------------------
describe("attribute macro on a const declaration", () => {
  const seen: string[] = [];
  beforeAll(() => {
    globalRegistry.register(
      defineAttributeMacro({
        name: "__wrapConst",
        validTargets: ["property"],
        expand(ctx, _dec, target) {
          seen.push(ts.SyntaxKind[target.kind]);
          if (!ts.isVariableDeclaration(target) || !target.initializer) return target;
          return ctx.factory.createVariableDeclaration(
            target.name,
            undefined,
            undefined,
            ctx.factory.createArrayLiteralExpression([target.initializer])
          );
        },
      })
    );
  });

  it("expands `@macro const x = ...` and removes the decorator", () => {
    seen.length = 0;
    const r = run(
      {
        "/m.ts": "export function __wrapConst(...a: any[]): any { return () => {}; }",
        "/main.ts": `
          import { __wrapConst } from "./m";
          // @ts-ignore -- decorators are not valid here (typesugar handles them)
          @__wrapConst
          export const v = 1;
        `,
      },
      "/main.ts"
    );
    expect(seen).toEqual(["VariableDeclaration"]);
    expect(r.code).not.toContain("@__wrapConst");
    expect(r.code).toMatch(/export const v = \[1\]/);
  });
});

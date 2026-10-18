/**
 * transformer-core leftovers from the deep review (group core-4):
 *
 * - core #25: pending imports / hoisted specialisations must go AFTER a
 *   `"use client"` / `"use strict"` directive prologue, not before it.
 * - in-place AST mutation: rewriting a call must not strip the positions of
 *   the caller's real argument nodes.
 * - cleanupMacroImports keeps a macro import specifier when the macro falls
 *   back to `ctx.ensureImport(<same name>, <same module>)`.
 *
 * Drives the real `transformCode` pipeline over a real on-disk program.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

import {
  clearTypeRewrites,
  standaloneExtensionRegistry,
  defineExpressionMacro,
  globalRegistry,
} from "@typesugar/core";

import { transformCode } from "../src/transform.js";
import { discoverOpaqueTypesFromImports, resetDtsDiscovery } from "../src/dts-opaque-discovery.js";

const FAKE_FP_DTS = [
  "/** @opaque A | null */",
  "export interface Option<A> {",
  "  map<B>(f: (a: A) => B): Option<B>;",
  "  contains(a: A): boolean;",
  "}",
  "export declare function Some<A>(a: A): Option<A>;",
  "export declare const None: Option<never>;",
  "export declare function map<A, B>(o: Option<A>, f: (a: A) => B): Option<B>;",
  "export declare function contains<A>(o: Option<A>, a: A): boolean;",
].join("\n");

interface Project {
  dir: string;
  program: ts.Program;
  file(name: string): string;
  cleanup(): void;
}

function makeProject(files: Record<string, string>): Project {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rewriting-scoping-")));
  const all: Record<string, string> = {
    "node_modules/fakefp/package.json": JSON.stringify({
      name: "fakefp",
      version: "1.0.0",
      types: "index.d.ts",
    }),
    "node_modules/fakefp/index.d.ts": FAKE_FP_DTS,
    ...files,
  };
  const roots: string[] = [];
  for (const [name, content] of Object.entries(all)) {
    const p = path.join(dir, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
    if (name.endsWith(".ts") && !name.startsWith("node_modules/")) roots.push(p);
  }
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
  };
  const host = ts.createCompilerHost(options);
  const orig = host.getSourceFile.bind(host);
  host.getSourceFile = (fn, lang, onErr, shouldCreate) => {
    const sf = orig(fn, lang, onErr, shouldCreate);
    if (sf && roots.includes(fn)) return ts.createSourceFile(fn, sf.text, lang, true);
    return sf;
  };
  const program = ts.createProgram(roots, options, host);
  return {
    dir,
    program,
    file: (name) => path.join(dir, name),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

/** Transform one file the way the pipeline does: .d.ts discovery, then the visitor. */
function transformFile(project: Project, name: string): string {
  const fileName = project.file(name);
  const sf = project.program.getSourceFile(fileName)!;
  discoverOpaqueTypesFromImports(sf, project.program);
  const result = transformCode(sf.text, { program: project.program, fileName });
  return result.code;
}

/** Transform files in the given order; returns output keyed by file name. */
function transformInOrder(project: Project, order: string[]): Record<string, string> {
  clearTypeRewrites();
  resetDtsDiscovery();
  standaloneExtensionRegistry.length = 0;
  const out: Record<string, string> = {};
  for (const name of order) out[name] = transformFile(project, name);
  return out;
}

/** Transpile TS output to CJS and run it; returns its `exports`. Imports throw. */
function execute(code: string): Record<string, unknown> {
  const js = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports: Record<string, unknown> = {};
  const req = (m: string) => {
    throw new Error(`unexpected runtime import of '${m}'`);
  };
  new Function("exports", "require", js)(exports, req);
  return exports;
}

beforeEach(() => {
  clearTypeRewrites();
  resetDtsDiscovery();
  standaloneExtensionRegistry.length = 0;
});

afterEach(() => {
  clearTypeRewrites();
  resetDtsDiscovery();
  standaloneExtensionRegistry.length = 0;
});

describe("injected imports go after the directive prologue (core #25)", () => {
  for (const directive of ["use client", "use strict"]) {
    it(`keeps "${directive}" as the first statement`, () => {
      const project = makeProject({
        "main.ts": [
          `"${directive}";`,
          'import { Some, type Option } from "fakefp";',
          "const o: Option<number> = Some(1);",
          "export const r = o.map((x) => x + 1);",
        ].join("\n"),
      });
      try {
        const out = transformInOrder(project, ["main.ts"])["main.ts"];
        const sf = ts.createSourceFile("out.ts", out, ts.ScriptTarget.Latest, true);
        // Something was actually injected (otherwise this test proves nothing).
        expect(out).toMatch(/map\(o/);
        expect(ts.isExpressionStatement(sf.statements[0])).toBe(true);
        expect((sf.statements[0] as ts.ExpressionStatement).expression.getText(sf)).toBe(
          `"${directive}"`
        );
      } finally {
        project.cleanup();
      }
    });
  }
});

describe("standalone-extension registry is keyed by declaring file (core #18 root)", () => {
  it("a same-named extension from another file does not shadow this file's own", () => {
    const project = makeProject({
      "bound.ts": [
        "function clamp(n: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, n)); }",
        "const x: number = 5;",
        "// @ts-ignore",
        "export const r = x.clamp(0, 1);",
      ].join("\n"),
    });
    try {
      // Registered earlier by some other file's `@extension` (qualified form,
      // not bound in bound.ts) ...
      standaloneExtensionRegistry.push({
        methodName: "clamp",
        forType: "number",
        qualifier: "NumExt",
        declaringFile: project.file("other.ts"),
      } as (typeof standaloneExtensionRegistry)[number]);
      // ... and a plain `clamp` extension (process-wide; the pass for bound.ts
      // drops bound.ts's own earlier entries, so it is not keyed to it here).
      standaloneExtensionRegistry.push({ methodName: "clamp", forType: "number" });
      const out = transformCode(project.program.getSourceFile(project.file("bound.ts"))!.text, {
        program: project.program,
        fileName: project.file("bound.ts"),
      }).code;
      expect(out).toContain("clamp(x, 0, 1)");
      expect(execute(out).r).toBe(1);
    } finally {
      project.cleanup();
    }
  });
});

describe("cleanupMacroImports keeps a macro import the expansion still needs at runtime", () => {
  const NAME = "__testEnsureSelfFallback";
  beforeEach(() => {
    if (!globalRegistry.getExpression(NAME)) {
      // Like std's `match`: when it can't compile the call it falls back to the
      // runtime function of the same name from the same module.
      globalRegistry.register(
        defineExpressionMacro({
          name: NAME,
          description: "falls back to its own runtime export",
          expand(ctx, _call, args) {
            return ctx.factory.createCallExpression(
              ctx.ensureImport(NAME, "test-macros-rt"),
              undefined,
              [...args, ctx.factory.createNumericLiteral(99)]
            );
          },
        })
      );
    }
  });

  for (const style of ["named"] as const) {
    it(`the emitted callee is bound to an import from the module (${style} import)`, () => {
      const imp =
        style === "named"
          ? `import { ${NAME} } from "test-macros-rt";`
          : `import { ${NAME} as m } from "test-macros-rt";`;
      const call = style === "named" ? NAME : "m";
      const code = [imp, `export const a = ${call}(1);`].join("\n");
      const out = transformCode(code, { fileName: "/virtual/main.ts" }).code;
      expect(out).toContain("(1, 99)"); // the macro really expanded
      const sf = ts.createSourceFile("out.ts", out, ts.ScriptTarget.Latest, true);
      const bound = new Map<string, string>();
      for (const st of sf.statements) {
        if (!ts.isImportDeclaration(st)) continue;
        const nb = st.importClause?.namedBindings;
        if (nb && ts.isNamedImports(nb)) {
          for (const el of nb.elements) {
            bound.set(el.name.text, (el.propertyName ?? el.name).text);
          }
        }
      }
      const decl = sf.statements.find(ts.isVariableStatement)!;
      const init = decl.declarationList.declarations[0].initializer as ts.CallExpression;
      expect(ts.isCallExpression(init)).toBe(true);
      const callee = (init.expression as ts.Identifier).text;
      expect(bound.get(callee)).toBe(NAME);
    });
  }
});

describe("removing a macro-only import keeps its leading comments outside imports", () => {
  const NAME = "__testRemovedWithComments";
  beforeEach(() => {
    if (!globalRegistry.getExpression(NAME)) {
      globalRegistry.register(
        defineExpressionMacro({
          name: NAME,
          description: "expands to a call of a helper from ANOTHER module (an injected import)",
          expand(ctx, _call, args) {
            return ctx.factory.createCallExpression(
              ctx.ensureImport("__helperFn", "test-helper-rt"),
              undefined,
              [...args]
            );
          },
        })
      );
    }
  });

  it("prints every leading comment, none of them inside an import's braces", () => {
    const code = [
      "//! Power Assert",
      "// second line comment",
      "/** doc comment */",
      `import { ${NAME} } from "test-macros-rm";`,
      `export const a = ${NAME}(1);`,
    ].join("\n");
    const out = transformCode(code, { fileName: "/virtual/comments.ts" }).code;
    expect(out).toContain("__helperFn(1)");
    expect(out).not.toContain("test-macros-rm");
    for (const c of ["//! Power Assert", "// second line comment", "/** doc comment */"]) {
      expect(out).toContain(c);
    }
    const sf = ts.createSourceFile("out.ts", out, ts.ScriptTarget.Latest, true);
    for (const st of sf.statements) {
      if (ts.isImportDeclaration(st)) {
        // Comments inside the import's own text (after its start) are misplaced.
        expect(st.getText(sf)).not.toMatch(/\/\/|\/\*/);
      }
    }
  });
});

/**
 * Security tests for the comptime vm context (review finding macros-other #1).
 *
 * node:vm is not a security boundary. Before the hardening, every global the
 * comptime context exposed (Object, Error, console wrappers, require, fs/path
 * wrappers) was a HOST-realm object, so `Object.constructor("return process")()`
 * returned the real host `process` (and `process.mainModule.require(
 * "child_process")` ran shell commands). These tests drive the real
 * `comptimeMacro.expand` and check that none of the known escape routes reach
 * the host `process` any more, and that the bridged helpers still work.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { createMacroContext } from "@typesugar/core";
import { comptimeMacro, setComptimeEvaluationEnabled } from "./comptime.js";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "comptime-sandbox-")));
  fs.writeFileSync(path.join(tmpDir, "data.txt"), "héllo");
  fs.mkdirSync(path.join(tmpDir, "sub"));
  fs.writeFileSync(path.join(tmpDir, "sub", "a.txt"), "a");
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

afterEach(() => {
  setComptimeEvaluationEnabled(true);
});

type Diags = ReturnType<ReturnType<typeof createMacroContext>["getDiagnostics"]>;

/** Expand the first `comptime(...)` call in `source` with the real macro. */
function expandComptime(source: string): { printed: string; diagnostics: Diags } {
  const filePath = path.join(tmpDir, `t_${Math.random().toString(36).slice(2)}.ts`);
  fs.writeFileSync(filePath, `declare function comptime(...a: any[]): any;\n${source}`);
  try {
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      noEmit: true,
    };
    const host = ts.createCompilerHost(options);
    const program = ts.createProgram([filePath], options, {
      ...host,
      getCurrentDirectory: () => tmpDir,
    });
    const sourceFile = program.getSourceFile(filePath)!;
    let call: ts.CallExpression | undefined;
    const find = (n: ts.Node): void => {
      if (call) return;
      if (
        ts.isCallExpression(n) &&
        ts.isIdentifier(n.expression) &&
        n.expression.text === "comptime"
      ) {
        call = n;
        return;
      }
      n.forEachChild(find);
    };
    sourceFile.forEachChild(find);
    if (!call) throw new Error("no comptime call");

    let printed = "";
    let diagnostics: Diags = [];
    const factory: ts.TransformerFactory<ts.SourceFile> = (tctx) => {
      const ctx = createMacroContext(program, sourceFile, tctx);
      const out = comptimeMacro.expand(ctx, call!, call!.arguments);
      printed = ts
        .createPrinter({ newLine: ts.NewLineKind.LineFeed })
        .printNode(ts.EmitHint.Expression, out, sourceFile);
      diagnostics = ctx.getDiagnostics();
      return (sf) => sf;
    };
    ts.transform(sourceFile, [factory]);
    return { printed, diagnostics };
  } finally {
    fs.rmSync(filePath, { force: true });
  }
}

/** Wrap an escape attempt: returns "escaped:<typeof pid>" or "blocked:<error name>". */
function attempt(expr: string, perms = ""): string {
  return `comptime(${perms ? perms + ", " : ""}() => {
    try {
      const p = ${expr};
      return "escaped:" + typeof (p as any)?.pid;
    } catch (e: any) {
      return "blocked:" + (e && e.name);
    }
  });`;
}

describe("comptime sandbox: known host-realm escapes are closed", () => {
  const escapes: Array<[string, string, string?]> = [
    ["Object.constructor", `(Object as any).constructor("return process")()`],
    ["Error.constructor", `(Error as any).constructor("return process")()`],
    [
      "this.constructor.constructor",
      `(globalThis as any).constructor.constructor("return process")()`,
    ],
    ["console.log bridge", `(console.log as any).constructor("return process")()`],
    ["require bridge", `(require as any).constructor("return process")()`],
    ["process.cwd bridge", `(process.cwd as any).constructor("return process")()`],
    ["path.join bridge", `(require("path").join as any).constructor("return process")()`],
    ["fs bridge", `(fs.readFileSync as any).constructor("return process")()`, `{ fs: "read" }`],
    [
      "error thrown by a bridge",
      `(() => { try { fs.readFileSync("data.txt"); } catch (e: any) { return e.constructor.constructor("return process")(); } })()`,
    ],
    ["eval", `(0, eval)("process")`],
  ];

  for (const [name, expr, perms] of escapes) {
    it(`${name} does not reach host process`, () => {
      const { printed } = expandComptime(attempt(expr, perms));
      expect(printed).not.toContain("escaped:number");
      expect(printed).toMatch(/blocked:|escaped:undefined/);
    });
  }

  it("bridged helpers are context-realm functions (no host Function.prototype)", () => {
    const { printed } = expandComptime(`comptime({ fs: "read" }, () => [
      Object.getPrototypeOf(console.log) === Function.prototype,
      Object.getPrototypeOf(require) === Function.prototype,
      Object.getPrototypeOf(fs.readFileSync) === Function.prototype,
      Object.getPrototypeOf(require("path").join) === Function.prototype,
      Object.getPrototypeOf(process.cwd) === Function.prototype,
      Object.getPrototypeOf(process.env) === Object.prototype,
    ].every(Boolean));`);
    expect(printed).toBe("true");
  });

  it("the host process is not visible as a global", () => {
    const { printed } = expandComptime(
      `comptime(() => typeof (globalThis as any).process.pid + ":" + typeof (globalThis as any).process.mainModule);`
    );
    expect(printed).toBe(`"undefined:undefined"`);
  });

  it("eval/new Function is rejected with a helpful hint", () => {
    const { diagnostics } = expandComptime(`comptime(() => new Function("return 1")());`);
    const text = diagnostics.map((d) => d.message).join("\n");
    expect(text).toContain("eval() and new Function() are disabled");
  });
});

describe("comptime sandbox: bridged helpers still work", () => {
  it("reads a utf8 file with fs: read", () => {
    const { printed } = expandComptime(
      `comptime({ fs: "read" }, () => fs.readFileSync("./data.txt", "utf8"));`
    );
    expect(printed).toBe(`"h\\u00E9llo"`);
  });

  it("reads bytes without an encoding and decodes them via toString()", () => {
    const { printed } = expandComptime(
      `comptime({ fs: "read" }, () => { const b = fs.readFileSync("./data.txt"); return [b.length, b instanceof Uint8Array, b.toString("utf8")]; });`
    );
    expect(printed.replace(/\s+/g, "")).toBe(`[6,true,"h\\u00E9llo"]`);
  });

  it("readdirSync withFileTypes / statSync / existsSync", () => {
    const { printed } = expandComptime(`comptime({ fs: "read" }, () => {
      const d = fs.readdirSync(".", { withFileTypes: true }).find((e: any) => e.name === "sub");
      return [d.isDirectory(), fs.statSync("./data.txt").isFile(), fs.statSync("./data.txt").size, fs.existsSync("./nope")];
    });`);
    expect(printed.replace(/\s+/g, "")).toBe(`[true,true,6,false]`);
  });

  it("path helpers and require('path')", () => {
    const { printed } = expandComptime(
      `comptime(() => [path.join("a", "b"), require("path").basename("/x/y.ts", ".ts")]);`
    );
    expect(printed.replace(/\s+/g, "")).toBe(`["a${path.sep === "\\" ? "\\\\" : "/"}b","y"]`);
  });

  it("fs remains blocked without permission, with the permission hint", () => {
    const { printed, diagnostics } = expandComptime(
      `comptime(() => fs.readFileSync("./data.txt", "utf8"));`
    );
    expect(printed).toContain("comptime evaluation failed");
    expect(diagnostics.map((d) => d.message).join("\n")).toContain("Add { fs: 'read' }");
  });

  it("paths outside the project root are rejected", () => {
    const { printed } = expandComptime(
      `comptime({ fs: "read" }, () => fs.readFileSync("../../../../etc/hosts", "utf8"));`
    );
    expect(printed).toContain("outside the project root");
  });

  it("env is readable only with env: read", () => {
    process.env.TYPESUGAR_COMPTIME_SANDBOX_TEST = "yes";
    try {
      expect(
        expandComptime(
          `comptime({ env: "read" }, () => process.env.TYPESUGAR_COMPTIME_SANDBOX_TEST);`
        ).printed
      ).toBe(`"yes"`);
      expect(
        expandComptime(`comptime(() => process.env.TYPESUGAR_COMPTIME_SANDBOX_TEST);`).printed
      ).toContain("permission denied");
    } finally {
      delete process.env.TYPESUGAR_COMPTIME_SANDBOX_TEST;
    }
  });

  it("writes stay within the project root with fs: write", () => {
    expandComptime(
      `comptime({ fs: "write" }, () => { fs.writeFileSync("./out.txt", "w"); return 1; });`
    );
    expect(fs.readFileSync(path.join(tmpDir, "out.txt"), "utf8")).toBe("w");
  });
});

describe("comptime execution policy (editor hosts)", () => {
  it("leaves the call unexpanded with a visible warning when disabled", () => {
    setComptimeEvaluationEnabled(false);
    const { printed, diagnostics } = expandComptime(`comptime(() => 1 + 1);`);
    expect(printed).toContain("comptime(");
    expect(diagnostics.some((d) => d.severity === "warning" && /disabled/.test(d.message))).toBe(
      true
    );
  });
});

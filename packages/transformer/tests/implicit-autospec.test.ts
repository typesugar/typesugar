/**
 * A call completed by `= implicit()` is auto-specialized exactly as the
 * explicit call `showValue(42, showNumber)` would be (Dean's decision
 * 2026-10-19, superseding the PEP-056 parity choice in commit 7210ac66, which
 * kept implicit calls as plain dictionary passing).
 */
import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import { transformCode } from "../src/pipeline.js";

const PRELUDE = `
import { summon, implicit } from "typesugar";

/** @typeclass */
interface Show<A> {
  show(value: A): string;
}

/** @impl Show<number> */
const showNumber: Show<number> = {
  show: (n) => String(n),
};
`;

/** Transpile to CJS and run; returns what `result` evaluated to. */
function runResult(code: string): unknown {
  const js = ts.transpileModule(`${code}\nexports.__result = result;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports: Record<string, unknown> = {};
  const req = (m: string) => {
    if (m === "typesugar") return { implicit: () => undefined, summon: () => undefined };
    throw new Error(`unexpected runtime import of '${m}'`);
  };
  new Function("exports", "require", js)(exports, req);
  return exports.__result;
}

describe("implicit resolution is followed by auto-specialization", () => {
  it("showValue(42) becomes a hoisted specialization with show inlined, and runs", () => {
    const code = `${PRELUDE}
function showValue(value: number, S: Show<number> = implicit()): string {
  return S.show(value);
}

const result = showValue(42);
`;

    const r = transformCode(code, { fileName: "test-impl-inline.ts" });

    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(r.code).toMatch(/const result = __typesugar___showValue_\w+__\(42\);/);
    expect(r.code).not.toContain("showValue(42, showNumber)");
    expect(runResult(r.code)).toBe("42");
  });

  it("keeps the wrapper logic of a non-trivial body in the specialization, and runs", () => {
    const code = `${PRELUDE}
function showValue(value: number, S: Show<number> = implicit()): string {
  return \`show \${S.show(value)}\`;
}

const result = showValue(42);
`;

    const r = transformCode(code, { fileName: "test-impl-template.ts" });

    // Resolved via scope (PEP-052): the in-scope @impl const `showNumber`,
    // then specialized; the template wrapper survives in the hoisted body.
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(r.code).toMatch(/const result = __typesugar___showValue_\w+__\(42\);/);
    expect(r.code).not.toContain("showValue(42, showNumber)");
    expect(runResult(r.code)).toBe("show 42");
  });
});

describe("implicit parameters line up with arguments", () => {
  const noDiagnostics = (r: ReturnType<typeof transformCode>) =>
    expect(r.diagnostics.map((d) => d.message)).toEqual([]);

  it("skips a `this` parameter, which takes no argument", () => {
    const code = `${PRELUDE}
const box = {
  label: "n=",
  show(this: { label: string }, value: number, S: Show<number> = implicit()): string {
    return this.label + S.show(value);
  },
};

const result = box.show(42);
`;
    const r = transformCode(code, { fileName: "test-impl-this-param.ts" });
    // An object-literal method isn't specialized (TS9602); dictionary passing.
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(r.code).not.toContain("undefined, showNumber");
    expect(runResult(r.code)).toBe("n=42");
  });

  it("fills a call through .call(thisArg, ...args)", () => {
    const code = `${PRELUDE}
function show(this: { label: string }, value: number, S: Show<number> = implicit()): string {
  return this.label + S.show(value);
}

const result = show.call({ label: "n=" }, 42);
`;
    const r = transformCode(code, { fileName: "test-impl-fn-call.ts" });
    noDiagnostics(r);
    expect(r.code).toContain(`show.call({ label: "n=" }, 42, showNumber)`);
    expect(runResult(r.code)).toBe("n=42");
  });

  it("infers a type argument from the arguments after thisArg", () => {
    const code = `${PRELUDE}
function show<A>(this: unknown, value: A, S: Show<A> = implicit()): string {
  return S.show(value);
}

const result = show.call(null, 7);
`;
    const r = transformCode(code, { fileName: "test-impl-fn-call-generic.ts" });
    noDiagnostics(r);
    expect(runResult(r.code)).toBe("7");
  });

  it("supplies thisArg when .call() has no arguments", () => {
    const code = `${PRELUDE}
function seven(S: Show<number> = implicit()): string {
  return S.show(7);
}

const result = seven.call();
`;
    const r = transformCode(code, { fileName: "test-impl-fn-call-empty.ts" });
    noDiagnostics(r);
    expect(r.code).toContain("seven.call(undefined, showNumber)");
    expect(runResult(r.code)).toBe("7");
  });

  it("leaves an object's own call method to its own signature", () => {
    const code = `${PRELUDE}
const runner = {
  call(value: number, S: Show<number> = implicit()): string {
    return "own " + S.show(value);
  },
};

const result = runner.call(3);
`;
    const r = transformCode(code, { fileName: "test-impl-own-call.ts" });
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(runResult(r.code)).toBe("own 3");
  });
});

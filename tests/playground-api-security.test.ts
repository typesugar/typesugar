/**
 * Security regression tests for the public playground endpoints (api/run.ts,
 * api/compile.ts). Review finding tooling #1: /api/run executed user code
 * in-process under node:vm (host-realm constructors in the context, a
 * blocklist require) and /api/compile ran comptime blocks — both RCE + env
 * leak on a public URL.
 */
import { describe, it, expect, afterEach } from "vitest";
import { isComptimeEvaluationEnabled, setComptimeEvaluationEnabled } from "@typesugar/macros";

interface FakeRes {
  statusCode: number;
  body: any;
  headers: Record<string, string>;
  status(code: number): FakeRes;
  json(body: unknown): FakeRes;
  setHeader(k: string, v: string): void;
}

function fakeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 0,
    body: undefined,
    headers: {},
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(body) {
      res.body = body;
      return res;
    },
    setHeader(k, v) {
      res.headers[k] = v;
    },
  };
  return res;
}

function fakeReq(body: unknown, method = "POST", ip = "203.0.113.7"): any {
  return { method, body, headers: { "x-forwarded-for": ip }, socket: {} };
}

afterEach(() => {
  delete process.env.__TYPESUGAR_PWNED_RUN;
  delete process.env.__TYPESUGAR_PWNED_COMPTIME;
});

describe("/api/run", () => {
  it("does not execute user code (host-realm escape is impossible because nothing runs)", async () => {
    const { default: handler } = await import("../api/run.js");
    const res = fakeRes();
    await handler(
      fakeReq({
        code: `const p = Error.constructor("return process")(); p.env.__TYPESUGAR_PWNED_RUN = "1";`,
      }),
      res as any
    );
    expect(process.env.__TYPESUGAR_PWNED_RUN).toBeUndefined();
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/not available on the public playground/);
    expect(res.body.output).toEqual([]);
  });

  it("does not hand out node built-ins via require (no blocklist to bypass)", async () => {
    const { default: handler } = await import("../api/run.js");
    const res = fakeRes();
    await handler(
      fakeReq({
        code: `require("node:child_process"); process.env.__TYPESUGAR_PWNED_RUN = "1";`,
      }),
      res as any
    );
    expect(process.env.__TYPESUGAR_PWNED_RUN).toBeUndefined();
    expect(res.statusCode).toBe(403);
  });
});

describe("/api/compile", () => {
  it("disables comptime evaluation on import", async () => {
    setComptimeEvaluationEnabled(true);
    await import("../api/compile.js");
    // The module-level call runs once per module instance; vitest caches the
    // module, so re-assert via a fresh compile below as well.
    const { default: handler } = await import("../api/compile.js");
    const res = fakeRes();
    await handler(
      fakeReq({
        code: [
          `import { comptime } from "typesugar";`,
          `export const leaked = comptime(() => {`,
          `  const p = (globalThis as any).process ?? Error.constructor("return process")();`,
          `  p.env.__TYPESUGAR_PWNED_COMPTIME = "1";`,
          `  return 42;`,
          `});`,
        ].join("\n"),
        fileName: "comptime-probe.ts",
      }),
      res as any
    );
    expect(process.env.__TYPESUGAR_PWNED_COMPTIME).toBeUndefined();
    expect(isComptimeEvaluationEnabled()).toBe(false);
    expect(res.statusCode).toBe(200);
    // comptime(...) is left unexpanded, never folded to 42
    expect(res.body.code).not.toMatch(/leaked\s*=\s*42/);
  });

  it("does not let fileName point outside the playground's virtual file", async () => {
    const { default: handler } = await import("../api/compile.js");
    const res = fakeRes();
    await handler(
      fakeReq({ code: `export const x = 1;`, fileName: "../../../../etc/passwd.ts" }),
      res as any
    );
    expect(res.statusCode).toBe(200);
    for (const d of res.body.diagnostics ?? []) {
      expect(String(d.file)).not.toContain("/etc/");
    }
  });
});

/**
 * PEP-063 Wave 1: around-advice written as a typeclass instance inlines to
 * zero cost. `return T.around("op", () => expr)` with a block-bodied
 * `around` (try/finally, loops) is inlined as statements into the hoisted
 * specialization, and a thunk argument called once is beta-reduced.
 */
import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import { transformCode } from "../src/pipeline.js";

const PRELUDE = `
import { implicit } from "typesugar";

/** @typeclass */
interface Around<S> {
  around<R>(op: string, body: () => R): R;
}

interface Svc { readonly _tag: "Svc" }

const events: string[] = [];
`;

/** Transpile to CJS and run; returns what `result` evaluated to and the events. */
function run(code: string): { result: unknown; events: string[] } {
  const js = ts.transpileModule(`${code}\nexports.__result = result;\nexports.__events = events;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports: Record<string, unknown> = {};
  const req = (m: string) => {
    if (m === "typesugar") return { implicit: () => undefined };
    throw new Error(`unexpected runtime import of '${m}'`);
  };
  new Function("exports", "require", js)(exports, req);
  return { result: exports.__result, events: exports.__events as string[] };
}

function transform(code: string, fileName: string) {
  const r = transformCode(code, { fileName });
  expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  return r;
}

/** The hoisted specialization's text (everything up to the first `/** @typeclass`). */
function specialization(code: string): string {
  const m = /const __typesugar___\w+__ = [\s\S]*?\n};/.exec(code);
  expect(m, "expected a hoisted specialization").not.toBeNull();
  return m![0];
}

describe("around-advice inlining (PEP-063 Wave 1)", () => {
  it("beta-reduces a no-op around: no closure is left", () => {
    const r = transform(
      `${PRELUDE}
/** @impl Around<Svc> */
const noop: Around<Svc> = { around: (op, body) => body() };

function getUser(id: string, T: Around<Svc> = implicit()): string {
  return T.around("getUser", () => "user:" + id);
}
const result = getUser("1");
`,
      "around-noop.ts"
    );
    const spec = specialization(r.code);
    expect(spec).toContain('"user:" + id');
    expect(spec).not.toContain('=> "user:"');
    expect(spec).not.toMatch(/\)\(\)/);
    expect(run(r.code).result).toBe("user:1");
  });

  it("inlines a try/finally around as statements, with op substituted and locals renamed", () => {
    const r = transform(
      `${PRELUDE}
/** @impl Around<Svc> */
const timed: Around<Svc> = {
  around: (op, body) => {
    const t0 = events.length;
    try {
      return body();
    } finally {
      events.push(op + ":" + t0);
    }
  },
};

function getUser(id: string, T: Around<Svc> = implicit()): string {
  return T.around("getUser", () => "user:" + id);
}
const result = getUser("7");
`,
      "around-try-finally.ts"
    );
    expect(r.diagnostics.some((d) => /TS9602/.test(d.message ?? ""))).toBe(false);
    const spec = specialization(r.code);
    expect(spec).toContain("try");
    expect(spec).toContain('"getUser"');
    expect(spec).not.toMatch(/\bconst t0\b/);
    expect(r.code).not.toContain('getUser("7", timed)');
    expect(run(r.code)).toEqual({ result: "user:7", events: ["getUser:0"] });
  });

  it("keeps a retry loop's semantics when the thunk is reduced inside the loop", () => {
    const r = transform(
      `${PRELUDE}
/** @impl Around<Svc> */
const retried: Around<Svc> = {
  around: (op, body) => {
    let last: unknown;
    for (let i = 0; i < 3; i++) {
      try {
        return body();
      } catch (e) {
        last = e;
        events.push(op + " failed");
      }
    }
    throw last;
  },
};

let attempts = 0;
function flaky(): number {
  attempts++;
  if (attempts < 3) throw new Error("nope");
  return attempts;
}
function load(T: Around<Svc> = implicit()): number {
  return T.around("load", () => flaky());
}
const result = load();
`,
      "around-retry.ts"
    );
    expect(r.code).not.toContain("load(retried)");
    expect(run(r.code)).toEqual({ result: 3, events: ["load failed", "load failed"] });
  });

  it("does not let a method local capture a caller name used in the thunk", () => {
    const r = transform(
      `${PRELUDE}
/** @impl Around<Svc> */
const timed: Around<Svc> = {
  around: (op, body) => {
    const t0 = 100;
    try {
      return body();
    } finally {
      events.push(op + ":" + t0);
    }
  },
};

function twice(t0: number, T: Around<Svc> = implicit()): number {
  return T.around("twice", () => t0 * 2);
}
const result = twice(21);
`,
      "around-hygiene.ts"
    );
    expect(run(r.code)).toEqual({ result: 42, events: ["twice:100"] });
  });

  it("declines when the caller binds a name the advice reads, and still runs", () => {
    const r = transformCode(
      `${PRELUDE}
function note(s: string): void { events.push(s); }

/** @impl Around<Svc> */
const logged: Around<Svc> = {
  around: (op, body) => {
    try {
      return body();
    } finally {
      note(op);
    }
  },
};

function get(id: string, T: Around<Svc> = implicit()): string {
  const note = (s: string) => s.toUpperCase();
  return T.around(note("get"), () => id);
}
const result = get("x");
`,
      { fileName: "around-capture.ts" }
    );
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(run(r.code)).toEqual({ result: "x", events: ["GET"] });
  });

  it("returns undefined from an around that falls off its end", () => {
    const r = transform(
      `${PRELUDE}
/** @impl Around<Svc> */
const fireAndForget: Around<Svc> = {
  around: (op, body) => {
    const r = body();
    events.push(op + "=" + String(r));
  },
} as unknown as Around<Svc>;

function ping(T: Around<Svc> = implicit()): unknown {
  return T.around("ping", () => 5);
}
const result = ping();
`,
      "around-fallthrough.ts"
    );
    expect(run(r.code)).toEqual({ result: undefined, events: ["ping=5"] });
  });

  it("evaluates a non-literal argument once, before the body", () => {
    const r = transform(
      `${PRELUDE}
/** @impl Around<Svc> */
const twiceNamed: Around<Svc> = {
  around: (op, body) => {
    events.push("enter " + op);
    try {
      return body();
    } finally {
      events.push("exit " + op);
    }
  },
};

let n = 0;
function nextName(): string {
  n++;
  return "op" + n;
}
function work(T: Around<Svc> = implicit()): number {
  return T.around(nextName(), () => n);
}
const result = work();
`,
      "around-effectful-arg.ts"
    );
    expect(run(r.code)).toEqual({ result: 1, events: ["enter op1", "exit op1"] });
  });

  it("inlines an async around into an async caller", async () => {
    const r = transform(
      `${PRELUDE}
/** @typeclass */
interface AroundAsync<S> {
  around<R>(op: string, body: () => Promise<R>): Promise<R>;
}

/** @impl AroundAsync<Svc> */
const asyncTimed: AroundAsync<Svc> = {
  around: async (op, body) => {
    events.push("start " + op);
    try {
      return await body();
    } finally {
      events.push("end " + op);
    }
  },
};

async function fetchUser(id: string, T: AroundAsync<Svc> = implicit()): Promise<string> {
  return T.around("fetchUser", () => Promise.resolve("u" + id));
}
const result = fetchUser("9");
`,
      "around-async.ts"
    );
    const spec = specialization(r.code);
    expect(spec).toMatch(/async/);
    expect(spec).toContain("await");
    const out = run(r.code);
    expect(await out.result).toBe("u9");
    expect(out.events).toEqual(["start fetchUser", "end fetchUser"]);
  });

  it("inlines a concise-arrow caller", () => {
    const r = transform(
      `${PRELUDE}
/** @impl Around<Svc> */
const timed: Around<Svc> = {
  around: (op, body) => {
    try {
      return body();
    } finally {
      events.push(op);
    }
  },
};

const getUser = (id: string, T: Around<Svc> = implicit()): string =>
  T.around("getUser", () => "user:" + id);
const result = getUser("2");
`,
      "around-concise.ts"
    );
    expect(r.code).not.toContain('getUser("2", timed)');
    expect(run(r.code)).toEqual({ result: "user:2", events: ["getUser"] });
  });
});

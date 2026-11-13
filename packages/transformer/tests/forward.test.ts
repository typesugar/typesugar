/**
 * PEP-063 Wave 2: forward<S>(inner, advice) generates a typed forwarding
 * object for an interface, with each advice's `around` inlined per method.
 */
import { describe, it, expect, afterEach } from "vitest";
import * as ts from "typescript";
import { transformCode } from "../src/pipeline.js";
import { setCfgConfig } from "@typesugar/macros";

const PRELUDE = `
import { forward } from "typesugar";

interface UserRepo {
  get(id: string): string;
  save(name: string, ...tags: string[]): number;
  readonly kind: string;
  count: number;
}

const events: string[] = [];

class MemRepo implements UserRepo {
  readonly kind = "mem";
  count = 0;
  #secret = "s";
  get(id: string): string {
    return "user:" + id + ":" + this.#secret;
  }
  save(name: string, ...tags: string[]): number {
    this.count++;
    return name.length + tags.length;
  }
}
`;

function run(code: string): { result: unknown; events: string[] } {
  const js = ts.transpileModule(`${code}\nexports.__result = result;\nexports.__events = events;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Record<string, unknown> = {};
  const req = (m: string) => {
    if (m === "typesugar") return {};
    throw new Error(`unexpected runtime import of '${m}'`);
  };
  new Function("exports", "require", js)(exports, req);
  return { result: exports.__result, events: exports.__events as string[] };
}

function transform(code: string, fileName: string) {
  const r = transformCode(code, { fileName });
  expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  expect(r.code).not.toMatch(/\bforward<UserRepo>\(/);
  return r;
}

/** Type-check the expanded code (strict), returning error messages. */
function typeErrors(code: string): string[] {
  const fileName = "/virtual/expanded.ts";
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, lang) =>
    name === fileName ? ts.createSourceFile(name, code, lang) : getSourceFile(name, lang);
  const program = ts.createProgram([fileName], options, host);
  return ts
    .getPreEmitDiagnostics(program, program.getSourceFile(fileName))
    .filter((d) => d.code !== 2307) // the virtual file can't resolve "typesugar"
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
}

afterEach(() => setCfgConfig({}));

describe("forward<S>() (PEP-063 Wave 2)", () => {
  it("forwards every member and inlines an around advice per method", () => {
    const r = transform(
      `${PRELUDE}
const repo = forward<UserRepo>(new MemRepo(), {
  around: (method, args, next) => {
    events.push("enter " + method + " " + args.length);
    try {
      return next();
    } finally {
      events.push("exit " + method);
    }
  },
});
repo.count = 5;
const result = [repo.get("1"), repo.save("ann", "a", "b"), repo.kind, repo.count];
`,
      "forward-basic.ts"
    );
    expect(r.code).toContain('events.push("enter " + "get"');
    expect(r.code).toContain("return inner.get(id)");
    expect(r.code).not.toMatch(/advice0/);
    expect(run(r.code)).toEqual({
      result: ["user:1:s", 5, "mem", 6],
      events: ["enter get 1", "exit get", "enter save 3", "exit save"],
    });
    expect(typeErrors(r.code)).toEqual([]);
  });

  it("applies the advice only to the members listed in `only`", () => {
    const r = transform(
      `${PRELUDE}
const repo = forward<UserRepo>(new MemRepo(), {
  around: (method, args, next) => {
    events.push(method);
    return next();
  },
  only: ["save"],
});
const result = [repo.get("1"), repo.save("x")];
`,
      "forward-only.ts"
    );
    expect(r.code).toMatch(/get\(id\) \{\s*return inner\.get\(id\);\s*\}/);
    expect(run(r.code)).toEqual({ result: ["user:1:s", 1], events: ["save"] });
  });

  it("emits the wrapped object itself when `when` is false", () => {
    setCfgConfig({ metrics: false });
    const r = transform(
      `${PRELUDE}
const repo = forward<UserRepo>(new MemRepo(), {
  around: (method, args, next) => next(),
  when: "metrics",
});
const result = repo.get("2");
`,
      "forward-when-off.ts"
    );
    expect(r.code).toContain("const repo = new MemRepo();");
    expect(run(r.code).result).toBe("user:2:s");
  });

  it("keeps the advice when `when` is true", () => {
    setCfgConfig({ metrics: true });
    const r = transform(
      `${PRELUDE}
const repo = forward<UserRepo>(new MemRepo(), {
  around: (method, args, next) => {
    events.push(method);
    return next();
  },
  when: "metrics",
});
const result = repo.get("2");
`,
      "forward-when-on.ts"
    );
    expect(run(r.code)).toEqual({ result: "user:2:s", events: ["get"] });
  });

  it("nests a list of advices, first outermost", () => {
    const r = transform(
      `${PRELUDE}
const repo = forward<UserRepo>(new MemRepo(), [
  { around: (method, args, next) => { events.push("outer"); return next(); } },
  { around: (method, args, next) => { events.push("inner"); return next(); } },
]);
const result = repo.get("3");
`,
      "forward-order.ts"
    );
    expect(run(r.code)).toEqual({ result: "user:3:s", events: ["outer", "inner"] });
  });

  it("calls a non-literal advice through a parameter, evaluated once", () => {
    const r = transform(
      `${PRELUDE}
let made = 0;
function counting() {
  made++;
  return {
    around: (method: string, args: unknown[], next: () => any) => {
      events.push(method);
      return next();
    },
  };
}
const repo = forward<UserRepo>(new MemRepo(), counting());
const result = [repo.get("4"), repo.get("5"), made];
`,
      "forward-reference.ts"
    );
    expect(r.code).toContain("advice0.around(");
    expect(run(r.code)).toEqual({ result: ["user:4:s", "user:5:s", 1], events: ["get", "get"] });
  });

  it("does not let a member parameter capture a name the advice reads", () => {
    const r = transform(
      `${PRELUDE}
const id = "outer-id";
const repo = forward<UserRepo>(new MemRepo(), {
  around: (method, args, next) => {
    events.push(method + "@" + id);
    return next();
  },
  only: ["get"],
});
const result = repo.get("6");
`,
      "forward-capture.ts"
    );
    expect(run(r.code)).toEqual({ result: "user:6:s", events: ["get@outer-id"] });
  });

  it("inlines an async advice into promise-returning members only", async () => {
    const r = transform(
      `
import { forward } from "typesugar";
interface Api {
  load(id: string): Promise<string>;
  name(): string;
}
const events: string[] = [];
const api: Api = { load: async (id) => "loaded " + id, name: () => "api" };
const wrapped = forward<Api>(api, {
  around: async (method, args, next) => {
    events.push("start " + method);
    try {
      return await next();
    } finally {
      events.push("end " + method);
    }
  },
});
const result = Promise.all([wrapped.load("7"), wrapped.name()]);
`,
      "forward-async.ts"
    );
    expect(r.code).toMatch(/load\(id\) \{\s*return \(async \(\) =>/);
    const out = run(r.code);
    expect(await out.result).toEqual(["loaded 7", "api"]);
    expect(out.events).toEqual(["start load", "end load"]);
  });

  it("makes the next thunk async when an inner advice in the list is async", async () => {
    const r = transform(
      `
import { forward } from "typesugar";
interface Api {
  load(id: string): Promise<string>;
}
const events: string[] = [];
const api: Api = { load: async (id) => "loaded " + id };
const wrapped = forward<Api>(api, [
  { around: (method, args, next) => { events.push("outer " + method); return next(); } },
  {
    around: async (method, args, next) => {
      const r = await next();
      events.push("inner " + r);
      return r;
    },
  },
]);
const result = wrapped.load("8");
`,
      "forward-async-inner.ts"
    );
    expect(r.code).toMatch(/async \(\) =>/);
    const out = run(r.code);
    expect(await out.result).toBe("loaded 8");
    expect(out.events).toEqual(["outer load", "inner loaded 8"]);
  });

  it("forwards generic members with their contextual types", () => {
    const r = transform(
      `
import { forward } from "typesugar";
interface Box {
  wrap<T>(value: T): { value: T };
}
const events: string[] = [];
const box: Box = { wrap: (value) => ({ value }) };
const fwd = forward<Box>(box, { around: (method, args, next) => next() });
const result = fwd.wrap(42).value;
`,
      "forward-generic.ts"
    );
    expect(run(r.code).result).toBe(42);
    expect(typeErrors(r.code)).toEqual([]);
  });
});

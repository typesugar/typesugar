/**
 * Execution tests for `let:` / `par:` comprehensions (deep review 1.0,
 * findings #7-#12). Every test transforms through the real pipeline and RUNS
 * the emitted code, asserting the value the docs promise.
 */
import { describe, it, expect } from "vitest";
import { collectReferencedIdentifiers } from "../src/macros/comprehension-utils.js";
import * as ts from "typescript";
import { transformAndRun } from "./match-exec-helpers.js";

const call = (r: { exports: Record<string, unknown> }) => (r.exports.r as () => unknown)();

function run(body: string) {
  const r = transformAndRun(`import "@typesugar/std/syntax/do";\n${body}`);
  if (r.runError) {
    throw new Error(
      `emitted code failed to run: ${String(r.runError)}\n--- emitted ---\n${r.code}`
    );
  }
  return r;
}

describe("let: guards (#7)", () => {
  it("filters Array results instead of inserting undefined", () => {
    const r = run(`export const r =
let: {
  x << [1, 2, 3, 4, 5];
  if (x % 2 === 0) {}
}
yield: { x }`);
    expect(r.errors).toEqual([]);
    expect(r.exports.r).toEqual([2, 4]);
  });

  it("guard before a later bind filters too", () => {
    const r = run(`export const r =
let: {
  x << [1, 2, 3];
  if (x > 1) {}
  y << [x * 10];
}
yield: { y }`);
    expect(r.exports.r).toEqual([20, 30]);
  });

  it("pythagorean triples (docs example)", () => {
    const r = run(`const n = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
export const r =
let: {
  a << n;
  b << n;
  c << n;
  if (a * a + b * b === c * c && a <= b) {}
}
yield: { [a, b, c] }`);
    expect(r.exports.r).toEqual([
      [3, 4, 5],
      [6, 8, 10],
    ]);
  });

  it("guards on a brand without an empty value are a compile error", () => {
    const r = transformAndRun(`import "@typesugar/std/syntax/do";
declare const p: Promise<number>;
export const r =
let: {
  x << p;
  if (x > 1) {}
}
yield: { x }`);
    expect(r.errors.join("\n")).toMatch(/guard/i);
  });
});

describe("let: without yield: (#8)", () => {
  it("returns the last binding's effect, flattened (Array)", () => {
    const r = run(`export const r =
let: {
  x << [1, 2];
  y << [x, x * 10];
}`);
    expect(r.exports.r).toEqual([1, 10, 2, 20]);
  });

  it("returns the last binding's effect, flattened (Promise)", async () => {
    const r = run(`export const r =
let: {
  x << Promise.resolve(10);
  y << Promise.resolve(x * 2);
}`);
    await expect(r.exports.r).resolves.toBe(20);
  });

  it("steps after the last binding without yield: are an error, not dropped", () => {
    const r = transformAndRun(`import "@typesugar/std/syntax/do";
export const r =
let: {
  x << [1, 2];
  if (x > 1) {}
}`);
    expect(r.errors.join("\n")).toMatch(/yield/);
  });
});

// Statement position + a sink in yield: the transformer's `const r = let: {...}`
// merge path doesn't handle a nested labeled `par:` block (see report).
describe("nested par: inside let: (#9)", () => {
  const SINK = `export const out: unknown[] = [];
const sink = (v: unknown) => { out.push(v); return v; };
`;

  it("Array: cartesian product", () => {
    const r = run(`${SINK}
let: {
  a << [1, 2];
  par: { b << [10, 20]; c << [100] }
}
yield: { sink(a + b + c) }`);
    expect(r.errors).toEqual([]);
    expect(r.exports.out).toEqual([111, 121, 112, 122]);
  });

  it("Array: par: group followed by another bind", () => {
    const r = run(`${SINK}
let: {
  z << [0];
  par: { b << [1, 2]; c << [10] }
  d << [z + b + c, -(b + c)]
}
yield: { sink(d) }`);
    expect(r.errors).toEqual([]);
    expect(r.exports.out).toEqual([11, -11, 12, -12]);
  });

  it("Promise: par: group followed by another bind", async () => {
    const r = run(`${SINK}
let: {
  a << Promise.resolve(1);
  par: { b << Promise.resolve(2); c << Promise.resolve(3) }
  d << Promise.resolve(a + b + c)
}
yield: { sink(d * 10) }`);
    expect(r.errors).toEqual([]);
    await new Promise((res) => setTimeout(res, 0));
    expect(r.exports.out).toEqual([60]);
  });

  it("Promise: final par: group with a _ discard", async () => {
    const r = run(`${SINK}
let: {
  a << Promise.resolve(1);
  par: { _ << Promise.resolve(0); _ << Promise.resolve(0); c << Promise.resolve(3) }
}
yield: { sink(a + c) }`);
    expect(r.errors).toEqual([]);
    await new Promise((res) => setTimeout(res, 0));
    expect(r.exports.out).toEqual([4]);
  });
});

describe("Iterable / AsyncIterable let: (#10)", () => {
  it("plain Iterable (Set) works without .flatMap on the receiver", () => {
    const r = run(`const s: Iterable<number> = new Set([1, 2]);
export const f =
let: {
  x << s;
  y << s;
}
yield: { x * 10 + y }
export const r = () => Array.from(f);`);
    expect(r.errors).toEqual([]);
    expect(call(r)).toEqual([11, 12, 21, 22]);
  });

  it("AsyncIterable works", async () => {
    const r = run(`async function* gen(): AsyncIterable<number> { yield 1; yield 2; }
const ai = gen;
export const r =
let: {
  x << ai();
}
yield: { x + 1 }`);
    expect(r.errors).toEqual([]);
    const out: number[] = [];
    for await (const v of r.exports.r as AsyncIterable<number>) out.push(v);
    expect(out).toEqual([2, 3]);
  });
});

// Top-level `par:` is used at statement position here: the transformer's
// expression-position preprocess doesn't handle `const r = par: {...}` (see
// report). Results are captured through a sink in the yield expression.
describe("par: with discard bindings (#11)", () => {
  it("two \`_\` bindings in a Promise par: compile and run", async () => {
    const r = run(`const log: string[] = [];
const say = async (s: string) => { log.push(s); };
export const out: unknown[] = [];
export const l = log;
const sink = (v: unknown) => { out.push(v); return v; };
par: {
  _ << say("a");
  _ << say("b");
  n << Promise.resolve(1);
}
yield: { sink(n) }`);
    expect(r.errors).toEqual([]);
    await new Promise((res) => setTimeout(res, 0));
    expect(r.exports.out).toEqual([1]);
    expect(r.exports.l).toEqual(["a", "b"]);
  });

  it("two \`_\` bindings in an Array par: compile and run", () => {
    const r = run(`export const out: unknown[] = [];
const sink = (v: unknown) => { out.push(v); return v; };
par: {
  _ << [0, 0];
  _ << [0];
  n << [1, 2];
}
yield: { sink(n) }`);
    expect(r.exports.out).toEqual([1, 2, 1, 2]);
  });

  it("duplicate non-discard names in par: are an error", () => {
    const r = transformAndRun(`import "@typesugar/std/syntax/do";
par: {
  a << Promise.resolve(1);
  a << Promise.resolve(2);
}
yield: { a }`);
    expect(r.errors.join("\n")).toMatch(/'a'/);
  });
});

describe("par: independence check (#12)", () => {
  const refs = (src: string) => {
    const sf = ts.createSourceFile("x.ts", `(${src})`, ts.ScriptTarget.Latest, true);
    const stmt = sf.statements[0] as ts.ExpressionStatement;
    return collectReferencedIdentifiers(stmt.expression);
  };

  it("property names are not references", () => {
    expect(refs("req.user").has("user")).toBe(false);
    expect(refs("req.user").has("req")).toBe(true);
  });

  it("object-literal keys are not references, shorthand values are", () => {
    const r = refs("({ user: 1, posts })");
    expect(r.has("user")).toBe(false);
    expect(r.has("posts")).toBe(true);
  });

  it("nested function parameters shadow outer names", () => {
    const r = refs("xs.map((user) => user.id)");
    expect(r.has("user")).toBe(false);
    expect(r.has("xs")).toBe(true);
  });

  it("a par: binding that only shares a property name with another compiles", async () => {
    const r = run(`const req = { user: "u1" };
export const out: unknown[] = [];
const sink = (v: unknown) => { out.push(v); return v; };
par: {
  user << Promise.resolve(1);
  posts << Promise.resolve(req.user);
}
yield: { sink({ user, posts }) }`);
    expect(r.errors).toEqual([]);
    await new Promise((res) => setTimeout(res, 0));
    expect(r.exports.out).toEqual([{ user: 1, posts: "u1" }]);
  });
});

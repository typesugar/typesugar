/**
 * `typesugar check` hides a TypeScript error only where `typesugar build`
 * rewrites the code that causes it. Each case here is one where the
 * diagnostic suppression rules and the transformer used to decide
 * differently (round 6 of the PR #83 review):
 *
 * - The ExtensionMethodCall rule kept its own copy of the import-provider
 *   rules, without the transformer's checks (unopted module namespaces,
 *   default-lib members, `declare global` stubs, a typeclass instance for
 *   another type), and hid TS2339 on calls the build left as written: a
 *   TypeError at run time. It now calls the transformer's decision
 *   (`findImportedExtensionMatches`).
 * - A union instance (`@impl Describe<Shape>`) did not serve a receiver
 *   narrowed to a member (`if (t.kind === "circle") t.describe()`): check
 *   passed, the build left the call, and it threw.
 * - The OperatorOverload rule's TS2365 branch had its own instance lookup:
 *   it missed a const bound to a rewritten operator (`const p = a * b;
 *   p + a`) and a narrowed operand of a union instance, which the rewrite
 *   handles, and reported an error on code that builds and runs.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pkgRoot, "..", "..");
const cliPath = path.join(pkgRoot, "dist", "cli.js");
const hasBuild = fs.existsSync(cliPath);

function makeProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-agree-"));
  fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(dir, "node_modules"), "dir");
  fs.writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        skipLibCheck: true,
        types: [],
        outDir: "out",
      },
      include: ["src"],
    })
  );
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "fixture", private: true, type: "module" })
  );
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  return dir;
}

function cli(dir: string, command: "check" | "build"): { status: number | null; output: string } {
  const r = spawnSync(process.execPath, [cliPath, command], {
    cwd: dir,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  });
  return { status: r.status, output: (r.stdout ?? "") + (r.stderr ?? "") };
}

function run(dir: string, file: string): { status: number | null; output: string } {
  const r = spawnSync(process.execPath, [path.join(dir, "out", file)], {
    cwd: dir,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60_000,
  });
  return { status: r.status, output: (r.stdout ?? "") + (r.stderr ?? "") };
}

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

describe.skipIf(!hasBuild)(
  "ExtensionMethodCall: check reports what build leaves as written",
  () => {
    let dir: string;
    beforeAll(() => {
      dir = makeProject({
        // (a) A named import of a whole module namespace that never opted in.
        "src/ns-impl.ts": `export function shout(self: { v: number }): string { return "!" + self.v; }\n`,
        "src/ns.ts": `export * as NS from "./ns-impl.js";\n`,
        "src/a.ts": `import { NS } from "./ns.js";
const o = { v: 1 };
console.log(o.shout());
`,
        // (b) A member every function has from the standard library.
        "src/fn.ts": `export function helper(x: number): number { return x; }\n`,
        "src/b.ts": `import { helper } from "./fn.js";
const o = { v: 1 };
console.log(o.call(1));
`,
        // (c) A \`declare global\` stub seen through an imported value's apparent type.
        "src/stub.ts": `declare global { interface Number { twiceIt(x: unknown): number } }
export const LT = 1;
`,
        "src/c.ts": `import { LT } from "./stub.js";
const o = { v: 1 };
console.log(o.twiceIt(2));
`,
        // (d) A typeclass instance FOR another type (enum vs number).
        "src/show.ts": `/** @typeclass */
export interface Show<A> { show(a: A): string }
export enum Color { Red, Green }
/** @impl Show<Color> */
export const showColor: Show<Color> = { show: (c) => (c === Color.Red ? "red" : "green") };
`,
        "src/d.ts": `import { showColor } from "./show.js";
const n: number = 3;
console.log(n.show());
`,
      });
      dirs.push(dir);
    });

    let output = "";
    beforeAll(() => {
      output = cli(dir, "check").output;
    });
    it.each([
      ["a", "an unopted module namespace"],
      ["b", "a default-lib member (Function.prototype.call)"],
      ["c", "a declare-global stub"],
      ["d", "an instance for another type (enum Color vs number)"],
    ])("%s.ts: %s is reported (TS2339)", (file) => {
      expect(output).toMatch(new RegExp(`${file}\\.ts\\(3,\\d+\\): error TS2339`));
    });
  }
);

describe.skipIf(!hasBuild)("a union instance serves a receiver narrowed to a member", () => {
  let dir: string;
  beforeAll(() => {
    dir = makeProject({
      "src/shapes.ts": `/** @typeclass */
export interface Describe<A> { describe(a: A): string }
export interface Circle { kind: "circle"; r: number }
export interface Square { kind: "square"; s: number }
export type Shape = Circle | Square;
/** @impl Describe<Shape> */
export const describeShape: Describe<Shape> = {
  describe: (s) => (s.kind === "circle" ? \`circle \${s.r}\` : \`square \${s.s}\`),
};
`,
      "src/u1.ts": `import { describeShape, type Shape } from "./shapes.js";
const t: Shape = { kind: "circle", r: 2 } as Shape;
console.log(t.describe());
if (t.kind === "circle") console.log(t.describe());
`,
    });
    dirs.push(dir);
  });

  it("check passes, and the build rewrites both calls and runs", () => {
    const c = cli(dir, "check");
    expect(c.output).not.toMatch(/error TS/);
    expect(c.status, c.output).toBe(0);
    const b = cli(dir, "build");
    expect(b.status, b.output).toBe(0);
    const out = fs.readFileSync(path.join(dir, "out", "u1.js"), "utf-8");
    expect(out).not.toMatch(/t\.describe\(/);
    const r = run(dir, "u1.js");
    expect(r.status, r.output).toBe(0);
    expect(r.output).toBe("circle 2\ncircle 2\n");
  });
});

const RATIONALS = `import "@typesugar/std/syntax/numeric/ops";
import { rational, rationalToString } from "@typesugar/math";
const a = rational(1n, 2n);
const b = rational(1n, 3n);
`;

describe.skipIf(!hasBuild)("OperatorOverload: the rewrite's own decision", () => {
  let dir: string;
  beforeAll(() => {
    dir = makeProject({
      // A const bound to a rewritten operator, as the LEFT operand (TS2365).
      "src/k3.ts": `${RATIONALS}
const p = a * b;
console.log(rationalToString(p + a));
console.log(rationalToString(p * a));
console.log(rationalToString(a + p));
const q = p;
console.log(rationalToString(q + b));
`,
      // A narrowed operand of a union instance: the rewrite tries the
      // operands' declared type (Shape).
      "src/narrow.ts": `/** @typeclass */
export interface Measure<A> {
  /** @op < */ smaller(a: A, b: A): boolean;
  /** @op * */ times(a: A, b: A): number;
}
interface C { kind: "c"; r: number }
interface S { kind: "s"; s: number }
type Shape = C | S;
const size = (x: Shape): number => (x.kind === "c" ? x.r : x.s);
/** @impl Measure<Shape> */
export const measureShape: Measure<Shape> = {
  smaller: (a, b) => size(a) < size(b),
  times: (a, b) => size(a) * size(b),
};
const s: Shape = { kind: "c", r: 1 };
const t: Shape = { kind: "c", r: 2 };
console.log(s < t, s * t);
`,
    });
    dirs.push(dir);
  });

  it("check passes, and the build runs with the instance's results", () => {
    const c = cli(dir, "check");
    expect(c.output).not.toMatch(/error TS/);
    expect(c.status, c.output).toBe(0);
    const b = cli(dir, "build");
    expect(b.status, b.output).toBe(0);
    expect(fs.readFileSync(path.join(dir, "out", "k3.js"), "utf-8")).not.toMatch(/p \+ a|q \+ b/);
    const k3 = run(dir, "k3.js");
    expect(k3.status, k3.output).toBe(0);
    expect(k3.output).toBe("2/3\n1/12\n2/3\n1/2\n");
    const narrow = run(dir, "narrow.js");
    expect(narrow.status, narrow.output).toBe(0);
    expect(narrow.output).toBe("true 2\n");
  });
});

describe.skipIf(!hasBuild)("expression-position comprehensions in typesugar check / build", () => {
  // The CLI built its own program with only the HKT preprocessing, never the
  // pipeline's expression-comprehension rewrite: `build` emitted
  // `export const f = (id) => let, { user }; ...`, and `check` reported the
  // broken parse (TS1005, TS1128). TypeScript then still reported the
  // comprehension's own bodies (`a << e`, the labels), as for a
  // statement-position one, until the ComprehensionBlock rule.
  let dir: string;
  beforeAll(() => {
    dir = makeProject({
      "src/comp.ts": `import "@typesugar/std/syntax/do";
const fetchUser = (id: number) => Promise.resolve({ id, name: "u" + id });
const fetchAge = (_n: string) => Promise.resolve(40);

export const describe = (id: number) =>
  let: {
    user << fetchUser(id);
    age << fetchAge(user.name);
  }
  yield: \`\${user.name} is \${age}\`;

export const both =
  let: {
    a << Promise.resolve(1);
    b << Promise.resolve(2);
  }
  yield: a + b;

async function main() {
  console.log(await describe(7), await both);
}
main();
`,
    });
    dirs.push(dir);
  });

  it("check passes: no parse errors, nothing on the comprehension syntax or the preprocessor's tags", () => {
    const r = cli(dir, "check");
    expect(r.output).not.toMatch(/error TS/);
    expect(r.status, r.output).toBe(0);
  });

  it("build exits 0 and emits code that runs", () => {
    const b = cli(dir, "build");
    expect(b.status, b.output).toBe(0);
    const out = fs.readFileSync(path.join(dir, "out", "comp.js"), "utf-8");
    expect(out).not.toMatch(/=> let,|= let,|__letyield/);
    const r = run(dir, "comp.js");
    expect(r.status, r.output).toBe(0);
    expect(r.output).toBe("u7 is 40 3\n");
  });
});

describe.skipIf(!hasBuild)("statement-position comprehensions in typesugar check / build", () => {
  // `typesugar check` reported TypeScript's view of every comprehension's
  // own syntax -- TS1214 on the `let`/`yield` labels, TS2304 on the bound
  // names, TS2363 on each `a << e` -- and `typesugar build` exited 1 although
  // its output was right; the language service checks the expansion, so the
  // IDE showed none of it. Real errors in a step must still be reported.
  let dir: string;
  beforeAll(() => {
    dir = makeProject({
      "src/ok.ts": `import "@typesugar/std/syntax/do";
const fetchUser = (id: number) => Promise.resolve({ id, name: "u" + id });
const fetchAge = (_n: string) => Promise.resolve(40);
const fallback = () => Promise.resolve(0);

async function main() {
  const out: string[] = [];
  let: {
    user << fetchUser(7);
    age << fetchAge(user.name) || fallback();
    label = \`\${user.name}:\${age}\`;
    par: {
      a << fetchAge(label);
      b << fetchAge(user.name);
    }
  }
  yield: (out.push(\`\${label} \${a + b}\`));
  const r = par: { x << fetchUser(1); y << fetchUser(2); } yield: x.name + y.name;
  const names = await r;
  await new Promise((done) => setTimeout(done, 0));
  console.log(out, names);
}
main();
`,
      "src/bad.ts": `import "@typesugar/std/syntax/do";
const fetchUser = (id: number) => Promise.resolve({ id, name: "u" + id });
const fetchAge = (_n: string) => Promise.resolve(40);

export async function f() {
  let: {
    user << fetchUsr(7);
    age << fetchAge(42);
    posts << fetchAge(usr.name);
  }
  yield: ({ user, age, posts, nope });
}
`,
    });
    dirs.push(dir);
  });

  it("check: nothing on ok.ts; bad.ts's real errors only, at the lines as written", () => {
    const r = cli(dir, "check");
    expect(r.output).not.toMatch(/ok\.ts\(\d+,\d+\): error/);
    const errors = [...r.output.matchAll(/bad\.ts\((\d+),(\d+)\): error TS(\d+)/g)].map(
      (m) => `${m[1]}:${m[2]} TS${m[3]}`
    );
    // fetchUsr (unknown name), 42 (not a string), usr (not bound), nope; and
    // the macro's own error on the bind it can't type (fetchUsr).
    expect(errors).toEqual([
      "7:13 TS2552",
      "8:21 TS2345",
      "9:23 TS2304",
      "11:31 TS18004",
      "7:13 TS9999",
    ]);
  });

  it("build exits 0 for ok.ts alone, and its output runs", () => {
    fs.rmSync(path.join(dir, "src", "bad.ts"));
    const b = cli(dir, "build");
    expect(b.status, b.output).toBe(0);
    const r = run(dir, "ok.js");
    expect(r.status, r.output).toBe(0);
    expect(r.output).toBe("[ 'u7:40 80' ] u1u2\n");
  });
});

describe.skipIf(!hasBuild)(
  "plain check / build type-check the expansion where the source check is blind",
  () => {
    // Checked as written, a comprehension's bound names are undeclared (the
    // ComprehensionBlock rule hides that), so `user.nme` was never checked:
    // only `--strict` reported it, at its position in the expanded text.
    let dir: string;
    beforeAll(() => {
      dir = makeProject({
        "src/comp.ts": `import "@typesugar/std/syntax/do";
const fetchUser = (id: number) => Promise.resolve({ id, name: "u" + id });
const fetchAge = (_n: string) => Promise.resolve(40);

export const describe = (id: number) =>
  let: {
    user << fetchUser(id);
    age << fetchAge(user.nme);
  }
  yield: \`\${user.name} is \${age}\`;

export async function inner(id: number) {
  const r =
    let: {
      user << fetchUser(id);
      age << fetchAge(user.name);
    }
    yield: age + user.idd;
  return r;
}
`,
        // The names a `match:` case pattern binds, and `result` in `ensures:`.
        "src/sw.ts": `import "@typesugar/std/syntax/match";

type Shape =
  | { type: "Point"; coordinates: [number, number] }
  | { type: "Circle"; radius: number };

export function describe(s: Shape): string {
  match: switch (s) {
    case { type: "Point", coordinates: [x, y] }:
      return \`\${x.toFixd(1)},\${y}\`;
    case { type: "Circle", radius }:
      return \`r=\${radius}\`;
  }
}
`,
        "src/con.ts": `import "@typesugar/contracts/syntax";

export function half(n: number): { value: number } {
  requires: { n >= 0; }
  ensures: { result.valu >= 0; }
  return { value: n / 2 };
}
`,
        // A fluent match() chain's pattern names (the MacroCallChain rule
        // hides their TS2304/TS18004), so `r.toUpperCase()` on a number was
        // unchecked as written, and threw at run time.
        "src/fluent.ts": `import { match } from "@typesugar/std";

type Shape =
  | { kind: "circle"; r: number }
  | { kind: "rect"; w: number; h: number }
  | { kind: "tri"; b: number; h: number };

export function label(s: Shape): string {
  return match(s)
    .case({ kind: "circle", r }).then(r.toUpperCase())
    .case({ kind: "rect", w, h }).then(\`\${w}x\${h}\`)
    .case({ kind: "tri", b, h }).then(\`tri \${b}\`);
}
`,
        // A pattern name that also names an outer declaration (the function
        // \`len\` itself): as written, \`len + 1\` was checked against the
        // function's type (TS2365). The arm's binding is a number, so only
        // \`len.toUpperCase()\` is an error, reported by the expanded check.
        "src/shadow.ts": `import { match } from "@typesugar/std";

type Seg = { kind: "dot" } | { kind: "line"; len: number };

export function len(s: Seg): number {
  return match(s).case({ kind: "dot" }).then(0).case({ kind: "line", len }).then(len + 1);
}

export function bad(s: Seg): string {
  return match(s).case({ kind: "dot" }).then("").case({ kind: "line", len }).then(len.toUpperCase());
}
`,
        // Valid code: no new errors. A fluent match() on a value TypeScript
        // has narrowed (by assignment, or by control flow) reads it at its
        // declared type, so the expansion's switch has no arm TypeScript
        // calls unreachable (TS2678) and no field narrowed to unknown.
        "src/ok.ts": `import "@typesugar/std/syntax/do";
import { match } from "@typesugar/std";

type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number };
const circle: Shape = { kind: "circle", radius: 5 };
export const area = match(circle)
  .case({ kind: "circle", radius }).then(radius * 2)
  .case({ kind: "square", side }).then(side ** 2);

export function notSquare(s: Shape): number {
  if (s.kind === "square") return 0;
  return match(s)
    .case({ kind: "circle", radius }).then(radius)
    .case({ kind: "square", side }).then(side ** 2);
}

export const total = (n: number) =>
  let: {
    a << Promise.resolve(n);
  }
  yield: a + 1;
`,
        // The declared type comes from a module this file doesn't import it from.
        "src/shapes.ts": `export type Shape2 = { kind: "dot" } | { kind: "line"; len: number };
export const makeShape = (n: number): Shape2 => (n > 0 ? { kind: "line", len: n } : { kind: "dot" });
`,
        "src/far.ts": `import { match } from "@typesugar/std";
import { makeShape } from "./shapes.js";

export function lengthOf(n: number): number {
  const s = makeShape(n);
  if (s.kind === "dot") return 0;
  return match(s)
    .case({ kind: "dot" }).then(0)
    .case({ kind: "line", len }).then(len + 1);
}
`,
      });
      dirs.push(dir);
    });

    const expected = [
      "comp.ts(8,26): error TS2551: Property 'nme' does not exist on type '{ id: number; name: string; }'. Did you mean 'name'?",
      "comp.ts(18,23): error TS2339: Property 'idd' does not exist on type '{ id: number; name: string; }'.",
    ];

    for (const command of ["check", "build"] as const) {
      it(`${command} reports the errors in the comprehension, at the lines as written`, () => {
        const r = cli(dir, command);
        expect(r.status, r.output).toBe(1);
        const errors = [...r.output.matchAll(/(comp\.ts\(\d+,\d+\): error .*)/g)].map((m) => m[1]);
        expect(errors).toEqual(expected);
        expect(r.output).not.toMatch(/ok\.ts\(\d+,\d+\): error/);
        expect(r.output).not.toMatch(/(far|shapes)\.ts\(\d+,\d+\): error/);
        const fluent = [...r.output.matchAll(/(fluent\.ts\(\d+,\d+\): error .*)/g)].map(
          (m) => m[1]
        );
        expect(fluent).toEqual([
          "fluent.ts(10,41): error TS2339: Property 'toUpperCase' does not exist on type 'number'.",
        ]);
        const shadow = [...r.output.matchAll(/(shadow\.ts\(\d+,\d+\): error .*)/g)].map(
          (m) => m[1]
        );
        expect(shadow).toEqual([
          "shadow.ts(10,87): error TS2339: Property 'toUpperCase' does not exist on type 'number'.",
        ]);
        expect(r.output).toContain(
          "sw.ts(10,19): error TS2551: Property 'toFixd' does not exist on type 'number'. Did you mean 'toFixed'?"
        );
        expect(r.output).toContain(
          "con.ts(5,21): error TS2551: Property 'valu' does not exist on type '{ value: number; }'. Did you mean 'value'?"
        );
      });
    }
  }
);

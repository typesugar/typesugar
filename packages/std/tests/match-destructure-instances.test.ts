/**
 * Extractor patterns from `Destructure` instances (match-extractors.ts).
 *
 * `Name(...)` in a pattern resolves a `Destructure<typeof Name, ...>`
 * instance from scope — the current file, the modules it imports, or the
 * module that declares `Name` — keyed by `Name`'s symbol. An instance with a
 * `@destructure` descriptor is inlined (zero cost); one without has its
 * `extract` called once. Every behavioural assertion runs the emitted code.
 */
import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as std from "@typesugar/std";

import "@typesugar/macros";
import "@typesugar/std/macros";

import { TransformationPipeline } from "@typesugar/transformer";

const here = path.dirname(fileURLToPath(import.meta.url));
let counter = 0;

interface Output {
  code: Record<string, string>;
  errors: string[];
  warnings: string[];
  exports: Record<string, unknown>;
}

/**
 * Transform several files (keys are relative names, `main.ts` is the entry),
 * transpile each to CommonJS and run `main.ts`, resolving `./x` to the other
 * files and `@typesugar/std` to the real package.
 */
function run(files: Record<string, string>): Output {
  const dir = path.resolve(here, `__destructure_${counter++}`);
  const abs = (rel: string) => path.join(dir, rel);
  const byPath = new Map(Object.entries(files).map(([rel, text]) => [abs(rel), text]));
  const pipeline = new TransformationPipeline(
    {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      skipLibCheck: true,
      lib: ["lib.es2023.d.ts"],
    },
    [...byPath.keys()],
    {
      readFile: (f) => byPath.get(f) ?? ts.sys.readFile(f),
      fileExists: (f) => byPath.has(f) || ts.sys.fileExists(f),
    }
  );
  const code: Record<string, string> = {};
  const js: Record<string, string> = {};
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const rel of Object.keys(files)) {
    const r = pipeline.transform(abs(rel));
    code[rel] = r.code;
    for (const d of r.diagnostics ?? []) {
      const msg = String((d as { message?: string }).message ?? "");
      if ((d as { severity?: string }).severity === "error") errors.push(msg);
      else warnings.push(msg);
    }
    js[rel] = ts.transpileModule(r.code, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
  }
  const cache = new Map<string, Record<string, unknown>>();
  const load = (rel: string): Record<string, unknown> => {
    const hit = cache.get(rel);
    if (hit) return hit;
    const mod = { exports: {} as Record<string, unknown> };
    cache.set(rel, mod.exports);
    const req = (spec: string) => {
      if (spec === "@typesugar/std") return std;
      if (spec.startsWith("./")) return load(spec.slice(2).replace(/(\.js)?$/, ".ts"));
      throw new Error(`unexpected require(${spec})`);
    };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function("require", "exports", "module", js[rel])(req, mod.exports, mod);
    return mod.exports;
  };
  let exports: Record<string, unknown> = {};
  if (errors.length === 0) exports = load("main.ts");
  return { code, errors, warnings, exports };
}

type Fn = (...args: never[]) => unknown;

/** A product type and its zero-cost instance, as a library would ship them. */
const POINT = `
export interface Point { readonly x: number; readonly y: number }
export function Point(x: number, y: number): Point { return { x, y }; }
/**
 * @impl Destructure<typeof Point, Point, [number, number]>
 * @destructure always -> x, y
 */
export const destructurePoint = { extract: (p: Point): [number, number] => [p.x, p.y] };
`;

/** A hand-written extractor with real logic: no descriptor, so extract() runs. */
const EMAIL = `
export let calls = 0;
export function Email(user: string, domain: string): string { return user + "@" + domain; }
/** @impl Destructure<typeof Email, string, { user: string; domain: string }> */
export const destructureEmail = {
  extract(s: string): { user: string; domain: string } | undefined {
    calls++;
    const at = s.indexOf("@");
    return at > 0 ? { user: s.slice(0, at), domain: s.slice(at + 1) } : undefined;
  },
};
`;

describe("Destructure instance with a descriptor: inlined, no extract() call", () => {
  it("a product: Point(x, y) is two field reads", () => {
    const r = run({
      "main.ts": `import { match } from "@typesugar/std";
${POINT}
export const sum = (p: Point) => match(p).case(Point(x, y)).then(x + y);
`,
    });
    expect(r.errors).toEqual([]);
    expect(r.code["main.ts"]).toContain("const x = _p.x;");
    expect(r.code["main.ts"]).toContain("const y = _p.y;");
    expect(r.code["main.ts"]).not.toMatch(/extract\(|MatchError/);
    expect((r.exports.sum as Fn)({ x: 2, y: 3 } as never)).toBe(5);
  });

  it("from the module that declares the constructor, with no import of the instance", () => {
    const r = run({
      "point.ts": POINT,
      "main.ts": `import { match } from "@typesugar/std";
import { Point } from "./point.js";
export const sum = (p: Point) => match(p).case(Point(x, y)).then(x * y);
`,
    });
    expect(r.errors).toEqual([]);
    expect(r.code["main.ts"]).not.toContain("destructurePoint");
    expect((r.exports.sum as Fn)({ x: 2, y: 3 } as never)).toBe(6);
  });

  it("in a match: switch too", () => {
    const r = run({
      "point.ts": POINT,
      "main.ts": `import "@typesugar/std/syntax/match";
import { Point } from "./point.js";
export function sum(p: Point): number {
  match: switch (p) {
    case Point(x, y):
      return x + y;
  }
}
`,
    });
    expect(r.errors).toEqual([]);
    expect(r.code["main.ts"]).toMatch(
      /switch \(true\) \{\s*case true: \{\s*const x = p\.x;\s*const y = p\.y;/
    );
    expect((r.exports.sum as Fn)({ x: 4, y: 5 } as never)).toBe(9);
  });

  it('a variant test from the descriptor: `kind = "circle"`', () => {
    const r = run({
      "main.ts": `import { match } from "@typesugar/std";
type Shape = { kind: "circle"; r: number } | { kind: "square"; s: number };
declare function Circle(r: number): Shape;
declare function Square(s: number): Shape;
/** @impl Destructure<typeof Circle, Shape, number>
 * @destructure kind = "circle" -> r */
export const destructureCircle = { extract: (s: Shape) => (s.kind === "circle" ? s.r : undefined) };
/** @impl Destructure<typeof Square, Shape, number>
 * @destructure kind = "square" -> s */
export const destructureSquare = { extract: (s: Shape) => (s.kind === "square" ? s.s : undefined) };
export const area = (sh: Shape) => match(sh).case(Circle(r)).then(3 * r * r).case(Square(s)).then(s * s);
`,
    });
    expect(r.errors).toEqual([]);
    expect(r.code["main.ts"]).toContain('_sh.kind === "circle"');
    expect(r.code["main.ts"]).not.toContain("extract(");
    const area = r.exports.area as Fn;
    expect(area({ kind: "circle", r: 2 } as never)).toBe(12);
    expect(area({ kind: "square", s: 3 } as never)).toBe(9);
  });
});

describe("Destructure instance without a descriptor: extract() once, result destructured", () => {
  it("fluent: the instance is called once per test and imported where it lives", () => {
    const r = run({
      "email.ts": EMAIL,
      "main.ts": `import { match } from "@typesugar/std";
import { Email } from "./email.js";
export const user = (s: string) => match(s).case(Email({ user, domain })).then(user + "/" + domain).else("?");
`,
    });
    expect(r.errors).toEqual([]);
    expect(r.code["main.ts"]).toMatch(/import \{ destructureEmail \} from "\.\/email\.js"/);
    expect(r.code["main.ts"]).toContain("destructureEmail.extract(");
    expect((r.exports.user as Fn)("ann@example.org" as never)).toBe("ann/example.org");
    expect((r.exports.user as Fn)("nope" as never)).toBe("?");
  });

  it("match: switch: extract() runs once per case tested", () => {
    const r = run({
      "email.ts": EMAIL,
      "main.ts": `import "@typesugar/std/syntax/match";
import { Email, calls } from "./email.js";
export function who(s: string): string {
  match: switch (s) {
    case Email({ user }):
      return user;
    default:
      return "?";
  }
}
export const callCount = () => calls;
`,
    });
    expect(r.errors).toEqual([]);
    expect(r.code["main.ts"]).toMatch(
      /case \(_ext = destructureEmail\.extract\(s\)\) !== undefined: \{\s*const \{ user \} = _ext;/
    );
    expect((r.exports.who as Fn)("bo@x.io" as never)).toBe("bo");
    expect((r.exports.who as Fn)("bad" as never)).toBe("?");
    expect((r.exports.callCount as Fn)()).toBe(2);
  });
});

describe("resolution", () => {
  it("is keyed by the constructor's symbol: another Point has no instance", () => {
    const r = run({
      "point.ts": POINT,
      "main.ts": `import { match } from "@typesugar/std";
class Point { constructor(public x: number) {} }
export const f = (p: unknown) => match(p).case(Point(q)).then(q).else(null);
`,
    });
    expect(r.errors).toEqual([]);
    // The local class is a type-constructor pattern (instanceof), as before.
    expect(r.code["main.ts"]).toContain("instanceof Point");
  });

  it("reports a malformed descriptor", () => {
    const r = run({
      "main.ts": `import { match } from "@typesugar/std";
declare function Wrap(v: number): number;
/** @impl Destructure<typeof Wrap, number, number>
 * @destructure maybe -> self */
export const destructureWrap = { extract: (n: number) => n };
export const f = (n: number) => match(n).case(Wrap(v)).then(v).else(0);
`,
    });
    expect(r.errors).toEqual([
      expect.stringContaining('descriptor of destructureWrap is invalid: unknown test "maybe"'),
    ]);
  });

  it("reports binding more values than the extractor yields", () => {
    const r = run({
      "point.ts": POINT,
      "main.ts": `import { match } from "@typesugar/std";
import { Point } from "./point.js";
export const f = (p: Point) => match(p).case(Point(a, b, c)).then(a).else(0);
`,
    });
    expect(r.errors).toEqual([
      expect.stringContaining("binds 3 values, but its extractor yields 2"),
    ]);
  });
});

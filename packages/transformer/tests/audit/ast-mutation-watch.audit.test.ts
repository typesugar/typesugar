/**
 * 2026-11 correctness audit — IN-PLACE MUTATION OF THE PROGRAM'S SOURCE AST
 * (`stripPositions` / `stripCommentsDeep` in packages/core/src/ast-utils.ts, applied
 * to program-owned nodes by `substituteParams` (packages/macros/src/specialize.ts),
 * `tryRewriteTypeclassOperator` (transformer-core/src/rewriting.ts),
 * `tryResolveTypeclassMethod` (method-sugar.ts) and `tryInlineDerivedInstanceCall`
 * (specialization.ts)).
 *
 * Finding F20 in audit/FABLE-AUDIT-2026-11.md (PEP-056 pipeline). The transform
 * sets `pos`/`end` to -1 on identifiers and argument expressions that belong to
 * the ORIGINAL `ts.SourceFile`. A watch host reuses that SourceFile object for an
 * unchanged file on the next build, and TypeScript's checker then throws
 * `Error: start < 0` from `createTextSpan` when it reports any diagnostic inside
 * a mutated node. `cli.ts` already catches this message at three call sites and
 * attributes it to "synthetic nodes" — the real source is the mutation of real
 * nodes.
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import { macroTransformerFactory, TransformerState } from "@typesugar/transformer/pipeline";
import { createVirtualFs, EQ_TYPECLASS } from "./_harness.js";

const OPTS: ts.CompilerOptions = {
  target: ts.ScriptTarget.Latest,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: false,
  skipLibCheck: true,
};

/**
 * A compiler host that, like `ts.createWatchProgram`'s and the language
 * service's document registry, returns the SAME `ts.SourceFile` object for a
 * file whose text has not changed.
 */
function createReusingHost(files: Record<string, string>) {
  const vfs = createVirtualFs(files);
  const cache = new Map<string, ts.SourceFile>();
  const host = ts.createCompilerHost(OPTS);
  const origGet = host.getSourceFile.bind(host);
  host.readFile = vfs.readFile;
  host.fileExists = vfs.fileExists;
  host.getSourceFile = (f, lang, onErr, shouldCreate) => {
    const text = vfs.resolved[f];
    if (text === undefined) return origGet(f, lang, onErr, shouldCreate);
    const key = `${f}::${text}`;
    let sf = cache.get(key);
    if (!sf) {
      sf = ts.createSourceFile(f, text, lang, true);
      cache.set(key, sf);
    }
    return sf;
  };
  host.writeFile = () => {};
  return { host, files: vfs.resolved };
}

function countNegativePositions(node: ts.Node): number {
  let n = 0;
  const walk = (x: ts.Node) => {
    if (x.pos < 0 || x.end < 0) n++;
    ts.forEachChild(x, walk);
  };
  walk(node);
  return n;
}

const MAIN = `
${EQ_TYPECLASS}
export interface Point { x: number; y: number; }
/** @impl Eq<Point> */
const eqPoint: Eq<Point> = {
  equals: (a, b) => a.x === b.x && a.y === b.y,
  notEquals: (a, b) => !(a.x === b.x && a.y === b.y),
};
import { helper } from "./dep";
declare const p: Point;
// TS2552 (cannot find name) sits INSIDE an argument the inliner substitutes.
export const r = eqPoint.equals(p, undefinedVar);
export const h = helper(1);
`;
const DEP_V1 = `export const helper = (n: number) => n;`;
const DEP_V2 = `export const helper = (n: number) => n + 1;`;

describe("audit F20: the transformer must not mutate the program's SourceFile", () => {
  // Tracked: audit/FABLE-AUDIT-2026-11.md F20 (PEP-056 stripPositions on program-owned nodes)
  it("after emit, the original SourceFile has no negative positions", () => {
    const { host } = createReusingHost({ "main.ts": MAIN, "dep.ts": DEP_V1 });
    const roots = [path.resolve("main.ts"), path.resolve("dep.ts")];
    const program = ts.createProgram(roots, OPTS, host);
    const sf = program.getSourceFile(roots[0])!;
    expect(countNegativePositions(sf)).toBe(0);
    program.emit(sf, () => {}, undefined, false, {
      before: [macroTransformerFactory(program, { cacheDir: false })],
    });
    expect(countNegativePositions(sf)).toBe(0);
  });

  // Tracked: audit/FABLE-AUDIT-2026-11.md F20 (PEP-056 watch rebuild on a reused SourceFile)
  it("watch build #2 (dep edited, main unchanged) must still be able to report diagnostics", () => {
    const { host, files } = createReusingHost({ "main.ts": MAIN, "dep.ts": DEP_V1 });
    const roots = [path.resolve("main.ts"), path.resolve("dep.ts")];
    const state = new TransformerState({ cacheDir: false });

    const build = (oldProgram?: ts.Program) => {
      const program = ts.createProgram(roots, OPTS, host, oldProgram);
      const sf = program.getSourceFile(roots[0])!;
      const diags = program.getSemanticDiagnostics(sf);
      program.emit(sf, () => {}, undefined, false, {
        before: [macroTransformerFactory(program, { cacheDir: false }, state)],
      });
      return { program, sf, diags };
    };

    const first = build();
    expect(first.diags.map((d) => d.code)).toEqual([2552]);

    files[path.resolve("dep.ts")] = DEP_V2;
    // Build #2 reuses main.ts's SourceFile object (unchanged text). Its checker
    // must be able to re-report the same TS2552 at a real position.
    let second: ReturnType<typeof build> | undefined;
    expect(() => {
      second = build(first.program);
    }).not.toThrow();
    expect(second!.sf).toBe(first.sf);
    expect(second!.diags.map((d) => d.code)).toEqual([2552]);
    expect(second!.diags[0].start).toBe(first.diags[0].start);
  });
});

// Added with the F20 follow-up: cloneWithoutPositions/cloneWithoutComments
// shared the original's TOKEN children (and unchanged NodeArrays), so method
// sugar on a non-identifier receiver still reset `+` on the real file.
describe("F20 follow-up: method sugar on an expression receiver", () => {
  it("(n + 1).show() leaves the program's SourceFile untouched", () => {
    const main = `
/** @typeclass */
interface Show<A> { show(a: A): string; }
/** @impl Show<number> */
const showNum: Show<number> = { show: (a) => String(a) };
declare const n: number;
export const r = (n + 1).show();
`;
    const { host } = createReusingHost({ "main.ts": main });
    const root = path.resolve("main.ts");
    const program = ts.createProgram([root], OPTS, host);
    const sf = program.getSourceFile(root)!;
    program.emit(sf, () => {}, undefined, false, {
      before: [macroTransformerFactory(program, { cacheDir: false })],
    });
    expect(countNegativePositions(sf)).toBe(0);
  });
});

describe("controls (must stay green)", () => {
  it("the reusing host really does hand back the same SourceFile object for unchanged text", () => {
    const { host, files } = createReusingHost({ "main.ts": MAIN, "dep.ts": DEP_V1 });
    const roots = [path.resolve("main.ts"), path.resolve("dep.ts")];
    const p1 = ts.createProgram(roots, OPTS, host);
    files[path.resolve("dep.ts")] = DEP_V2;
    const p2 = ts.createProgram(roots, OPTS, host, p1);
    expect(p2.getSourceFile(roots[0])).toBe(p1.getSourceFile(roots[0]));
    expect(p2.getSourceFile(roots[1])).not.toBe(p1.getSourceFile(roots[1]));
  });
});

/**
 * A type declared in a `.mts` file, named from another file that doesn't
 * import it (review 8). core's `typeToPortableTypeNode` wrote it as
 * `import("./lib/shapes.js")`, which doesn't resolve: TS2307 under
 * `--strict`, and an `any` read inside the match() chain std asserts the
 * scrutinee to its declared type in. The same helper writes the inferred
 * `@opaque` annotations of the declarations emitted from the expansion.
 *
 * The CLI tests spawn the BUILT CLI (`pnpm --filter @typesugar/transformer build`).
 */

import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as ts from "typescript";
import { fileURLToPath } from "url";
import { emitDeclarations } from "../src/declarations.js";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pkgRoot, "..", "..");
const cliPath = path.join(pkgRoot, "dist", "cli.js");

const COMPILER_OPTIONS = {
  target: "ES2022",
  module: "NodeNext",
  moduleResolution: "NodeNext",
  strict: true,
  skipLibCheck: true,
  types: [],
  outDir: "out",
  rootDir: "src",
};

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

function makeProject(files: Record<string, string>, compilerOptions: object = {}): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-mts-")));
  dirs.push(dir);
  fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(dir, "node_modules"), "dir");
  const all: Record<string, string> = {
    "package.json": JSON.stringify({ name: "mts-app", private: true, type: "module" }),
    "tsconfig.json": JSON.stringify({
      compilerOptions: { ...COMPILER_OPTIONS, ...compilerOptions },
      include: ["src"],
    }),
    ...files,
  };
  for (const [rel, content] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

function cli(dir: string, args: string[]): { status: number | null; output: string } {
  const r = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: dir,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  });
  return { status: r.status, output: (r.stdout ?? "") + (r.stderr ?? "") };
}

const SHAPES = {
  "src/lib/shapes.mts": `export type Circle = { kind: "circle"; radius: number };
export type Square = { kind: "square"; side: number };
export type Shape = Circle | Square;
`,
  "src/lib/hold.ts": `import type { Shape } from "./shapes.mjs";
export const holder: { s: Shape } = { s: { kind: "square", side: 3 } };
`,
  // Names Shape only through hold.ts, which doesn't export it.
  "src/main.ts": `import { match } from "@typesugar/std";
import { holder } from "./lib/hold.js";
export function area(): number {
  const s = holder.s;
  if (s.kind !== "circle") {
    return match(s).case({ kind: "square", side: x }).then(x * x).case({ kind: "circle", radius: r }).then(r);
  }
  return 0;
}
`,
};

describe.skipIf(!fs.existsSync(cliPath))(
  "a match() scrutinee whose type is declared in a .mts file",
  () => {
    it("is asserted to an import() of the .mjs specifier, and check --strict reports nothing", () => {
      const dir = makeProject(SHAPES);
      const expanded = cli(dir, ["expand", "src/main.ts"]).output;
      expect(expanded).toContain(`import("./lib/shapes.mjs").Shape`);
      expect(expanded).not.toContain(`"./lib/shapes.js"`);
      const checked = cli(dir, ["check", "--strict"]);
      expect(checked.output).not.toContain("TS2307");
      expect(checked.output).toBe("");
      expect(checked.status).toBe(0);
    });
  }
);

const OPAQUE_FILES = {
  "src/opt.mts": `import "typesugar";

/**
 * An optional value.
 *
 * @opaque A | null
 */
export interface Opt<A> {
  map<B>(f: (a: A) => B): Opt<B>;
}
export function Some<A>(value: A): Opt<A> {
  return value as unknown as Opt<A>;
}
export function map<A, B>(o: Opt<A>, f: (a: A) => B): Opt<B> {
  return (o == null ? null : f(o as unknown as A)) as unknown as Opt<B>;
}
`,
  "src/mk.ts": `import { Some, type Opt } from "./opt.mjs";
export const mk = (n: number): Opt<number> => Some(n);
`,
  // Gets an Opt without importing its module.
  "src/use.ts": `import { mk } from "./mk.js";
export const w = mk(4).map((x) => x * 10);
console.log("W", w);
`,
};

describe.skipIf(!fs.existsSync(cliPath))("an @opaque type declared in a .mts file", () => {
  it("its companion functions are imported from the .mjs specifier, and the build runs", () => {
    const dir = makeProject(OPAQUE_FILES);
    const built = cli(dir, ["build"]);
    expect(built.output).toBe("");
    expect(built.status).toBe(0);
    const js = fs.readFileSync(path.join(dir, "out/use.js"), "utf-8");
    expect(js).toMatch(/import \{[^}]*\bmap\b[^}]*\} from "\.\/opt\.mjs";/);
    const run = spawnSync(process.execPath, [path.join(dir, "out/use.js")], { encoding: "utf-8" });
    expect(run.stderr).toBe("");
    expect(run.stdout.trim()).toBe("W 40");
  });
});

describe("an inferred @opaque annotation for a type declared in a .mts file", () => {
  it("imports the .mjs specifier in the emitted declarations, which type-check", () => {
    const dir = makeProject(OPAQUE_FILES, { declaration: true });
    const cwd = process.cwd();
    try {
      process.chdir(dir);
      emitDeclarations({ project: "tsconfig.json" });
    } finally {
      process.chdir(cwd);
    }
    const dts = fs.readFileSync(path.join(dir, "out/use.d.ts"), "utf-8");
    expect(dts).toContain(`import("./opt.mjs").Opt<number>`);
    // The declarations resolve: no TS2307 in them.
    const files = ["use.d.ts", "mk.d.ts", "opt.d.mts"].map((f) => path.join(dir, "out", f));
    const program = ts.createProgram(files, {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: true,
      noEmit: true,
      skipLibCheck: false,
      types: [],
    });
    const errors = ts
      .getPreEmitDiagnostics(program)
      .filter((d) => d.file && files.includes(d.file.fileName))
      .map((d) => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
    expect(errors).toEqual([]);
  });
});

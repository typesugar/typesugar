/**
 * Pre-merge review: withTypesugar under tsup CLI overrides, and the
 * plain-pattern warning for an exact relative file path.
 */

import { describe, it, expect, afterAll, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";
import type { Options } from "tsup";
import { withTypesugar } from "../tsup.js";
import { unpluginFactory } from "../unplugin.js";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = path.resolve(pkgRoot, "..", "..");
const hasBuild = fs.existsSync(path.join(repoRoot, "packages", "transformer", "dist"));

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

function makeLibrary(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-tsup-overrides-"));
  dirs.push(dir);
  fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(dir, "node_modules"), "dir");
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ name: "lib", type: "module" }),
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        skipLibCheck: true,
        types: [],
      },
      include: ["src"],
    }),
    "src/index.ts": `export const one = (): number => 1;\n`,
  };
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

/** What tsup does with a config function: call it, then spread the CLI options over each item. */
async function asTsup(
  config: (overrides?: Options) => Promise<Options>,
  cli: Options
): Promise<Options> {
  return { ...(await config(cli)), ...cli };
}

describe.skipIf(!hasBuild)("withTypesugar under tsup CLI flags", () => {
  it("`tsup --dts` keeps the declarations from the expanded program", async () => {
    const dir = makeLibrary();
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const final = await asTsup(withTypesugar({ entry: ["src/index.ts"] }), { dts: true });
      const dts = final.dts as { entry?: Record<string, string> };
      expect(typeof dts).toBe("object");
      expect(Object.keys(dts.entry ?? {})).toEqual(["index"]);
      expect(fs.readFileSync(dts.entry!.index, "utf-8")).toContain("export declare const one");
    } finally {
      process.chdir(cwd);
    }
  });

  it("`tsup --dts` applies to every withTypesugar config sharing tsup's options object", async () => {
    const dir = makeLibrary();
    fs.writeFileSync(path.join(dir, "src/other.ts"), `export const two = (): number => 2;\n`);
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const cli: Options = { dts: true };
      const first = withTypesugar({ name: "a", entry: ["src/index.ts"] });
      const second = withTypesugar({ name: "b", entry: ["src/other.ts"] });
      // A config function building several configs with the one CLI object.
      const items = [await first(cli), await second(cli)].map((item) => ({ ...item, ...cli }));
      for (const item of items) {
        const dts = item.dts as { entry?: Record<string, string> };
        expect(typeof dts).toBe("object");
        expect(Object.keys(dts.entry ?? {})).toHaveLength(1);
      }
    } finally {
      process.chdir(cwd);
    }
  });

  it("`tsup --watch --onSuccess <cmd>` is refused like a config onSuccess string", async () => {
    const dir = makeLibrary();
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      await expect(
        asTsup(withTypesugar({ entry: ["src/index.ts"], dts: true }), {
          watch: true,
          onSuccess: "echo done",
        })
      ).rejects.toThrow(/onSuccess as a function/);
    } finally {
      process.chdir(cwd);
    }
  });
});

describe("plain include/exclude patterns", () => {
  function warningsFor(opts: Record<string, unknown>): string[] {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      unpluginFactory(opts as never, { framework: "vite" } as never);
      return spy.mock.calls.map((c) => String(c[0]));
    } finally {
      spy.mockRestore();
    }
  }

  it("an exact relative file path is a valid glob: no warning", () => {
    expect(warningsFor({ include: ["review-src/main.ts"], exclude: "review-a/b/gen.tsx" })).toEqual(
      []
    );
  });

  it("a bare source file name is a valid glob too: no warning", () => {
    expect(warningsFor({ exclude: ["review-setup.ts", "review-vite.config.mjs"] })).toEqual([]);
  });

  it("a dotted directory name still warns", () => {
    expect(warningsFor({ exclude: ["node_modules/review-lodash.merge"] })).toEqual([
      expect.stringContaining('Did you mean "node_modules/review-lodash.merge/**"?'),
    ]);
  });

  it("a relative directory path still gets a dir/** suggestion", () => {
    expect(warningsFor({ exclude: ["review-pkg/core"] })).toEqual([
      expect.stringContaining('Did you mean "review-pkg/core/**"?'),
    ]);
  });
});

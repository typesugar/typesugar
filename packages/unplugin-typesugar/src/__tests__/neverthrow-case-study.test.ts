/**
 * Regressions found by the neverthrow case study
 * (typesugar/neverthrow-typesugar, CASE-STUDY.md). Each test drives the real
 * plugin hooks against a real on-disk project.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { unpluginFactory } from "../unplugin.js";

// Inside the repo so `@typesugar/macros` resolves from the root node_modules.
let dir: string;

function project(files: Record<string, string>) {
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  fs.writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        skipLibCheck: true,
      },
      include: ["src"],
    })
  );
}

function makePlugin(opts: Record<string, unknown> = {}) {
  const plugin = unpluginFactory({ tsconfig: path.join(dir, "tsconfig.json"), ...opts }, {
    framework: "rollup",
  } as never) as Record<string, any>;
  const ctx = {
    error: vi.fn((m: unknown) => {
      throw new Error(typeof m === "string" ? m : (m as { message: string }).message);
    }),
    warn: vi.fn(),
    addWatchFile: vi.fn(),
  };
  return { plugin, ctx };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(__dirname, "__fixture_"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("neverthrow F3: one Program per build, not one per module", () => {
  it("doesn't rebuild the Program when a module first arrives unchanged from disk", () => {
    const files: Record<string, string> = {
      "src/index.ts": `export * from "./a";\nexport * from "./b";\nexport * from "./c";\n`,
      "src/a.ts": `import { b } from "./b";\nexport const a = b + 1;\n`,
      "src/b.ts": `import { c } from "./c";\nexport const b = c + 1;\n`,
      "src/c.ts": `export const c = 1;\n`,
    };
    project(files);
    const { plugin, ctx } = makePlugin({ verbose: true });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      plugin.buildStart.call(ctx);
      for (const rel of Object.keys(files)) {
        const file = path.join(dir, rel);
        expect(plugin.transform.call(ctx, fs.readFileSync(file, "utf8"), file)).toBeNull();
      }
      const creations = log.mock.calls.filter((c) =>
        String(c[0]).includes("Creating TypeScript program")
      );
      // Each module is handed to the plugin exactly as it is on disk, which
      // is what the Program was built from: nothing to invalidate.
      expect(creations).toHaveLength(1);
    } finally {
      log.mockRestore();
    }
  });

  it("still rebuilds when a module first arrives with code that differs from disk", () => {
    project({
      "src/a.ts": `import { comptime } from "@typesugar/macros";\nexport const x = comptime(() => 1);\n`,
      "src/b.ts": `export const y = 2;\n`,
    });
    const { plugin, ctx } = makePlugin();
    plugin.buildStart.call(ctx);
    const b = path.join(dir, "src/b.ts");
    plugin.transform.call(ctx, fs.readFileSync(b, "utf8"), b);
    const a = path.join(dir, "src/a.ts");
    // An earlier plugin rewrote the module: the expansion must see this code.
    const out = plugin.transform.call(
      ctx,
      `import { comptime } from "@typesugar/macros";\nexport const x = comptime(() => 40 + 2);\n`,
      a
    );
    expect(out.code).toContain("42");
  });
});

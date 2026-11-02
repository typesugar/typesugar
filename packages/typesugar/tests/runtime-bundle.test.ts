/**
 * Review finding #16: the umbrella's root entry ends up in application
 * bundles, so it must not pull in the TypeScript compiler or Node
 * built-ins. Bundles a typical app entry with esbuild (platform: browser)
 * against the BUILT package and checks what got in.
 */
import { describe, it, expect } from "vitest";
import * as path from "path";
import * as esbuild from "esbuild";

const pkgRoot = path.resolve(__dirname, "..");

async function bundle(source: string) {
  const result = await esbuild.build({
    stdin: { contents: source, resolveDir: pkgRoot, loader: "ts" },
    bundle: true,
    write: false,
    platform: "browser",
    format: "esm",
    metafile: true,
    logLevel: "silent",
    alias: { typesugar: path.join(pkgRoot, "dist/index.js") },
  });
  const inputs = Object.keys(result.metafile!.inputs);
  return { inputs, size: result.outputFiles[0].contents.length };
}

// The derive markers (Eq, Ord, ...) still come from the @typesugar/macros
// ROOT until @typesugar/macros/runtime exports them (see
// src/derive-markers.ts). Until then a browser bundle of the root entry
// cannot succeed; this test switches on by itself once they're exported.
const runtime = (await import("@typesugar/macros/runtime")) as Record<string, unknown>;
const markersInRuntime = "Eq" in runtime && "TypeGuard" in runtime;

describe("typesugar root entry is runtime-safe (#16)", () => {
  it.skipIf(!markersInRuntime)(
    "bundling runtime stubs for the browser does not include typescript",
    async () => {
      const { inputs, size } = await bundle(
        `import { pipe, comptime, summon, includeBytes, cfgAttr, compileError } from "typesugar";\nconsole.log(pipe, comptime, summon, includeBytes, cfgAttr, compileError);\n`
      );
      expect(inputs.some((f) => /node_modules[\\/]typescript[\\/]/.test(f))).toBe(false);
      expect(inputs.some((f) => /packages[\\/]macros[\\/]dist[\\/]index\.js$/.test(f))).toBe(false);
      expect(size).toBeLessThan(200_000);
    }
  );

  it("the root entry no longer imports macro definitions for side effects", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync(path.join(pkgRoot, "src/index.ts"), "utf8");
    expect(src).not.toMatch(/^import\s+["']@typesugar\/macros["']/m);
    expect(src).not.toMatch(/^export \* from ["']@typesugar\/core["']/m);
  });
});

describe("derive markers from the umbrella (docs review r3 #6)", () => {
  it("Show, Semigroup and Monoid are exported from typesugar, TS-free, same identity as @typesugar/macros", async () => {
    const { inputs } = await bundle(
      `import { derive, Eq, Show, Semigroup, Monoid } from "typesugar";\nconsole.log(derive, Eq, Show, Semigroup, Monoid);\n`
    );
    expect(inputs.some((f) => /node_modules[\\/]typescript[\\/]/.test(f))).toBe(false);
    const umbrella = (await import(path.join(pkgRoot, "dist/index.js"))) as Record<string, unknown>;
    const macros = (await import("@typesugar/macros/runtime")) as Record<string, unknown>;
    for (const name of ["Show", "Semigroup", "Monoid"]) {
      expect(umbrella[name], name).toBeDefined();
      expect(umbrella[name], name).toBe(macros[name]);
    }
  });
});

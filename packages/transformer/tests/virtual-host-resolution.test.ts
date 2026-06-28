/**
 * VirtualCompilerHost relative module resolution (PEP-050).
 *
 * A NodeNext-style specifier carries a `.js` extension (e.g. `./data/option.js`).
 * For type resolution the corresponding `.d.ts` must win over the emitted `.js`,
 * otherwise the typeless JavaScript is loaded and imported types collapse to `any`
 * — which broke fp's de-bundled Option (PEP-033 N3b / PEP-050).
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import { VirtualCompilerHost } from "../src/virtual-host.js";

function resolve(present: string[], specifier: string, containingFile: string) {
  const set = new Set(present);
  const host = new VirtualCompilerHost({
    compilerOptions: { moduleResolution: ts.ModuleResolutionKind.NodeNext },
    fileExists: (f) => set.has(f),
    readFile: () => "",
  });
  const [resolved] = host.resolveModuleNames([specifier], containingFile, undefined, undefined, {});
  return resolved?.resolvedFileName;
}

describe("VirtualCompilerHost — relative `.js` → `.d.ts` resolution", () => {
  it("prefers the .d.ts over the emitted .js for a `.js` specifier", () => {
    const resolved = resolve(
      ["/pkg/data/option.js", "/pkg/data/option.d.ts"],
      "./data/option.js",
      "/pkg/index.d.ts"
    );
    expect(resolved).toBe("/pkg/data/option.d.ts");
  });

  it("falls back to the .js file when no declaration exists", () => {
    const resolved = resolve(["/pkg/data/plain.js"], "./data/plain.js", "/pkg/index.d.ts");
    expect(resolved).toBe("/pkg/data/plain.js");
  });

  it("still resolves an extensionless specifier to its .ts/.d.ts", () => {
    const resolved = resolve(["/pkg/data/option.d.ts"], "./data/option", "/pkg/index.d.ts");
    expect(resolved).toBe("/pkg/data/option.d.ts");
  });
});

/**
 * PEP-052 — registry-free instance-method sugar across modules.
 *
 * Verifies that a derived companion (`Point.Eq`) is correctly imported when the
 * receiver's type is declared in another module and its value/namespace isn't
 * already imported by name (the bug the registry-free path had to re-handle).
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import { transformCode } from "@typesugar/transformer/pipeline";

function createVirtualFs(files: Record<string, string>) {
  const resolved: Record<string, string> = {};
  for (const [name, content] of Object.entries(files)) resolved[path.resolve(name)] = content;
  return {
    readFile: (f: string) => resolved[f] ?? ts.sys.readFile(f),
    fileExists: (f: string) => f in resolved || ts.sys.fileExists(f),
  };
}

describe("PEP-052 method sugar — cross-module derived companion", () => {
  it("injects an import for the companion base when only an unrelated binding was imported", () => {
    const lib = `
/** @derive(Eq) */
export class Point { constructor(public x: number) {} }
export function origin(): Point { return new Point(0); }
`.trim();

    // Consumer imports only \`origin\` (a value), NOT \`Point\` — yet \`p.equals(q)\`
    // must emit \`Point.Eq.equals(...)\` and import \`Point\` so it isn't unbound.
    // Method sugar is import-scoped (PEP-052 Phase E), so the consumer also
    // activates Eq's method syntax.
    const consumer = `
import { origin } from "./point-lib";
import "@typesugar/std/syntax/eq";
const p = origin();
const q = origin();
export const same = p.equals(q);
`.trim();

    const vfs = createVirtualFs({ "point-lib.ts": lib, "consumer.ts": consumer });
    const result = transformCode(consumer, {
      fileName: "consumer.ts",
      extraRootFiles: [path.resolve("point-lib.ts")],
      ...vfs,
    });

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).toContain("Point.Eq.equals(p, q)");
    // Point must now be imported (so the companion reference is bound).
    expect(result.code).toMatch(/import\s*\{[^}]*\bPoint\b[^}]*\}\s*from\s*["']\.\/point-lib["']/);
  });
});

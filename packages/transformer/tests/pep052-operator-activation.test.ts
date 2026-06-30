/**
 * PEP-052 Wave 1 — import-scoped operator activation (Gate G2).
 *
 * Operators rewrite ONLY when the using file's import graph activates a typeclass
 * (via a `@syntax-operators <TC>` marker import) AND an instance for the operand
 * type is resolvable from scope. No activation → native operator, untouched.
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import { transformCode } from "@typesugar/transformer/pipeline";
import { clearResolverCache, instanceScanner } from "@typesugar/macros";

// Resolver/scanner caches are keyed by file path; clear them between tests since
// these tests reuse the same virtual paths with different content.
beforeEach(() => {
  clearResolverCache();
  instanceScanner.clearCache();
});

/** Virtual filesystem over in-memory files for module resolution. */
function createVirtualFs(files: Record<string, string>) {
  const resolved: Record<string, string> = {};
  for (const [name, content] of Object.entries(files)) {
    resolved[path.resolve(name)] = content;
  }
  return {
    readFile: (f: string) => resolved[f] ?? ts.sys.readFile(f),
    fileExists: (f: string) => f in resolved || ts.sys.fileExists(f),
  };
}

// A small Eq library: the typeclass (with @op tags), an instance for Point, and
// the two activation-marker modules (methods tier and operators tier).
const EQ_LIB = `
/** @typeclass */
export interface Eq<A> {
  /** @op === */
  equals(a: A, b: A): boolean;
  /** @op !== */
  notEquals(a: A, b: A): boolean;
}

export interface Point { x: number; y: number; }

/** @instance */
export const eqPoint: Eq<Point> = {
  equals: (a, b) => a.x === b.x && a.y === b.y,
  notEquals: (a, b) => !(a.x === b.x && a.y === b.y),
};
`.trim();

const EQ_OPS_MARKER = `/** @syntax-operators Eq */\nexport {};\n`;

function project(consumer: string) {
  return createVirtualFs({
    "eq-lib.ts": EQ_LIB,
    "eq-ops.ts": EQ_OPS_MARKER,
    "consumer.ts": consumer,
  });
}

const extraRootFiles = [path.resolve("eq-lib.ts"), path.resolve("eq-ops.ts")];

describe("PEP-052 operator activation (G2)", () => {
  it("rewrites a === b when the operator marker is imported and an instance is in scope", () => {
    const consumer = `
import { Point, eqPoint } from "./eq-lib";
import "./eq-ops";

declare const a: Point;
declare const b: Point;
export const r = a === b;
`.trim();

    const vfs = project(consumer);
    const result = transformCode(consumer, {
      fileName: "consumer.ts",
      extraRootFiles,
      ...vfs,
    });

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).not.toMatch(/a === b/);
    expect(result.code).toContain("eqPoint.equals(a, b)");
  });

  it("leaves a === b native when no marker is imported (byte-for-byte unchanged)", () => {
    const consumer = `
import { Point, eqPoint } from "./eq-lib";

declare const a: Point;
declare const b: Point;
export const r = a === b;
`.trim();

    const vfs = project(consumer);
    const result = transformCode(consumer, {
      fileName: "consumer.ts",
      extraRootFiles,
      ...vfs,
    });

    expect(result.code).toContain("a === b");
    expect(result.code).not.toContain("eqPoint.equals");
  });

  it("reports an ambiguity error when two activated typeclasses map the operator for the type", () => {
    // A second typeclass `Same` also maps `===`, with its own instance for Point.
    const AMBIG_LIB = `
/** @typeclass */
export interface Same<A> {
  /** @op === */
  same(a: A, b: A): boolean;
}
export interface Point { x: number; y: number; }
/** @instance */
export const samePoint: Same<Point> = { same: (a, b) => a.x === b.x && a.y === b.y };
`.trim();
    const SAME_OPS_MARKER = `/** @syntax-operators Same */\nexport {};\n`;

    const consumer = `
import { Point, eqPoint } from "./eq-lib";
import { samePoint } from "./ambig-lib";
import "./eq-ops";
import "./same-ops";

declare const a: Point;
declare const b: Point;
export const r = a === b;
`.trim();

    const vfs = createVirtualFs({
      "eq-lib.ts": EQ_LIB,
      "eq-ops.ts": EQ_OPS_MARKER,
      "ambig-lib.ts": AMBIG_LIB,
      "same-ops.ts": SAME_OPS_MARKER,
      "consumer.ts": consumer,
    });
    const result = transformCode(consumer, {
      fileName: "consumer.ts",
      extraRootFiles: [
        path.resolve("eq-lib.ts"),
        path.resolve("eq-ops.ts"),
        path.resolve("ambig-lib.ts"),
        path.resolve("same-ops.ts"),
      ],
      ...vfs,
    });

    const ambiguity = result.diagnostics.find((d) => /[Aa]mbiguous/.test(d.message));
    expect(ambiguity).toBeDefined();
  });

  it("activates a same-file typeclass regardless of declaration order (hoisting)", () => {
    // The `a === b` usage appears BEFORE the @typeclass interface + instance.
    // Activation is computed in the pre-scan, so it must not depend on visit order.
    const consumer = `
declare const a: Point;
declare const b: Point;
export const r = a === b;

/** @typeclass */
interface Eq<A> {
  /** @op === */
  equals(a: A, b: A): boolean;
}
interface Point { x: number; y: number; }
/** @impl Eq<Point> */
const eqPoint: Eq<Point> = { equals: (a, b) => a.x === b.x && a.y === b.y };
`.trim();

    const vfs = createVirtualFs({ "consumer.ts": consumer });
    const result = transformCode(consumer, { fileName: "consumer.ts", ...vfs });

    expect(result.code).not.toMatch(/a === b/);
    expect(result.code).toContain("eqPoint.equals(a, b)");
  });

  it("falls back to native when activated but no instance for the operand type", () => {
    const consumer = `
import "./eq-ops";

interface Other { z: number; }
declare const a: Other;
declare const b: Other;
export const r = a === b;
`.trim();

    const vfs = project(consumer);
    const result = transformCode(consumer, {
      fileName: "consumer.ts",
      extraRootFiles,
      ...vfs,
    });

    expect(result.code).toContain("a === b");
  });
});

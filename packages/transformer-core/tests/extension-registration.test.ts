/**
 * Tests for extension-registration.ts — PEP-027 "use extension" self-registration
 * codegen (PEP-056 Wave 4 parity gap #3, ported from legacy index.ts).
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import { emitExtensionRegistrations } from "../src/extension-registration.js";
import { transformCode } from "../src/transform.js";

function parseStatements(source: string): ts.Statement[] {
  const sf = ts.createSourceFile("test.ts", source, ts.ScriptTarget.Latest, true);
  return Array.from(sf.statements);
}

function printStatements(statements: ts.Statement[]): string {
  const printer = ts.createPrinter();
  const sf = ts.createSourceFile("out.ts", "", ts.ScriptTarget.Latest, false);
  return statements.map((s) => printer.printNode(ts.EmitHint.Unspecified, s, sf)).join("\n");
}

describe("emitExtensionRegistrations", () => {
  it("emits a registration call for an exported function whose first param names a concrete type", () => {
    const statements = parseStatements(
      "export function head(self: Array<number>): number { return self[0]; }"
    );
    const regs = emitExtensionRegistrations(ts.factory, statements);
    expect(regs).toHaveLength(1);
    const printed = printStatements(regs);
    expect(printed).toContain("globalThis.__typesugar_registerExtension");
    expect(printed).toContain('"head"');
    expect(printed).toContain('"Array"');
  });

  it("emits a registration call for an exported const arrow function", () => {
    const statements = parseStatements(
      "export const isEven = (self: number): boolean => self % 2 === 0;"
    );
    const regs = emitExtensionRegistrations(ts.factory, statements);
    expect(regs).toHaveLength(1);
    const printed = printStatements(regs);
    expect(printed).toContain('"isEven"');
    expect(printed).toContain('"number"');
  });

  it("skips non-exported functions", () => {
    const statements = parseStatements(
      "function head(self: Array<number>): number { return self[0]; }"
    );
    expect(emitExtensionRegistrations(ts.factory, statements)).toHaveLength(0);
  });

  it("skips exported functions whose first param type is a bare type parameter of the function itself", () => {
    const statements = parseStatements("export function identity<T>(self: T): T { return self; }");
    expect(emitExtensionRegistrations(ts.factory, statements)).toHaveLength(0);
  });

  it("skips exported functions with no parameters", () => {
    const statements = parseStatements("export function noop(): void {}");
    expect(emitExtensionRegistrations(ts.factory, statements)).toHaveLength(0);
  });

  it("emits registrations for multiple exported functions in module order", () => {
    const statements = parseStatements(
      [
        "export function head(self: Array<number>): number { return self[0]; }",
        "export function isEven(self: number): boolean { return self % 2 === 0; }",
      ].join("\n")
    );
    const regs = emitExtensionRegistrations(ts.factory, statements);
    expect(regs).toHaveLength(2);
    const printed = printStatements(regs);
    expect(printed.indexOf('"head"')).toBeLessThan(printed.indexOf('"isEven"'));
  });
});

describe("PEP-027 'use extension' dispatch wiring (end-to-end)", () => {
  // Drives the real transformCode() API (not the standalone function above) to
  // prove the "use extension" directive -> registration-codegen path is wired
  // into transformer-core's dispatch, not just implemented as a dead function.
  it("appends registration calls for a file carrying the 'use extension' directive", () => {
    const result = transformCode(
      [
        '"use extension";',
        "export function head(self: Array<number>): number { return self[0]; }",
      ].join("\n"),
      { fileName: "extension-registration-e2e.ts" }
    );

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).toContain("globalThis.__typesugar_registerExtension");
    expect(result.code).toContain('"head"');
    expect(result.code).toContain('"Array"');
  });

  it("does not append registration calls for a file without the directive", () => {
    const result = transformCode(
      "export function head(self: Array<number>): number { return self[0]; }",
      { fileName: "extension-registration-e2e-no-directive.ts" }
    );

    expect(result.code).not.toContain("__typesugar_registerExtension");
  });
});

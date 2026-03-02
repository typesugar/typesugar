/**
 * Tests for "use extension" directive scanning and tracking
 */
import { describe, it, expect, beforeEach } from "vitest";
import * as ts from "typescript";
import { globalResolutionScope, scanImportsForScope } from "@typesugar/core";

describe('"use extension" directive', () => {
  beforeEach(() => {
    globalResolutionScope.reset();
  });

  it("should detect 'use extension' directive at file level", () => {
    const code = `
"use extension";

export function head<T>(arr: T[]): T | undefined {
  return arr[0];
}
`;
    const sourceFile = ts.createSourceFile("test-extension.ts", code, ts.ScriptTarget.ESNext, true);

    scanImportsForScope(sourceFile, globalResolutionScope);

    expect(globalResolutionScope.hasUseExtension("test-extension.ts")).toBe(true);
  });

  it("should not detect directive when not present", () => {
    const code = `
export function head<T>(arr: T[]): T | undefined {
  return arr[0];
}
`;
    const sourceFile = ts.createSourceFile(
      "test-no-extension.ts",
      code,
      ts.ScriptTarget.ESNext,
      true
    );

    scanImportsForScope(sourceFile, globalResolutionScope);

    expect(globalResolutionScope.hasUseExtension("test-no-extension.ts")).toBe(false);
  });

  it("should ignore directive inside functions", () => {
    const code = `
function foo() {
  "use extension";
}
`;
    const sourceFile = ts.createSourceFile(
      "test-inner-directive.ts",
      code,
      ts.ScriptTarget.ESNext,
      true
    );

    scanImportsForScope(sourceFile, globalResolutionScope);

    expect(globalResolutionScope.hasUseExtension("test-inner-directive.ts")).toBe(false);
  });

  it("should work alongside other directives", () => {
    const code = `
"use strict";
"use extension";

export function head<T>(arr: T[]): T | undefined {
  return arr[0];
}
`;
    const sourceFile = ts.createSourceFile(
      "test-multiple-directives.ts",
      code,
      ts.ScriptTarget.ESNext,
      true
    );

    scanImportsForScope(sourceFile, globalResolutionScope);

    expect(globalResolutionScope.hasUseExtension("test-multiple-directives.ts")).toBe(true);
  });

  it("should distinguish between different files", () => {
    const code1 = `"use extension"; export const a = 1;`;
    const code2 = `export const b = 2;`;

    const sourceFile1 = ts.createSourceFile("file1.ts", code1, ts.ScriptTarget.ESNext, true);
    const sourceFile2 = ts.createSourceFile("file2.ts", code2, ts.ScriptTarget.ESNext, true);

    scanImportsForScope(sourceFile1, globalResolutionScope);
    scanImportsForScope(sourceFile2, globalResolutionScope);

    expect(globalResolutionScope.hasUseExtension("file1.ts")).toBe(true);
    expect(globalResolutionScope.hasUseExtension("file2.ts")).toBe(false);
  });
});

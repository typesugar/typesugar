/**
 * Tests for inline-failure classification, which drives the TS9602
 * auto-specialization skip warning.
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import { classifyInlineFailure, getInlineFailureHelp } from "@typesugar/macros";

describe("classifyInlineFailure", () => {
  function parseBlock(code: string): ts.Block {
    const sourceFile = ts.createSourceFile(
      "test.ts",
      `function test() ${code}`,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
    const fn = sourceFile.statements[0] as ts.FunctionDeclaration;
    return fn.body!;
  }

  it("should return null for single return statement", () => {
    const block = parseBlock("{ return x + y; }");
    expect(classifyInlineFailure(block)).toBe(null);
  });

  it("should detect early return", () => {
    const block = parseBlock(`{
      if (x < 0) return -1;
      return x;
    }`);
    // May return "early return" or "early return (flattenable)" depending on pattern
    const result = classifyInlineFailure(block);
    expect(result).toMatch(/^early return/);
  });

  it("should detect multiple returns", () => {
    const block = parseBlock(`{
      const a = 1;
      return a;
      return b;
    }`);
    // May return "early return" or "early return (flattenable)" depending on pattern
    const result = classifyInlineFailure(block);
    expect(result).toMatch(/^early return/);
  });

  it("should detect try/catch", () => {
    const block = parseBlock(`{
      try { doSomething(); } catch (e) { }
      return x;
    }`);
    expect(classifyInlineFailure(block)).toBe("try/catch");
  });

  it("should detect for loop", () => {
    const block = parseBlock(`{
      for (let i = 0; i < 10; i++) { sum += i; }
      return sum;
    }`);
    expect(classifyInlineFailure(block)).toBe("loop");
  });

  it("should detect while loop", () => {
    const block = parseBlock(`{
      while (x > 0) { x--; }
      return x;
    }`);
    expect(classifyInlineFailure(block)).toBe("loop");
  });

  it("should detect do-while loop", () => {
    const block = parseBlock(`{
      do { x--; } while (x > 0);
      return x;
    }`);
    expect(classifyInlineFailure(block)).toBe("loop");
  });

  it("should detect for-of loop", () => {
    const block = parseBlock(`{
      for (const item of items) { process(item); }
      return result;
    }`);
    expect(classifyInlineFailure(block)).toBe("loop");
  });

  it("should detect for-in loop", () => {
    const block = parseBlock(`{
      for (const key in obj) { process(key); }
      return result;
    }`);
    expect(classifyInlineFailure(block)).toBe("loop");
  });

  it("should detect mutable variable (let)", () => {
    const block = parseBlock(`{
      let x = 1;
      return x;
    }`);
    expect(classifyInlineFailure(block)).toBe("mutable variable");
  });

  it("should allow const declarations", () => {
    const block = parseBlock(`{
      const x = 1;
      return x;
    }`);
    expect(classifyInlineFailure(block)).toBe(null);
  });

  it("should detect throw statement", () => {
    const block = parseBlock(`{
      throw new Error("oops");
    }`);
    expect(classifyInlineFailure(block)).toBe("throw statement");
  });

  it("should detect no return statement", () => {
    const block = parseBlock(`{
      console.log("hello");
    }`);
    expect(classifyInlineFailure(block)).toBe("no return statement");
  });

  it("should detect empty block", () => {
    const block = parseBlock("{ }");
    expect(classifyInlineFailure(block)).toBe("no return statement");
  });

  it("should detect try/catch nested in if", () => {
    const block = parseBlock(`{
      if (condition) {
        try { x(); } catch (e) { }
      }
      return x;
    }`);
    expect(classifyInlineFailure(block)).toBe("try/catch");
  });

  it("should detect loop nested in if", () => {
    const block = parseBlock(`{
      if (condition) {
        for (const x of items) { process(x); }
      }
      return x;
    }`);
    expect(classifyInlineFailure(block)).toBe("loop");
  });
});

describe("getInlineFailureHelp", () => {
  it("should provide help for early return", () => {
    const help = getInlineFailureHelp("early return");
    expect(help).toContain("helper");
  });

  it("should provide help for try/catch", () => {
    const help = getInlineFailureHelp("try/catch");
    expect(help).toContain("error handling");
  });

  it("should provide help for loop", () => {
    const help = getInlineFailureHelp("loop");
    expect(help).toContain("Array methods");
  });

  it("should provide help for mutable variable", () => {
    const help = getInlineFailureHelp("mutable variable");
    expect(help).toContain("const");
  });

  it("should provide help for throw statement", () => {
    const help = getInlineFailureHelp("throw statement");
    expect(help).toContain("Result");
  });

  it("should provide help for no return statement", () => {
    const help = getInlineFailureHelp("no return statement");
    expect(help).toContain("return");
  });

  it("should return empty string for null", () => {
    const help = getInlineFailureHelp(null);
    expect(help).toBe("");
  });
});

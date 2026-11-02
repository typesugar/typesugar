import { describe, it, expect } from "vitest";
import { is, assert, validate } from "@typesugar/validate";

// These test the runtime stubs, which only run untransformed: each call opts
// out of the macro (which reports a call with no type argument as an error).
describe("@typesugar/validate runtime stubs", () => {
  it("is<T>() should throw without transformer", () => {
    expect(() => is()).toThrow("compile-time macro"); // @ts-no-typesugar
  });

  it("assert<T>() should throw without transformer", () => {
    expect(() => assert()).toThrow("compile-time macro"); // @ts-no-typesugar
  });

  it("validate<T>() should throw without transformer", () => {
    expect(() => validate()).toThrow("compile-time macro"); // @ts-no-typesugar
  });
});

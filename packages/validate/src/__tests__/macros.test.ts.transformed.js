import { describe, it, expect } from "vitest";
import { is, assert, validate } from "@typesugar/validate";
describe("@typesugar/validate runtime stubs", () => {
    it("is<T>() should throw without transformer", () => {
        expect(() => is()).toThrow("compile-time macro");
    });
    it("assert<T>() should throw without transformer", () => {
        expect(() => assert()).toThrow("compile-time macro");
    });
    it("validate<T>() should throw without transformer", () => {
        expect(() => validate()).toThrow("compile-time macro");
    });
});

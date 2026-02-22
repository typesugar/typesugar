import { describe, it, expect, beforeEach } from "vitest";
import { transformCode } from "../src/pipeline.js";
import {
  clearRegistries,
  registerInstanceMethods,
  clearSyntaxRegistry,
  isRegisteredInstance,
  getInstanceMethods,
} from "@typesugar/macros";

beforeEach(() => {
  clearRegistries();
  clearSyntaxRegistry();
});

describe("Debug auto-specialize", () => {
  it("check registry and transform", () => {
    registerInstanceMethods("arrayFunctor", "Array", {
      map: {
        source: "(fa, f) => fa.map(f)",
        params: ["fa", "f"],
      },
    });

    console.log("isRegistered:", isRegisteredInstance("arrayFunctor"));
    console.log("methods:", JSON.stringify(getInstanceMethods("arrayFunctor")));

    const code = `
declare const arrayFunctor: any;
const double = (F: { map(fa: any, f: any): any }, xs: number[]) => F.map(xs, (x: number) => x * 2);
const result = double(arrayFunctor, [1, 2, 3]);
    `.trim();

    const result = transformCode(code, { fileName: "auto-spec-debug.ts", verbose: true });
    console.log("=== CODE ===");
    console.log(result.code);
    console.log("=== DIAGS ===");
    console.log(JSON.stringify(result.diagnostics, null, 2));
    
    expect(result.code).toContain("__double_Array");
  });
});

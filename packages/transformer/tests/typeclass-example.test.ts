import { describe, it, expect } from "vitest";
import { transformCode } from "../src/pipeline.js";
import * as fs from "fs";
import * as path from "path";

describe("@typeclass playground example", () => {
  it("transforms without errors and resolves correct instances", () => {
    const examplePath = path.resolve(__dirname, "../../../docs/examples/core/typeclass.ts");
    const code = fs.readFileSync(examplePath, "utf-8");

    const r = transformCode(code, { fileName: "typeclass-example.ts" });

    const errors = r.diagnostics.filter((d) => d.severity === "error");
    expect(errors).toHaveLength(0);

    // implicit() resolution: show(42) gets showNumber, show("hello") gets
    // showString, and each completed call is then auto-specialized.
    expect(r.code).toMatch(/__typesugar___show_number_\d+__\(42\)/);
    expect(r.code).toMatch(/__typesugar___show_string_\d+__\("hello"\)/);
    expect(r.code).not.toContain("show(42, showNumber)");

    // Auto-derivation via implicit(): show(point) gets an auto-derived Show<Point>
    expect(r.code).toContain("a.x");
    expect(r.code).toContain("a.y");
  });
});

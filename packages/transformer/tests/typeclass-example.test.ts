import { describe, it, expect, beforeEach } from "vitest";
import { transformCode } from "../src/pipeline.js";
import { clearRegistries, clearSyntaxRegistry } from "@typesugar/macros";
import * as fs from "fs";
import * as path from "path";

beforeEach(() => {
  clearSyntaxRegistry();
  clearRegistries();
});

describe("@typeclass playground example", () => {
  it("transforms without errors and resolves correct instances", () => {
    const examplePath = path.resolve(__dirname, "../../../docs/examples/core/typeclass.ts");
    const code = fs.readFileSync(examplePath, "utf-8");

    const r = transformCode(code, { fileName: "typeclass-example.ts" });

    const errors = r.diagnostics.filter((d) => d.severity === "error");
    expect(errors).toHaveLength(0);

    // implicit() resolution: show(42) gets showNumber, show("hello") gets showString
    expect(r.code).toContain("show(42, showNumber)");
    expect(r.code).toContain('show("hello", showString)');

    // Auto-derivation via implicit(): show(point) gets an auto-derived Show<Point>
    expect(r.code).toContain("a.x");
    expect(r.code).toContain("a.y");
  });
});

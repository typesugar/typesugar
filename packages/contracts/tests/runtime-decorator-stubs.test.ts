/**
 * Docs and examples write `import { invariant, contract } from "@typesugar/contracts"`.
 * The transformer strips the decorators but the import survives, so the BUILT
 * runtime entry must actually export those names — otherwise ESM linking
 * fails ("does not provide an export named 'invariant'") before any code runs.
 * Without the transformer the stubs leave the target unchanged and warn once
 * that nothing is being checked.
 */
import { describe, it, expect, vi } from "vitest";
import * as path from "path";
import { pathToFileURL } from "url";
import { execFileSync } from "child_process";

const ESM_ENTRY = pathToFileURL(path.resolve(__dirname, "../dist/index.js")).href;

describe("runtime entry exports invariant / contract", () => {
  it("a real ESM import of { invariant, contract } from the built entry links and runs", () => {
    const script =
      `import { invariant, contract, requires } from ${JSON.stringify(ESM_ENTRY)};\n` +
      `if (typeof invariant !== "function" || typeof contract !== "function") throw new Error("not functions");\n` +
      `requires(true);\n` +
      `process.stdout.write("ok");\n`;
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8",
    });
    expect(out).toBe("ok");
  });

  it("stubs keep the decorated target and warn that nothing is checked", async () => {
    const mod = await import(ESM_ENTRY);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      class Range {
        constructor(
          public min: number,
          public max: number
        ) {}
      }
      // Legacy class decorator call shape: (target) => replacement | undefined
      expect(mod.invariant((self: Range) => self.min <= self.max, "msg")(Range)).toBeUndefined();
      // Bare marker on a method: (target, key, descriptor) — legacy shape
      const desc = { value: () => 1, writable: true, enumerable: false, configurable: true };
      expect(mod.contract(Range.prototype, "m", desc)).toBeUndefined();
      // TC39 shape: (value, context)
      expect(mod.contract(() => 1, { kind: "method", name: "m" })).toBeUndefined();
      expect(new Range(1, 2).max).toBe(2);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("@invariant"));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("@contract"));
    } finally {
      warn.mockRestore();
    }
  });
});

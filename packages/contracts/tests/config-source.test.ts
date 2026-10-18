/**
 * #8 (deep review 2026-10): `contracts.*` settings come from the unified
 * @typesugar/core config. The old code required a non-existent
 * "../../../src/core/config.js", so every setting was ignored.
 */

import { describe, it, expect, afterEach } from "vitest";
import { config } from "@typesugar/core";
import "@typesugar/contracts/macros";
import { getContractConfig, shouldEmitCheck } from "@typesugar/contracts";

afterEach(() => {
  config.set({
    contracts: {
      mode: "full",
      proveAtCompileTime: false,
      strip: { preconditions: false, postconditions: false, invariants: false },
    },
  });
});

describe("contracts config comes from @typesugar/core", () => {
  it("reads mode / proveAtCompileTime / strip set through core config", () => {
    config.set({ contracts: { mode: "none", proveAtCompileTime: true } });
    expect(getContractConfig().mode).toBe("none");
    expect(getContractConfig().proveAtCompileTime).toBe(true);
    expect(shouldEmitCheck("precondition")).toBe(false);

    config.set({ contracts: { mode: "full", strip: { postconditions: true } } });
    expect(shouldEmitCheck("precondition")).toBe(true);
    expect(shouldEmitCheck("postcondition")).toBe(false);
  });
});

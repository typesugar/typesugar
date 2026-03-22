import { describe, it, expect, beforeEach } from "vitest";
import { transformCode } from "../src/pipeline.js";
import {
  clearRegistries,
  clearSyntaxRegistry,
  registerTypeclassDef,
  registerInstanceWithMeta,
} from "@typesugar/macros";

beforeEach(() => {
  clearSyntaxRegistry();
  clearRegistries();
});

describe("implicit resolution should not auto-specialize", () => {
  it("calls showValue with resolved instance, not an inlined specialization", () => {
    const code = `
import { summon, implicit } from "typesugar";

/** @typeclass */
interface Show<A> {
  show(value: A): string;
}

/** @impl Show<number> */
const showNumber: Show<number> = {
  show: (n) => String(n),
};

function showValue(value: number, S: Show<number> = implicit()): string {
  return S.show(value);
}

const result = showValue(42);
`;

    const r = transformCode(code, { fileName: "test-impl-inline.ts" });

    // Should call showValue with the resolved instance, not a hoisted specialization
    expect(r.code).toContain("showValue(42, showNumber)");
    expect(r.code).not.toContain("__typesugar__");
  });

  it("preserves wrapper logic when showValue has non-trivial body", () => {
    const code = `
import { summon, implicit } from "typesugar";

/** @typeclass */
interface Show<A> {
  show(value: A): string;
}

/** @impl Show<number> */
const showNumber: Show<number> = {
  show: (n) => String(n),
};

function showValue(value: number, S: Show<number> = implicit()): string {
  return \`show \${S.show(value)}\`;
}

const result = showValue(42);
`;

    const r = transformCode(code, { fileName: "test-impl-template.ts" });

    // Must call showValue, not inline the body — the wrapping logic matters
    expect(r.code).toContain("showValue(42, showNumber)");
    expect(r.code).not.toContain("__typesugar__");
  });
});

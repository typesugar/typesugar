/**
 * Tests for Resolution Trace System
 *
 * Tests the formatting and generation of resolution traces
 * used in detailed error diagnostics.
 */

import { describe, it, expect } from "vitest";
import {
  formatResolutionTrace,
  generateHelpFromTrace,
  type ResolutionAttempt,
  type ResolutionTrace,
} from "../src/resolution-trace.js";

describe("formatResolutionTrace", () => {
  it("should format a single-step failure trace", () => {
    const trace: ResolutionTrace = {
      sought: "Eq<Point>",
      attempts: [
        {
          step: "explicit-instance",
          target: "Eq<Point>",
          result: "not-found",
          reason: "no @instance registered",
        },
      ],
      finalResult: "failed",
    };

    const lines = formatResolutionTrace(trace);

    expect(lines[0]).toBe("resolution trace for Eq<Point>:");
    expect(lines[1]).toContain("1. explicit-instance");
    expect(lines[1]).toContain("Eq<Point>");
    expect(lines[1]).toContain("not found");
  });

  it("should format a multi-step trace", () => {
    const trace: ResolutionTrace = {
      sought: "Eq<Point>",
      attempts: [
        {
          step: "explicit-instance",
          target: "Eq<Point>",
          result: "not-found",
        },
        {
          step: "auto-derive",
          target: "Eq<Point>",
          result: "rejected",
          reason: "field check failed",
        },
      ],
      finalResult: "failed",
    };

    const lines = formatResolutionTrace(trace);

    expect(lines[0]).toBe("resolution trace for Eq<Point>:");
    expect(lines[1]).toContain("1.");
    expect(lines[2]).toContain("2.");
  });

  it("should format nested traces with children", () => {
    const trace: ResolutionTrace = {
      sought: "Eq<Point>",
      attempts: [
        {
          step: "explicit-instance",
          target: "Eq<Point>",
          result: "not-found",
        },
        {
          step: "auto-derive via Generic",
          target: "Eq<Point>",
          result: "rejected",
          reason: "see child attempts",
          children: [
            {
              step: "derivation-strategy",
              target: "Eq",
              result: "found",
            },
            {
              step: "generic-meta",
              target: "GenericMeta for Point: { x: number, y: number, color: Color }",
              result: "found",
              children: [
                {
                  step: "field-check",
                  target: "field `x`: number",
                  result: "found",
                  reason: "number has Eq",
                },
                {
                  step: "field-check",
                  target: "field `y`: number",
                  result: "found",
                  reason: "number has Eq",
                },
                {
                  step: "field-check",
                  target: "field `color`: Color",
                  result: "rejected",
                  reason: "Color lacks Eq",
                },
              ],
            },
          ],
        },
      ],
      finalResult: "failed",
    };

    const lines = formatResolutionTrace(trace);

    expect(lines[0]).toBe("resolution trace for Eq<Point>:");
    expect(lines.some((l) => l.includes("field `x`"))).toBe(true);
    expect(lines.some((l) => l.includes("field `color`"))).toBe(true);
    expect(lines.some((l) => l.includes("FAILED"))).toBe(true);
  });

  it("should format successful traces with 'ok' indicator", () => {
    const trace: ResolutionTrace = {
      sought: "Show<number>",
      attempts: [
        {
          step: "explicit-instance",
          target: "Show<number>",
          result: "found",
        },
      ],
      finalResult: "resolved",
    };

    const lines = formatResolutionTrace(trace);

    expect(lines.some((l) => l.includes("ok"))).toBe(true);
  });

  it("should handle empty attempts array", () => {
    const trace: ResolutionTrace = {
      sought: "Eq<Unknown>",
      attempts: [],
      finalResult: "failed",
    };

    const lines = formatResolutionTrace(trace);

    expect(lines[0]).toBe("resolution trace for Eq<Unknown>:");
    expect(lines.length).toBe(1);
  });
});

describe("generateHelpFromTrace", () => {
  it("should suggest adding @derive for failing field", () => {
    const trace: ResolutionTrace = {
      sought: "Eq<Point>",
      attempts: [
        {
          step: "explicit-instance",
          target: "Eq<Point>",
          result: "not-found",
        },
        {
          step: "auto-derive",
          target: "Eq<Point>",
          result: "rejected",
          children: [
            {
              step: "field-check",
              target: "field `color`: Color",
              result: "rejected",
              reason: "Color lacks Eq",
            },
          ],
        },
      ],
      finalResult: "failed",
    };

    const help = generateHelpFromTrace(trace, "Eq", "Point");

    expect(help).toContain("@derive(Eq)");
    expect(help).toContain("Color");
  });

  it("should suggest registering derivation strategy when none exists", () => {
    const trace: ResolutionTrace = {
      sought: "MyTC<Point>",
      attempts: [
        {
          step: "derivation-strategy",
          target: "MyTC",
          result: "not-found",
          reason: "no GenericDerivation registered",
        },
      ],
      finalResult: "failed",
    };

    const help = generateHelpFromTrace(trace, "MyTC", "Point");

    expect(help).toContain("@instance");
    expect(help).toContain("MyTC<Point>");
  });

  it("should provide generic fallback help when trace is ambiguous", () => {
    const trace: ResolutionTrace = {
      sought: "Eq<Point>",
      attempts: [
        {
          step: "explicit-instance",
          target: "Eq<Point>",
          result: "not-found",
        },
      ],
      finalResult: "failed",
    };

    const help = generateHelpFromTrace(trace, "Eq", "Point");

    expect(help).toContain("@derive(Eq)");
    expect(help).toContain("Point");
  });
});

describe("ResolutionAttempt structure", () => {
  it("should allow all valid result values", () => {
    const attempts: ResolutionAttempt[] = [
      { step: "test", target: "A", result: "found" },
      { step: "test", target: "B", result: "not-found" },
      { step: "test", target: "C", result: "rejected" },
    ];

    expect(attempts[0].result).toBe("found");
    expect(attempts[1].result).toBe("not-found");
    expect(attempts[2].result).toBe("rejected");
  });

  it("should support optional reason field", () => {
    const withReason: ResolutionAttempt = {
      step: "test",
      target: "A",
      result: "rejected",
      reason: "custom reason",
    };

    const withoutReason: ResolutionAttempt = {
      step: "test",
      target: "B",
      result: "found",
    };

    expect(withReason.reason).toBe("custom reason");
    expect(withoutReason.reason).toBeUndefined();
  });

  it("should support nested children for hierarchical traces", () => {
    const parent: ResolutionAttempt = {
      step: "parent",
      target: "Root",
      result: "rejected",
      children: [
        { step: "child1", target: "A", result: "found" },
        { step: "child2", target: "B", result: "rejected" },
      ],
    };

    expect(parent.children).toHaveLength(2);
    expect(parent.children![0].result).toBe("found");
    expect(parent.children![1].result).toBe("rejected");
  });
});

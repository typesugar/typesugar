/**
 * Tests for Resolution Trace System
 *
 * Tests the formatting and generation of resolution traces
 * used in detailed error diagnostics.
 */

import * as ts from "typescript";
import { describe, it, expect, beforeEach } from "vitest";
import {
  formatResolutionTrace,
  generateHelpFromTrace,
  globalResolutionTracer,
  ResolutionTracer,
  type ResolutionAttempt,
  type ResolutionTrace,
} from "../src/resolution-trace.js";

function createSourceFile(content: string, fileName = "test.ts"): ts.SourceFile {
  return ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true);
}

function getFirstStatementNode(sf: ts.SourceFile): ts.Node {
  return sf.statements[0];
}

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

  it("should suggest ensuring type is in scope when GenericMeta not found", () => {
    const trace: ResolutionTrace = {
      sought: "Eq<UnknownType>",
      attempts: [
        {
          step: "explicit-instance",
          target: "Eq<UnknownType>",
          result: "not-found",
        },
        {
          step: "auto-derive",
          target: "Eq<UnknownType>",
          result: "not-found",
          children: [
            {
              step: "generic-meta",
              target: "GenericMeta for UnknownType",
              result: "not-found",
              reason: "type not found in scope",
            },
          ],
        },
      ],
      finalResult: "failed",
    };

    const help = generateHelpFromTrace(trace, "Eq", "UnknownType");

    expect(help).toContain("Ensure");
    expect(help).toContain("UnknownType");
    expect(help).toContain("defined");
  });

  it("should suggest field fix for nested structure (auto-derive via Generic with generic-meta children)", () => {
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
              target: "GenericMeta for Point: { x: number, color: Color }",
              result: "rejected",
              children: [
                {
                  step: "field-check",
                  target: "field `x`: number",
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

    const help = generateHelpFromTrace(trace, "Eq", "Point");

    expect(help).toContain("@derive(Eq)");
    expect(help).toContain("Color");
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

describe("ResolutionTracer", () => {
  let tracer: ResolutionTracer;

  beforeEach(() => {
    tracer = new ResolutionTracer();
    tracer.enable();
  });

  it("should record resolutions when enabled", () => {
    const sf = createSourceFile("const x = 1;", "a.ts");
    const node = getFirstStatementNode(sf);

    tracer.record("summon", node, sf, { name: "Eq", typeArgs: ["Point"] }, "explicit-instance");

    const records = tracer.getAllRecords();
    expect(records).toHaveLength(1);
    expect(records[0].kind).toBe("summon");
    expect(records[0].resolvedTo.name).toBe("Eq");
    expect(records[0].resolvedTo.typeArgs).toEqual(["Point"]);
    expect(records[0].sourceNode.fileName).toBe("a.ts");
  });

  it("should not record when disabled", () => {
    tracer.disable();
    const sf = createSourceFile("const x = 1;", "b.ts");
    tracer.record("summon", getFirstStatementNode(sf), sf, { name: "Show" }, "builtin");
    expect(tracer.getAllRecords()).toHaveLength(0);
  });

  it("should filter records by file via getRecordsForFile", () => {
    const sfA = createSourceFile("const a = 1;", "a.ts");
    const sfB = createSourceFile("const b = 2;", "b.ts");
    tracer.record("summon", getFirstStatementNode(sfA), sfA, { name: "Eq" }, "builtin");
    tracer.record("summon", getFirstStatementNode(sfB), sfB, { name: "Show" }, "builtin");

    expect(tracer.getRecordsForFile("a.ts")).toHaveLength(1);
    expect(tracer.getRecordsForFile("a.ts")[0].resolvedTo.name).toBe("Eq");
    expect(tracer.getRecordsForFile("b.ts")).toHaveLength(1);
    expect(tracer.getRecordsForFile("c.ts")).toHaveLength(0);
  });

  it("should produce getSummary with byKind and byTypeclass", () => {
    const sf = createSourceFile("const x = 1; const y = 2;", "sum.ts");
    const stmts = sf.statements;
    tracer.record("summon", stmts[0], sf, { name: "Eq" }, "builtin");
    tracer.record("summon", stmts[1], sf, { name: "Eq" }, "builtin");
    tracer.record("typeclass-operator", stmts[0], sf, { name: "Eq", method: "equals" }, "builtin");

    const summary = tracer.getSummary("sum.ts");
    expect(summary.fileName).toBe("sum.ts");
    expect(summary.totalResolutions).toBe(3);
    expect(summary.byKind["summon"]).toBe(2);
    expect(summary.byKind["typeclass-operator"]).toBe(1);
    expect(summary.byTypeclass["Eq"]).toBe(3);
  });

  it("should return getResolutionAt for position inside node", () => {
    const sf = createSourceFile("const x = 1;", "pos.ts");
    const node = getFirstStatementNode(sf);
    tracer.record("summon", node, sf, { name: "Eq" }, "builtin");

    const start = node.getStart(sf);
    const end = node.getEnd();
    const mid = Math.floor((start + end) / 2);

    expect(tracer.getResolutionAt("pos.ts", start)).toBeDefined();
    expect(tracer.getResolutionAt("pos.ts", mid)).toBeDefined();
    expect(tracer.getResolutionAt("pos.ts", end)).toBeDefined();
    expect(tracer.getResolutionAt("pos.ts", start - 1)).toBeUndefined();
    expect(tracer.getResolutionAt("pos.ts", end + 1)).toBeUndefined();
    expect(tracer.getResolutionAt("other.ts", mid)).toBeUndefined();
  });

  it("should produce getInlayHints with position and label", () => {
    const sf = createSourceFile("const x = 1;", "hints.ts");
    const node = getFirstStatementNode(sf);
    tracer.record("typeclass-method", node, sf, { name: "Show", method: "show" }, "builtin");

    const hints = tracer.getInlayHints("hints.ts");
    expect(hints).toHaveLength(1);
    expect(hints[0].label).toBe("Show.show");
    expect(hints[0].kind).toBe("typeclass");
    expect(hints[0].position).toBe(node.getEnd());
  });

  it("should formatForCLI with file grouping", () => {
    const sfA = createSourceFile("const a = 1;", "cli-a.ts");
    const sfB = createSourceFile("const b = 2;", "cli-b.ts");
    tracer.record("summon", getFirstStatementNode(sfA), sfA, { name: "Eq" }, "builtin");
    tracer.record("summon", getFirstStatementNode(sfB), sfB, { name: "Show" }, "builtin");

    const output = tracer.formatForCLI();
    expect(output).toContain("cli-a.ts");
    expect(output).toContain("cli-b.ts");
    expect(output).toContain("[summon]");
    expect(output).toContain("Eq");
    expect(output).toContain("Show");
  });

  it("should return 'No resolutions recorded.' when formatForCLI with empty tracer", () => {
    const empty = new ResolutionTracer();
    empty.enable();
    expect(empty.formatForCLI()).toBe("No resolutions recorded.");
  });

  it("should generateHoverContent with kind and source", () => {
    const sf = createSourceFile("summon<Eq<Point>>()", "hover.ts");
    const node = getFirstStatementNode(sf);
    tracer.record(
      "summon",
      node,
      sf,
      { name: "Eq", typeArgs: ["Point"], module: "@typesugar/std" },
      "explicit-instance"
    );

    const records = tracer.getAllRecords();
    const hover = tracer.generateHoverContent(records[0]);
    expect(hover).toContain("Typesugar Resolution");
    expect(hover).toContain("Eq");
    expect(hover).toContain("Point");
    expect(hover).toContain("Explicit @instance declaration");
    expect(hover).toContain("@typesugar/std");
  });

  it("should clear all records", () => {
    const sf = createSourceFile("const x = 1;", "clear.ts");
    tracer.record("summon", getFirstStatementNode(sf), sf, { name: "Eq" }, "builtin");
    expect(tracer.getAllRecords()).toHaveLength(1);
    tracer.clear();
    expect(tracer.getAllRecords()).toHaveLength(0);
  });

  it("should clearFile remove only that file's records", () => {
    const sfA = createSourceFile("const a = 1;", "file-a.ts");
    const sfB = createSourceFile("const b = 2;", "file-b.ts");
    tracer.record("summon", getFirstStatementNode(sfA), sfA, { name: "Eq" }, "builtin");
    tracer.record("summon", getFirstStatementNode(sfB), sfB, { name: "Show" }, "builtin");
    tracer.clearFile("file-a.ts");
    expect(tracer.getRecordsForFile("file-a.ts")).toHaveLength(0);
    expect(tracer.getRecordsForFile("file-b.ts")).toHaveLength(1);
  });
});

describe("globalResolutionTracer", () => {
  it("should be a ResolutionTracer instance", () => {
    expect(globalResolutionTracer).toBeDefined();
    expect(globalResolutionTracer).toBeInstanceOf(ResolutionTracer);
  });
});

describe("formatResolutionTrace edge cases", () => {
  it("should handle trace with many attempts", () => {
    const attempts: ResolutionAttempt[] = [];
    for (let i = 0; i < 10; i++) {
      attempts.push({
        step: `step-${i}`,
        target: `Target${i}`,
        result: i < 9 ? "not-found" : "rejected",
      });
    }
    const trace: ResolutionTrace = { sought: "TC<T>", attempts, finalResult: "failed" };
    const lines = formatResolutionTrace(trace);
    expect(lines[0]).toBe("resolution trace for TC<T>:");
    expect(lines).toHaveLength(11);
    expect(lines[10]).toContain("step-9");
  });

  it("should handle attempt with empty children array", () => {
    const trace: ResolutionTrace = {
      sought: "Eq<X>",
      attempts: [{ step: "auto-derive", target: "Eq<X>", result: "rejected", children: [] }],
      finalResult: "failed",
    };
    const lines = formatResolutionTrace(trace);
    expect(lines[0]).toBe("resolution trace for Eq<X>:");
    expect(lines[1]).toContain("auto-derive");
  });
});

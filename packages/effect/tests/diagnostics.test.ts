/**
 * Effect Diagnostics Tests
 *
 * Tests for the Effect-specific diagnostic codes and utilities.
 */
import { describe, it, expect } from "vitest";
import {
  EFFECT001,
  EFFECT002,
  EFFECT003,
  EFFECT010,
  EFFECT011,
  EFFECT020,
  EFFECT021,
  EFFECT030,
  EFFECT040,
  effectDiagnostics,
  getEffectDiagnostic,
  EffectDiagnosticCategory,
} from "../src/diagnostics.js";

describe("Effect Diagnostic Descriptors", () => {
  it("should have EFFECT001 for missing layer", () => {
    expect(EFFECT001.code).toBe("EFFECT001");
    expect(EFFECT001.numericCode).toBe(9901);
    expect(EFFECT001.severity).toBe("error");
    expect(EFFECT001.category).toBe(EffectDiagnosticCategory.ServiceResolution);
    expect(EFFECT001.messageTemplate).toContain("No layer provides");
  });

  it("should have EFFECT002 for incompatible layer", () => {
    expect(EFFECT002.code).toBe("EFFECT002");
    expect(EFFECT002.numericCode).toBe(9902);
    expect(EFFECT002.severity).toBe("error");
    expect(EFFECT002.category).toBe(EffectDiagnosticCategory.ServiceResolution);
  });

  it("should have EFFECT003 for ambiguous resolution", () => {
    expect(EFFECT003.code).toBe("EFFECT003");
    expect(EFFECT003.numericCode).toBe(9903);
    expect(EFFECT003.severity).toBe("warning");
    expect(EFFECT003.category).toBe(EffectDiagnosticCategory.ServiceResolution);
  });

  it("should have EFFECT010 for unhandled errors", () => {
    expect(EFFECT010.code).toBe("EFFECT010");
    expect(EFFECT010.numericCode).toBe(9910);
    expect(EFFECT010.severity).toBe("warning");
    expect(EFFECT010.category).toBe(EffectDiagnosticCategory.ErrorCompleteness);
  });

  it("should have EFFECT011 for redundant handlers", () => {
    expect(EFFECT011.code).toBe("EFFECT011");
    expect(EFFECT011.numericCode).toBe(9911);
    expect(EFFECT011.severity).toBe("info");
    expect(EFFECT011.category).toBe(EffectDiagnosticCategory.ErrorCompleteness);
  });

  it("should have EFFECT020 for circular dependencies", () => {
    expect(EFFECT020.code).toBe("EFFECT020");
    expect(EFFECT020.numericCode).toBe(9920);
    expect(EFFECT020.severity).toBe("error");
    expect(EFFECT020.category).toBe(EffectDiagnosticCategory.LayerDependency);
  });

  it("should have EFFECT021 for unused layers", () => {
    expect(EFFECT021.code).toBe("EFFECT021");
    expect(EFFECT021.numericCode).toBe(9921);
    expect(EFFECT021.severity).toBe("info");
    expect(EFFECT021.category).toBe(EffectDiagnosticCategory.LayerDependency);
  });

  it("should have EFFECT030 for schema drift", () => {
    expect(EFFECT030.code).toBe("EFFECT030");
    expect(EFFECT030.numericCode).toBe(9930);
    expect(EFFECT030.severity).toBe("error");
    expect(EFFECT030.category).toBe(EffectDiagnosticCategory.SchemaDrift);
  });

  it("should have EFFECT040 for type simplification", () => {
    expect(EFFECT040.code).toBe("EFFECT040");
    expect(EFFECT040.numericCode).toBe(9940);
    expect(EFFECT040.severity).toBe("info");
    expect(EFFECT040.category).toBe(EffectDiagnosticCategory.TypeSimplification);
  });
});

describe("effectDiagnostics catalog", () => {
  it("should contain all diagnostic descriptors", () => {
    expect(effectDiagnostics.EFFECT001).toBe(EFFECT001);
    expect(effectDiagnostics.EFFECT002).toBe(EFFECT002);
    expect(effectDiagnostics.EFFECT003).toBe(EFFECT003);
    expect(effectDiagnostics.EFFECT010).toBe(EFFECT010);
    expect(effectDiagnostics.EFFECT011).toBe(EFFECT011);
    expect(effectDiagnostics.EFFECT020).toBe(EFFECT020);
    expect(effectDiagnostics.EFFECT021).toBe(EFFECT021);
    expect(effectDiagnostics.EFFECT030).toBe(EFFECT030);
    expect(effectDiagnostics.EFFECT040).toBe(EFFECT040);
  });
});

describe("getEffectDiagnostic", () => {
  it("should retrieve diagnostic by code", () => {
    expect(getEffectDiagnostic("EFFECT001")).toBe(EFFECT001);
    expect(getEffectDiagnostic("EFFECT020")).toBe(EFFECT020);
    expect(getEffectDiagnostic("EFFECT040")).toBe(EFFECT040);
  });

  it("should return undefined for unknown codes", () => {
    expect(getEffectDiagnostic("EFFECT999")).toBeUndefined();
    expect(getEffectDiagnostic("TS9001")).toBeUndefined();
  });
});

describe("EffectDiagnosticCategory enum", () => {
  it("should have all categories", () => {
    expect(EffectDiagnosticCategory.ServiceResolution).toBe("service-resolution");
    expect(EffectDiagnosticCategory.ErrorCompleteness).toBe("error-completeness");
    expect(EffectDiagnosticCategory.LayerDependency).toBe("layer-dependency");
    expect(EffectDiagnosticCategory.SchemaDrift).toBe("schema-drift");
    expect(EffectDiagnosticCategory.TypeSimplification).toBe("type-simplification");
  });
});

describe("Diagnostics from main index", () => {
  it("should export all diagnostic symbols from main index", async () => {
    const index = await import("../src/index.js");

    expect(index.EFFECT001).toBeDefined();
    expect(index.EFFECT020).toBeDefined();
    expect(index.effectDiagnostics).toBeDefined();
    expect(index.getEffectDiagnostic).toBeDefined();
    expect(index.EffectDiagnosticBuilder).toBeDefined();
    expect(index.EffectDiagnosticCategory).toBeDefined();
    expect(index.formatEffectDiagnosticCLI).toBeDefined();
    expect(index.toTsDiagnostic).toBeDefined();
  });
});

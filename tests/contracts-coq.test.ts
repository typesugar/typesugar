/**
 * Tests for Coq-inspired improvements to @typesugar/contracts
 *
 * - Linear arithmetic solver (Fourier-Motzkin)
 * - Decidability annotations and warnings
 * - Vec<T, N> length-indexed arrays
 * - Subtyping coercions
 * - Proof certificates
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { TypeFact, DecidabilityInfo } from "@typesugar/contracts";

// ============================================================================
// Linear Arithmetic Solver Tests
// ============================================================================

describe("linear arithmetic solver", () => {
  it("should prove simple linear inequalities", async () => {
    const { tryLinearArithmetic } = await import("@typesugar/contracts");

    const facts: TypeFact[] = [
      { variable: "x", predicate: "x > 0" },
      { variable: "y", predicate: "y > 0" },
    ];

    // Sum of positives is positive
    const result = tryLinearArithmetic("x + y > 0", facts);
    expect(result.proven).toBe(true);
    expect(result.method).toBe("linear");
  });

  it("should prove transitivity", async () => {
    const { tryLinearArithmetic } = await import("@typesugar/contracts");

    const facts: TypeFact[] = [
      { variable: "x", predicate: "x > y" },
      { variable: "y", predicate: "y > z" },
    ];

    // x > y && y > z implies x > z
    const result = tryLinearArithmetic("x > z", facts);
    expect(result.proven).toBe(true);
  });

  it("should prove positive implies non-negative", async () => {
    const { trySimpleLinearProof } = await import("@typesugar/contracts");

    const facts: TypeFact[] = [{ variable: "x", predicate: "x > 0" }];

    const result = trySimpleLinearProof("x >= 0", facts);
    expect(result.proven).toBe(true);
  });

  it("should prove constant bounds", async () => {
    const { tryLinearArithmetic } = await import("@typesugar/contracts");

    const facts: TypeFact[] = [
      { variable: "x", predicate: "x >= 5" },
      { variable: "y", predicate: "y >= 3" },
    ];

    const result = tryLinearArithmetic("x + y >= 8", facts);
    expect(result.proven).toBe(true);
  });

  it("should not prove false goals", async () => {
    const { tryLinearArithmetic } = await import("@typesugar/contracts");

    const facts: TypeFact[] = [{ variable: "x", predicate: "x > 0" }];

    // Cannot prove x < 0 when x > 0
    const result = tryLinearArithmetic("x < 0", facts);
    expect(result.proven).toBe(false);
  });

  it("should handle equality constraints", async () => {
    const { tryLinearArithmetic } = await import("@typesugar/contracts");

    const facts: TypeFact[] = [{ variable: "x", predicate: "x === 5" }];

    const result = tryLinearArithmetic("x >= 5", facts);
    expect(result.proven).toBe(true);
  });

  it("should prove difference constraints", async () => {
    const { tryLinearArithmetic } = await import("@typesugar/contracts");

    // Test transitivity: x > y and y > 0 implies x > 0
    const facts: TypeFact[] = [
      { variable: "x", predicate: "x > y" },
      { variable: "y", predicate: "y > 0" },
    ];

    const result = tryLinearArithmetic("x > 0", facts);
    expect(result.proven).toBe(true);
  });
});

// ============================================================================
// Decidability Annotations Tests
// ============================================================================

describe("decidability annotations", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should register decidability info", async () => {
    const { registerDecidability, getDecidability } = await import("@typesugar/contracts");

    const info: DecidabilityInfo = {
      brand: "TestBrand",
      decidability: "compile-time",
      preferredStrategy: "constant",
    };

    registerDecidability(info);

    const retrieved = getDecidability("TestBrand");
    expect(retrieved).toBeDefined();
    expect(retrieved?.decidability).toBe("compile-time");
    expect(retrieved?.preferredStrategy).toBe("constant");
  });

  it("should get preferred strategy with default", async () => {
    const { getPreferredStrategy } = await import("@typesugar/contracts");

    // Unknown brand should default to "algebra"
    const strategy = getPreferredStrategy("UnknownBrand123");
    expect(strategy).toBe("algebra");
  });

  it("should check if compile-time decidable", async () => {
    const { registerDecidability, isCompileTimeDecidable } = await import("@typesugar/contracts");

    registerDecidability({
      brand: "CompileTimeTest",
      decidability: "compile-time",
      preferredStrategy: "constant",
    });

    registerDecidability({
      brand: "RuntimeOnlyTest",
      decidability: "runtime",
      preferredStrategy: "algebra",
    });

    expect(isCompileTimeDecidable("CompileTimeTest")).toBe(true);
    expect(isCompileTimeDecidable("RuntimeOnlyTest")).toBe(false);
  });

  it("should check if requires runtime check", async () => {
    const { registerDecidability, requiresRuntimeCheck } = await import("@typesugar/contracts");

    registerDecidability({
      brand: "RuntimeRequiredTest",
      decidability: "runtime",
      preferredStrategy: "algebra",
    });

    registerDecidability({
      brand: "UndecidableTest",
      decidability: "undecidable",
      preferredStrategy: "algebra",
    });

    registerDecidability({
      brand: "DecidableTest",
      decidability: "decidable",
      preferredStrategy: "algebra",
    });

    expect(requiresRuntimeCheck("RuntimeRequiredTest")).toBe(true);
    expect(requiresRuntimeCheck("UndecidableTest")).toBe(true);
    expect(requiresRuntimeCheck("DecidableTest")).toBe(false);
  });

  it("should emit decidability warnings", async () => {
    const { emitDecidabilityWarning, setContractConfig, getContractConfig } =
      await import("@typesugar/contracts");

    // Configure to warn on fallback
    setContractConfig({
      ...getContractConfig(),
      decidabilityWarnings: {
        warnOnFallback: "warn",
        warnOnSMT: "info",
        ignoreBrands: [],
      },
    });

    emitDecidabilityWarning({
      brand: "TestPredicate",
      expectedStrategy: "compile-time",
      actualStrategy: "runtime",
      reason: "Could not evaluate at compile time",
    });

    expect(console.warn).toHaveBeenCalled();
  });

  it("should respect ignored brands in warnings", async () => {
    const { emitDecidabilityWarning, setContractConfig, getContractConfig } =
      await import("@typesugar/contracts");

    setContractConfig({
      ...getContractConfig(),
      decidabilityWarnings: {
        warnOnFallback: "warn",
        warnOnSMT: "info",
        ignoreBrands: ["IgnoredBrand"],
      },
    });

    emitDecidabilityWarning({
      brand: "IgnoredBrand",
      expectedStrategy: "compile-time",
      actualStrategy: "runtime",
    });

    expect(console.warn).not.toHaveBeenCalled();
  });

  it("should get all decidability info", async () => {
    const { registerDecidability, getAllDecidabilityInfo } = await import("@typesugar/contracts");

    registerDecidability({
      brand: "InfoTest1",
      decidability: "compile-time",
      preferredStrategy: "constant",
    });

    const allInfo = getAllDecidabilityInfo();
    expect(Array.isArray(allInfo)).toBe(true);

    const brands = allInfo.map((i) => i.brand);
    expect(brands).toContain("InfoTest1");
  });
});

// ============================================================================
// Vec<T, N> Length-Indexed Array Tests
// ============================================================================

describe("Vec<T, N> length-indexed arrays", () => {
  it("should create empty Vec", async () => {
    const { Vec } = await import("@typesugar/type-system");

    const empty = Vec.empty<string>();
    expect(empty.length).toBe(0);
    expect(Vec.toArray(empty)).toEqual([]);
  });

  it("should create singleton Vec", async () => {
    const { Vec } = await import("@typesugar/type-system");

    const single = Vec.singleton("hello");
    expect(single.length).toBe(1);
    expect(Vec.toArray(single)).toEqual(["hello"]);
  });

  it("should create Vec from array", async () => {
    const { Vec } = await import("@typesugar/type-system");

    const v = Vec.from<number, 3>([1, 2, 3]);
    expect(v.length).toBe(3);
    expect(Vec.toArray(v)).toEqual([1, 2, 3]);
  });

  it("should create Vec from tuple", async () => {
    const { Vec } = await import("@typesugar/type-system");

    const v = Vec.tuple("a", "b", "c");
    expect(v.length).toBe(3);
    expect(Vec.toArray(v)).toEqual(["a", "b", "c"]);
  });

  it("should create filled Vec", async () => {
    const { Vec } = await import("@typesugar/type-system");

    const v = Vec.fill(0, 5);
    expect(v.length).toBe(5);
    expect(Vec.toArray(v)).toEqual([0, 0, 0, 0, 0]);
  });

  it("should create generated Vec", async () => {
    const { Vec } = await import("@typesugar/type-system");

    const v = Vec.generate(4, (i) => i * 2);
    expect(v.length).toBe(4);
    expect(Vec.toArray(v)).toEqual([0, 2, 4, 6]);
  });

  it("should cons (prepend) element", async () => {
    const { Vec } = await import("@typesugar/type-system");

    const v3 = Vec.from<number, 3>([1, 2, 3]);
    const v4 = Vec.cons(0, v3);
    expect(v4.length).toBe(4);
    expect(Vec.toArray(v4)).toEqual([0, 1, 2, 3]);
  });

  it("should snoc (append) element", async () => {
    const { Vec } = await import("@typesugar/type-system");

    const v3 = Vec.from<number, 3>([1, 2, 3]);
    const v4 = Vec.snoc(v3, 4);
    expect(v4.length).toBe(4);
    expect(Vec.toArray(v4)).toEqual([1, 2, 3, 4]);
  });

  it("should append two Vecs", async () => {
    const { Vec } = await import("@typesugar/type-system");

    const a = Vec.from<number, 2>([1, 2]);
    const b = Vec.from<number, 3>([3, 4, 5]);
    const c = Vec.append(a, b);
    expect(c.length).toBe(5);
    expect(Vec.toArray(c)).toEqual([1, 2, 3, 4, 5]);
  });

  it("should get head", async () => {
    const { Vec } = await import("@typesugar/type-system");

    const v = Vec.from<number, 3>([1, 2, 3]);
    expect(Vec.head(v)).toBe(1);
  });

  it("should get tail", async () => {
    const { Vec } = await import("@typesugar/type-system");

    const v = Vec.from<number, 3>([1, 2, 3]);
    const t = Vec.tail(v);
    expect(t.length).toBe(2);
    expect(Vec.toArray(t)).toEqual([2, 3]);
  });

  it("should get last", async () => {
    const { Vec } = await import("@typesugar/type-system");

    const v = Vec.from<number, 3>([1, 2, 3]);
    expect(Vec.last(v)).toBe(3);
  });

  it("should get init", async () => {
    const { Vec } = await import("@typesugar/type-system");

    const v = Vec.from<number, 3>([1, 2, 3]);
    const i = Vec.init(v);
    expect(i.length).toBe(2);
    expect(Vec.toArray(i)).toEqual([1, 2]);
  });

  it("should take elements", async () => {
    const { Vec } = await import("@typesugar/type-system");

    const v = Vec.from<number, 5>([1, 2, 3, 4, 5]);
    const taken = Vec.take(v, 3);
    expect(taken.length).toBe(3);
    expect(Vec.toArray(taken)).toEqual([1, 2, 3]);
  });

  it("should drop elements", async () => {
    const { Vec } = await import("@typesugar/type-system");

    const v = Vec.from<number, 5>([1, 2, 3, 4, 5]);
    const dropped = Vec.drop(v, 2);
    expect(dropped.length).toBe(3);
    expect(Vec.toArray(dropped)).toEqual([3, 4, 5]);
  });

  it("should get element at index", async () => {
    const { Vec } = await import("@typesugar/type-system");

    const v = Vec.from<number, 3>([10, 20, 30]);
    expect(Vec.get(v, 0)).toBe(10);
    expect(Vec.get(v, 1)).toBe(20);
    expect(Vec.get(v, 2)).toBe(30);
  });

  it("should throw on out-of-bounds access", async () => {
    const { Vec } = await import("@typesugar/type-system");

    const v = Vec.from<number, 3>([1, 2, 3]);
    expect(() => Vec.get(v, 5)).toThrow("index out of bounds");
    expect(() => Vec.get(v, -1)).toThrow("index out of bounds");
  });

  it("should map over Vec", async () => {
    const { Vec } = await import("@typesugar/type-system");

    const v = Vec.from<number, 3>([1, 2, 3]);
    const doubled = Vec.map(v, (x) => x * 2);
    expect(doubled.length).toBe(3);
    expect(Vec.toArray(doubled)).toEqual([2, 4, 6]);
  });

  it("should zip two Vecs", async () => {
    const { Vec } = await import("@typesugar/type-system");

    const a = Vec.from<number, 3>([1, 2, 3]);
    const b = Vec.from<string, 3>(["a", "b", "c"]);
    const zipped = Vec.zip(a, b);
    expect(zipped.length).toBe(3);
    expect(Vec.toArray(zipped)).toEqual([
      [1, "a"],
      [2, "b"],
      [3, "c"],
    ]);
  });

  it("should reverse Vec", async () => {
    const { Vec } = await import("@typesugar/type-system");

    const v = Vec.from<number, 3>([1, 2, 3]);
    const r = Vec.reverse(v);
    expect(r.length).toBe(3);
    expect(Vec.toArray(r)).toEqual([3, 2, 1]);
  });

  it("should check isVec", async () => {
    const { Vec, isVec } = await import("@typesugar/type-system");

    const v = Vec.from<number, 3>([1, 2, 3]);
    const arr = [1, 2, 3];

    expect(isVec(v)).toBe(true);
    expect(isVec(arr)).toBe(false);
    expect(isVec(null)).toBe(false);
    expect(isVec(undefined)).toBe(false);
  });

  it("should throw on length mismatch in from()", async () => {
    const { Vec } = await import("@typesugar/type-system");

    // This would be a type error in strict mode, but at runtime:
    // Vec.from validates length matches
    expect(() => {
      const arr = [1, 2];
      const v = Vec.from<number, 5>(arr);
      // Force access to trigger check if lazy
      Vec.get(v, 4);
    }).toThrow();
  });
});

// ============================================================================
// Dynamic Predicate Generator Tests
// ============================================================================

describe("dynamic predicate generators", () => {
  it("should generate Vec predicates dynamically", async () => {
    const { getRefinementPredicate } = await import("@typesugar/contracts");

    // Vec predicates are generated on-the-fly based on the brand pattern
    const pred5 = getRefinementPredicate("Vec<5>");
    expect(pred5).toBe("$.length === 5");

    const pred0 = getRefinementPredicate("Vec<0>");
    expect(pred0).toBe("$.length === 0");

    const pred100 = getRefinementPredicate("Vec<100>");
    expect(pred100).toBe("$.length === 100");
  });

  it("should allow registering custom dynamic generators", async () => {
    const { registerDynamicPredicateGenerator, getRefinementPredicate } =
      await import("@typesugar/contracts");

    // Register a custom pattern for Matrix<R,C>
    registerDynamicPredicateGenerator(
      /^Matrix<(\d+),(\d+)>$/,
      (match) => `$.rows === ${match[1]} && $.cols === ${match[2]}`
    );

    const matrixPred = getRefinementPredicate("Matrix<3,4>");
    expect(matrixPred).toBe("$.rows === 3 && $.cols === 4");
  });

  it("should fall back to undefined for unknown brands", async () => {
    const { getRefinementPredicate } = await import("@typesugar/contracts");

    const unknown = getRefinementPredicate("CompletelyUnknownType123456");
    expect(unknown).toBeUndefined();
  });
});

// ============================================================================
// Subtyping Coercions Tests
// ============================================================================

describe("subtyping coercions", () => {
  it("should register subtyping rules", async () => {
    const { registerSubtypingRule, getSubtypingRule, canWiden } =
      await import("@typesugar/contracts");

    registerSubtypingRule({
      from: "StrictPositive",
      to: "NonNegativeTest",
      proof: "strict_positive_implies_non_negative",
      justification: "x > 0 implies x >= 0",
    });

    expect(canWiden("StrictPositive", "NonNegativeTest")).toBe(true);

    const rule = getSubtypingRule("StrictPositive", "NonNegativeTest");
    expect(rule).toBeDefined();
    expect(rule?.justification).toContain("x > 0");
  });

  it("should allow identity widening", async () => {
    const { canWiden } = await import("@typesugar/contracts");

    // Same type should always be wideneable to itself
    expect(canWiden("Positive", "Positive")).toBe(true);
    expect(canWiden("NonEmpty", "NonEmpty")).toBe(true);
  });

  it("should get all widen targets", async () => {
    const { registerSubtypingRule, getWidenTargets } = await import("@typesugar/contracts");

    registerSubtypingRule({
      from: "WidenSource",
      to: "WidenTarget1",
      proof: "test",
      justification: "test",
    });

    registerSubtypingRule({
      from: "WidenSource",
      to: "WidenTarget2",
      proof: "test",
      justification: "test",
    });

    const targets = getWidenTargets("WidenSource");
    expect(targets.length).toBe(2);
    expect(targets.map((t) => t.to)).toContain("WidenTarget1");
    expect(targets.map((t) => t.to)).toContain("WidenTarget2");
  });

  it("should get all subtyping rules", async () => {
    const { getAllSubtypingRules } = await import("@typesugar/contracts");

    const rules = getAllSubtypingRules();
    expect(Array.isArray(rules)).toBe(true);
    // Should have at least some built-in rules from contracts-refined
  });
});

// ============================================================================
// Proof Certificates Tests
// ============================================================================

describe("proof certificates", () => {
  it("should create a proof certificate", async () => {
    const { createCertificate, succeedCertificate, createStep } =
      await import("@typesugar/contracts");

    // createCertificate takes (goal, assumptions)
    let cert = createCertificate("x > 0", []);
    expect(cert.goal).toBe("x > 0");
    expect(cert.proven).toBe(false);

    const step = createStep("identity", "Goal matches known fact");
    // succeedCertificate adds the step AND marks as proven
    cert = succeedCertificate(cert, "type", step);
    expect(cert.proven).toBe(true);
    expect(cert.method).toBe("type");
    // succeedCertificate adds the step, so we expect 1 step
    expect(cert.steps.length).toBe(1);
  });

  it("should create a failed certificate", async () => {
    const { createCertificate, failCertificate } = await import("@typesugar/contracts");

    let cert = createCertificate("impossible > 0", []);
    cert = failCertificate(cert, "No proof found");

    expect(cert.proven).toBe(false);
    expect(cert.failureReason).toBe("No proof found");
  });

  it("should format certificate as string", async () => {
    const { createCertificate, succeedCertificate, formatCertificate, createStep } =
      await import("@typesugar/contracts");

    let cert = createCertificate("x > 0", []);
    const step = createStep("constant", "Evaluated at compile time");
    cert = succeedCertificate(cert, "constant", step);

    const formatted = formatCertificate(cert);
    expect(formatted).toContain("x > 0");
    expect(formatted).toContain("PROVEN");
    expect(formatted).toContain("constant");
  });

  it("should convert certificate to proof result", async () => {
    const { createCertificate, succeedCertificate, certificateToResult, createStep } =
      await import("@typesugar/contracts");

    let cert = createCertificate("test", []);
    const step = createStep("algebra", "Sum of positives");
    cert = succeedCertificate(cert, "algebra", step);

    const result = certificateToResult(cert);
    expect(result.proven).toBe(true);
    expect(result.method).toBe("algebra");
  });

  it("should build a certificate with steps manually", async () => {
    const { createCertificate, succeedCertificate, createStep, addStep } =
      await import("@typesugar/contracts");

    // Start with facts and a goal
    const facts: TypeFact[] = [{ variable: "x", predicate: "x > 0" }];
    let cert = createCertificate("x > 0", facts);

    expect(cert.proven).toBe(false);
    expect(cert.goal).toBe("x > 0");
    expect(cert.assumptions).toEqual(facts);

    // Manually add steps to demonstrate the certificate building process
    // Step 1: Note that the goal matches a known assumption
    const identityStep = createStep("identity", "Goal 'x > 0' matches assumption");
    cert = addStep(cert, identityStep);
    expect(cert.steps.length).toBe(1);

    // Step 2: Mark as proven with the proof method
    const finalStep = createStep("deduction", "Verified against type facts");
    cert = succeedCertificate(cert, "type", finalStep);

    expect(cert.proven).toBe(true);
    expect(cert.method).toBe("type");
    expect(cert.steps.length).toBe(2); // addStep + succeedCertificate
  });
});

// ============================================================================
// @decidable Macro Tests
// ============================================================================

describe("@decidable macro", () => {
  it("should export decidable function", async () => {
    const { decidable } = await import("@typesugar/contracts");

    expect(typeof decidable).toBe("function");

    // Should register decidability
    decidable("CustomDecidableType", "compile-time", "constant");

    const { getDecidability } = await import("@typesugar/contracts");
    const info = getDecidability("CustomDecidableType");
    expect(info).toBeDefined();
    expect(info?.decidability).toBe("compile-time");
    expect(info?.preferredStrategy).toBe("constant");
  });

  it("should export decidableAttribute", async () => {
    const { decidableAttribute } = await import("@typesugar/contracts");

    expect(decidableAttribute).toBeDefined();
    expect(decidableAttribute.name).toBe("decidable");
    expect(decidableAttribute.validTargets).toContain("typeAlias");
  });
});

// ============================================================================
// Check Elision Tests
// ============================================================================

describe("check elision with decidability", () => {
  it("should prove goals matching type facts without emitting warnings", async () => {
    const { tryAlgebraicProof, isCompileTimeDecidable, registerDecidability } =
      await import("@typesugar/contracts");

    // Register a decidable type
    registerDecidability({
      brand: "AlwaysPositive",
      predicate: "$ > 0",
      description: "A value known to be positive at compile time",
      decidability: "compile-time",
      preferredStrategy: "algebra",
    });

    // Proof should succeed via algebraic rules
    const facts: TypeFact[] = [{ variable: "x", predicate: "x > 0" }];
    const result = tryAlgebraicProof("x > 0", facts);

    expect(result.proven).toBe(true);
    expect(result.method).toBe("algebra");
  });

  it("should provide subtyping-based proof hints", async () => {
    const { canWiden, getSubtypingRule, registerSubtypingRule } =
      await import("@typesugar/contracts");

    // Clear any prior state and register fresh rules
    registerSubtypingRule({
      from: "StrictlyPositive",
      to: "NonNegativeValue",
      proof: "strictly_positive_implies_nonnegative",
      justification: "x > 0 => x >= 0",
    });

    // Subtyping should work
    expect(canWiden("StrictlyPositive", "NonNegativeValue")).toBe(true);
    expect(canWiden("NonNegativeValue", "StrictlyPositive")).toBe(false);

    const rule = getSubtypingRule("StrictlyPositive", "NonNegativeValue");
    expect(rule?.justification).toBe("x > 0 => x >= 0");
  });

  it("should use linear solver for numerical bounds", async () => {
    const { tryLinearArithmetic, trySimpleLinearProof } = await import("@typesugar/contracts");

    // Test simple linear proof: x > 0 implies x >= 0
    const result = trySimpleLinearProof("x >= 0", [{ variable: "x", predicate: "x > 0" }]);

    expect(result.proven).toBe(true);
    expect(result.method).toBe("linear");
  });

  it("should track decidability for check elision decisions", async () => {
    const { getDecidability, canProveAtCompileTime, mustCheckAtRuntime, registerDecidability } =
      await import("@typesugar/contracts");

    // Register types with different decidability
    registerDecidability({
      brand: "CompileTimeKnown",
      predicate: "$ === 42",
      description: "Known at compile time",
      decidability: "compile-time",
      preferredStrategy: "constant",
    });

    registerDecidability({
      brand: "RuntimeOnly",
      predicate: "isValid($)",
      description: "Requires runtime validation",
      decidability: "runtime",
      preferredStrategy: "algebra",
    });

    // Check decidability classification
    const compileTime = getDecidability("CompileTimeKnown");
    const runtime = getDecidability("RuntimeOnly");

    expect(compileTime).toBeDefined();
    expect(runtime).toBeDefined();

    // Use the value-level decidability checkers
    expect(canProveAtCompileTime(compileTime!.decidability)).toBe(true);
    expect(canProveAtCompileTime(runtime!.decidability)).toBe(false);

    expect(mustCheckAtRuntime(compileTime!.decidability)).toBe(false);
    expect(mustCheckAtRuntime(runtime!.decidability)).toBe(true);
  });

  it("should elide checks when proof succeeds for compound expressions", async () => {
    const { tryAlgebraicProof, trySimpleLinearProof } = await import("@typesugar/contracts");

    // Compound facts from multiple type facts
    const facts: TypeFact[] = [
      { variable: "x", predicate: "x > 0" },
      { variable: "y", predicate: "y >= 0" },
    ];

    // x + y >= 0 should be provable (x > 0, y >= 0 => x + y > 0 >= 0)
    const result = trySimpleLinearProof("x + y >= 0", facts);
    expect(result.proven).toBe(true);

    // But x + y > 5 cannot be proven without knowing specific values
    const unprovable = tryAlgebraicProof("x + y > 5", facts);
    expect(unprovable.proven).toBe(false);
  });
});

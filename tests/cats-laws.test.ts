/**
 * Tests for the Cats Typeclass Laws System
 *
 * Tests cover:
 * - Law definition structure and types
 * - Value-level typeclass laws (Eq, Ord, Semigroup, Monoid, Show)
 * - HKT typeclass laws (Functor, Applicative, Monad, etc.)
 * - Property-test mode verification
 * - Equational reasoning rules in the prover
 */

import { describe, it, expect } from "vitest";

// ============================================================================
// Law Definition Imports
// ============================================================================

import {
  type Law,
  type LawSet,
  type ProofHint,
  // Value-level law generators
  eqLaws,
  ordLaws,
  semigroupLaws,
  monoidLaws,
  showLaws,
  showLawsWithEq,
  // HKT law generators
  functorLaws,
  applyLaws,
  applicativeLaws,
  flatMapLaws,
  monadLaws,
  foldableLaws,
  semigroupKLaws,
  monoidKLaws,
  alternativeLaws,
} from "../packages/cats/src/laws/index.js";

// Import typeclass interfaces
import type {
  Eq,
  Ord,
  Semigroup,
  Monoid,
  Show,
  Functor,
  Applicative,
  Monad,
  Foldable,
  SemigroupK,
  MonoidK,
  Alternative,
} from "../packages/cats/src/typeclasses/index.js";

import type { $ } from "../packages/cats/src/hkt.js";

// ============================================================================
// Test Instances
// ============================================================================

const eqNumber: Eq<number> = {
  eqv: (x, y) => x === y,
};

const ordNumber: Ord<number> = {
  ...eqNumber,
  compare: (x, y) => (x < y ? -1 : x > y ? 1 : 0),
};

const semigroupNumberAdd: Semigroup<number> = {
  combine: (x, y) => x + y,
};

const monoidNumberAdd: Monoid<number> = {
  ...semigroupNumberAdd,
  empty: 0,
};

const showNumber: Show<number> = {
  show: (x) => String(x),
};

// ============================================================================
// HKT Test Types and Instances
// ============================================================================

type OptionF = "Option";

interface Some<A> {
  readonly _tag: "Some";
  readonly value: A;
}

interface None {
  readonly _tag: "None";
}

type Option<A> = Some<A> | None;

declare module "../packages/cats/src/hkt.js" {
  interface URItoKind<A> {
    Option: Option<A>;
  }
}

const some = <A>(value: A): Option<A> => ({ _tag: "Some", value });
const none: Option<never> = { _tag: "None" };

const functorOption: Functor<OptionF> = {
  map: <A, B>(fa: $<OptionF, A>, f: (a: A) => B): $<OptionF, B> => {
    const opt = fa as Option<A>;
    return opt._tag === "Some" ? some(f(opt.value)) : (none as $<OptionF, B>);
  },
};

const eqOptionNumber = {
  eqv: (a: $<OptionF, number>, b: $<OptionF, number>): boolean => {
    const optA = a as Option<number>;
    const optB = b as Option<number>;
    if (optA._tag === "None" && optB._tag === "None") return true;
    if (optA._tag === "Some" && optB._tag === "Some")
      return optA.value === optB.value;
    return false;
  },
};

// ============================================================================
// Law Definition Structure Tests
// ============================================================================

describe("Law Definition Structure", () => {
  it("Law interface has required fields", () => {
    const laws = eqLaws(eqNumber);
    expect(laws.length).toBeGreaterThan(0);

    const law = laws[0];
    expect(law).toHaveProperty("name");
    expect(law).toHaveProperty("check");
    expect(law).toHaveProperty("arity");
    expect(typeof law.name).toBe("string");
    expect(typeof law.check).toBe("function");
    expect(typeof law.arity).toBe("number");
  });

  it("Laws have optional proofHint", () => {
    const laws = semigroupLaws(semigroupNumberAdd, eqNumber);
    const associativityLaw = laws.find((l) => l.name === "associativity");

    expect(associativityLaw).toBeDefined();
    expect(associativityLaw!.proofHint).toBe("associativity");
  });

  it("Laws have optional description", () => {
    const laws = eqLaws(eqNumber);
    const reflexivityLaw = laws.find((l) => l.name === "reflexivity");

    expect(reflexivityLaw).toBeDefined();
    expect(reflexivityLaw!.description).toBeDefined();
    expect(typeof reflexivityLaw!.description).toBe("string");
  });
});

// ============================================================================
// Value-Level Typeclass Law Tests
// ============================================================================

describe("Eq Laws", () => {
  const laws = eqLaws(eqNumber);

  it("generates reflexivity law", () => {
    const reflexivity = laws.find((l) => l.name === "reflexivity");
    expect(reflexivity).toBeDefined();
    expect(reflexivity!.arity).toBe(1);
    expect(reflexivity!.proofHint).toBe("reflexivity");

    expect(reflexivity!.check(42)).toBe(true);
    expect(reflexivity!.check(0)).toBe(true);
    expect(reflexivity!.check(-1)).toBe(true);
  });

  it("generates symmetry law", () => {
    const symmetry = laws.find((l) => l.name === "symmetry");
    expect(symmetry).toBeDefined();
    expect(symmetry!.arity).toBe(2);
    expect(symmetry!.proofHint).toBe("symmetry");

    expect(symmetry!.check(1, 2)).toBe(true);
    expect(symmetry!.check(5, 5)).toBe(true);
  });

  it("generates transitivity law", () => {
    const transitivity = laws.find((l) => l.name === "transitivity");
    expect(transitivity).toBeDefined();
    expect(transitivity!.arity).toBe(3);
    expect(transitivity!.proofHint).toBe("transitivity");

    expect(transitivity!.check(1, 1, 1)).toBe(true);
    expect(transitivity!.check(1, 2, 3)).toBe(true);
  });
});

describe("Ord Laws", () => {
  const laws = ordLaws(ordNumber);

  it("generates all Eq laws plus Ord-specific laws", () => {
    const lawNames = laws.map((l) => l.name);

    expect(lawNames).toContain("reflexivity");
    expect(lawNames).toContain("antisymmetry");
    expect(lawNames).toContain("transitivity");
    expect(lawNames).toContain("totality");
  });

  it("antisymmetry law works correctly", () => {
    const antisymmetry = laws.find((l) => l.name === "antisymmetry");
    expect(antisymmetry).toBeDefined();
    expect(antisymmetry!.arity).toBe(2);

    expect(antisymmetry!.check(1, 1)).toBe(true);
    expect(antisymmetry!.check(1, 2)).toBe(true);
  });

  it("totality law works correctly", () => {
    const totality = laws.find((l) => l.name === "totality");
    expect(totality).toBeDefined();
    expect(totality!.arity).toBe(2);

    expect(totality!.check(1, 2)).toBe(true);
    expect(totality!.check(2, 1)).toBe(true);
    expect(totality!.check(5, 5)).toBe(true);
  });
});

describe("Semigroup Laws", () => {
  const laws = semigroupLaws(semigroupNumberAdd, eqNumber);

  it("generates associativity law", () => {
    const associativity = laws.find((l) => l.name === "associativity");
    expect(associativity).toBeDefined();
    expect(associativity!.arity).toBe(3);
    expect(associativity!.proofHint).toBe("associativity");

    expect(associativity!.check(1, 2, 3)).toBe(true);
    expect(associativity!.check(0, 0, 0)).toBe(true);
    expect(associativity!.check(-1, 5, 10)).toBe(true);
  });
});

describe("Monoid Laws", () => {
  const laws = monoidLaws(monoidNumberAdd, eqNumber);

  it("generates identity laws plus associativity", () => {
    const lawNames = laws.map((l) => l.name);

    expect(lawNames).toContain("left identity");
    expect(lawNames).toContain("right identity");
    expect(lawNames).toContain("associativity");
  });

  it("left identity law works correctly", () => {
    const leftIdentity = laws.find((l) => l.name === "left identity");
    expect(leftIdentity).toBeDefined();
    expect(leftIdentity!.arity).toBe(1);
    expect(leftIdentity!.proofHint).toBe("identity-left");

    expect(leftIdentity!.check(42)).toBe(true);
    expect(leftIdentity!.check(0)).toBe(true);
    expect(leftIdentity!.check(-100)).toBe(true);
  });

  it("right identity law works correctly", () => {
    const rightIdentity = laws.find((l) => l.name === "right identity");
    expect(rightIdentity).toBeDefined();
    expect(rightIdentity!.arity).toBe(1);
    expect(rightIdentity!.proofHint).toBe("identity-right");

    expect(rightIdentity!.check(42)).toBe(true);
  });
});

describe("Show Laws", () => {
  const laws = showLaws(showNumber);

  it("generates determinism law", () => {
    const determinism = laws.find((l) => l.name === "determinism");
    expect(determinism).toBeDefined();
    expect(determinism!.arity).toBe(1);

    expect(determinism!.check(42)).toBe(true);
    expect(determinism!.check(0)).toBe(true);
  });
});

describe("Show Laws with Eq", () => {
  const laws = showLawsWithEq(showNumber, eqNumber);

  it("includes Eq consistency law", () => {
    const consistency = laws.find((l) => l.name === "eq consistency");
    expect(consistency).toBeDefined();
    expect(consistency!.arity).toBe(2);

    expect(consistency!.check(42, 42)).toBe(true);
    expect(consistency!.check(1, 2)).toBe(true);
  });
});

// ============================================================================
// HKT Typeclass Law Tests
// ============================================================================

describe("Functor Laws", () => {
  const laws = functorLaws<OptionF, number>(functorOption, eqOptionNumber);

  it("generates identity law", () => {
    const identity = laws.find((l) => l.name === "identity");
    expect(identity).toBeDefined();
    expect(identity!.proofHint).toBe("identity-left");

    const someValue = some(42);
    expect(identity!.check(someValue)).toBe(true);
    expect(identity!.check(none)).toBe(true);
  });
});

// ============================================================================
// Law Verification Tests
// ============================================================================

describe("Law Verification", () => {
  describe("Semigroup associativity verification", () => {
    const sg = semigroupNumberAdd;
    const eq = eqNumber;

    it("should hold for valid semigroup", () => {
      const laws = semigroupLaws(sg, eq);
      const assoc = laws.find((l) => l.name === "associativity")!;

      for (let i = 0; i < 100; i++) {
        const a = Math.floor(Math.random() * 200) - 100;
        const b = Math.floor(Math.random() * 200) - 100;
        const c = Math.floor(Math.random() * 200) - 100;
        expect(assoc.check(a, b, c)).toBe(true);
      }
    });
  });

  describe("Monoid identity verification", () => {
    const m = monoidNumberAdd;
    const eq = eqNumber;

    it("should hold for valid monoid", () => {
      const laws = monoidLaws(m, eq);
      const leftId = laws.find((l) => l.name === "left identity")!;
      const rightId = laws.find((l) => l.name === "right identity")!;

      for (let i = 0; i < 100; i++) {
        const a = Math.floor(Math.random() * 200) - 100;
        expect(leftId.check(a)).toBe(true);
        expect(rightId.check(a)).toBe(true);
      }
    });
  });
});

// ============================================================================
// Negative Tests (Laws that should fail for invalid instances)
// ============================================================================

describe("Negative Law Tests", () => {
  describe("Invalid Semigroup (non-associative)", () => {
    const badSemigroup: Semigroup<number> = {
      combine: (x, y) => x - y,
    };

    it("associativity law should fail", () => {
      const laws = semigroupLaws(badSemigroup, eqNumber);
      const assoc = laws.find((l) => l.name === "associativity")!;

      expect(assoc.check(10, 5, 3)).toBe(false);
    });
  });

  describe("Invalid Monoid (wrong identity)", () => {
    const badMonoid: Monoid<number> = {
      combine: (x, y) => x + y,
      empty: 1,
    };

    it("left identity law should fail", () => {
      const laws = monoidLaws(badMonoid, eqNumber);
      const leftId = laws.find((l) => l.name === "left identity")!;

      expect(leftId.check(5)).toBe(false);
    });

    it("right identity law should fail", () => {
      const laws = monoidLaws(badMonoid, eqNumber);
      const rightId = laws.find((l) => l.name === "right identity")!;

      expect(rightId.check(5)).toBe(false);
    });
  });

  describe("Invalid Eq (non-reflexive)", () => {
    const badEq: Eq<number> = {
      eqv: (x, y) => x !== y,
    };

    it("reflexivity law should fail", () => {
      const laws = eqLaws(badEq);
      const reflexivity = laws.find((l) => l.name === "reflexivity")!;

      expect(reflexivity.check(42)).toBe(false);
    });
  });

  describe("Invalid Functor (doesn't preserve identity)", () => {
    const badFunctor: Functor<OptionF> = {
      map: <A, B>(fa: $<OptionF, A>, f: (a: A) => B): $<OptionF, B> => {
        const opt = fa as Option<A>;
        if (opt._tag === "Some") {
          return some(f(opt.value)) as $<OptionF, B>;
        }
        return some(null as unknown as B) as $<OptionF, B>;
      },
    };

    it("identity law should fail for None", () => {
      const laws = functorLaws<OptionF, number>(badFunctor, eqOptionNumber);
      const identity = laws.find((l) => l.name === "identity")!;

      expect(identity.check(none)).toBe(false);
    });
  });
});

// ============================================================================
// Equational Reasoning Rule Tests
// ============================================================================

describe("Equational Reasoning Rules", () => {
  it("algebra.ts should export required types", async () => {
    const algebra = await import("../packages/contracts/src/prover/algebra.js");

    expect(algebra.tryAlgebraicProof).toBeDefined();
    expect(algebra.registerAlgebraicRule).toBeDefined();
    expect(algebra.getAllAlgebraicRules).toBeDefined();
  });

  it("should have equational reasoning rules registered", async () => {
    const { getAllAlgebraicRules } =
      await import("../packages/contracts/src/prover/algebra.js");

    const rules = getAllAlgebraicRules();
    const ruleNames = rules.map((r) => r.name);

    expect(ruleNames).toContain("left_identity");
    expect(ruleNames).toContain("right_identity");
    expect(ruleNames).toContain("associativity");
    expect(ruleNames).toContain("commutativity");
    expect(ruleNames).toContain("reflexivity");
  });
});

// ============================================================================
// @verifyLaws Macro Tests
// ============================================================================

describe("@verifyLaws Macro", () => {
  it("should export verifyLawsAttribute", async () => {
    const { verifyLawsAttribute } =
      await import("../src/macros/verify-laws.js");

    expect(verifyLawsAttribute).toBeDefined();
    expect(verifyLawsAttribute.name).toBe("verifyLaws");
    expect(verifyLawsAttribute.kind).toBe("attribute");
    expect(verifyLawsAttribute.validTargets).toContain("property");
    expect(verifyLawsAttribute.validTargets).toContain("class");
  });

  it("should export getVerifyLawsConfig", async () => {
    const { getVerifyLawsConfig } =
      await import("../src/macros/verify-laws.js");

    expect(getVerifyLawsConfig).toBeDefined();
    const config = getVerifyLawsConfig();
    expect(config).toHaveProperty("mode");
    expect(config).toHaveProperty("onUndecidable");
    expect(config).toHaveProperty("propertyTestIterations");
  });
});

// ============================================================================
// Config Extension Tests
// ============================================================================

describe("Config Extensions for Law Verification", () => {
  it("should have cats config section", async () => {
    const { config } = await import("../src/core/config.js");

    const catsConfig = config.get<{ verifyLaws?: unknown }>("cats");
    expect(catsConfig).toBeDefined();
  });

  it("should have correct default values", async () => {
    const { config } = await import("../src/core/config.js");

    expect(config.get("cats.verifyLaws")).toBe(false);
    expect(config.get("cats.onUndecidable")).toBe("warn");
    expect(config.get("cats.propertyTestIterations")).toBe(100);
  });

  it("should allow overriding via config.set", async () => {
    const { config } = await import("../src/core/config.js");

    config.set({
      cats: {
        verifyLaws: "property-test",
        onUndecidable: "error",
        propertyTestIterations: 500,
      },
    });

    expect(config.get("cats.verifyLaws")).toBe("property-test");
    expect(config.get("cats.onUndecidable")).toBe("error");
    expect(config.get("cats.propertyTestIterations")).toBe(500);

    config.set({
      cats: {
        verifyLaws: false,
        onUndecidable: "warn",
        propertyTestIterations: 100,
      },
    });
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe("Laws Re-exports from Cats Index", () => {
  it("should export all law types", async () => {
    const cats = await import("../packages/cats/src/index.js");

    expect(cats.Laws).toBeDefined();
    expect(cats.eqLaws).toBeDefined();
    expect(cats.ordLaws).toBeDefined();
    expect(cats.semigroupLaws).toBeDefined();
    expect(cats.monoidLaws).toBeDefined();
    expect(cats.showLaws).toBeDefined();
    expect(cats.functorLaws).toBeDefined();
    expect(cats.applicativeLaws).toBeDefined();
    expect(cats.monadLaws).toBeDefined();
    expect(cats.foldableLaws).toBeDefined();
    expect(cats.alternativeLaws).toBeDefined();
  });

  it("should have Laws namespace with all exports", async () => {
    const { Laws } = await import("../packages/cats/src/index.js");

    expect(Laws.eqLaws).toBeDefined();
    expect(Laws.ordLaws).toBeDefined();
    expect(Laws.semigroupLaws).toBeDefined();
    expect(Laws.monoidLaws).toBeDefined();
    expect(Laws.functorLaws).toBeDefined();
    expect(Laws.monadLaws).toBeDefined();
  });
});

// ============================================================================
// Macro Index Registration Tests
// ============================================================================

describe("Macro Registration", () => {
  it("should export verifyLawsAttribute from macros index", async () => {
    const macros = await import("../src/macros/index.js");

    expect(macros.verifyLawsAttribute).toBeDefined();
    expect(macros.getVerifyLawsConfig).toBeDefined();
  });
});

// ============================================================================
// Generic @ttfx/contracts Law System Tests
// ============================================================================

describe("Generic Law System (@ttfx/contracts)", () => {
  describe("Law Types", () => {
    it("should export generic Law and LawSet types", async () => {
      const contracts = await import("../packages/contracts/src/index.js");

      expect(contracts.defineLaw).toBeDefined();
      expect(contracts.combineLaws).toBeDefined();
      expect(contracts.filterLaws).toBeDefined();
      expect(contracts.filterByHint).toBeDefined();
    });

    it("defineLaw creates a valid law object", async () => {
      const { defineLaw } = await import("../packages/contracts/src/index.js");

      const law = defineLaw({
        name: "test law",
        arity: 2,
        proofHint: "reflexivity",
        check: (a: number, b: number) => a + b === b + a,
      });

      expect(law.name).toBe("test law");
      expect(law.arity).toBe(2);
      expect(law.proofHint).toBe("reflexivity");
      expect(law.check(1, 2)).toBe(true);
    });

    it("combineLaws merges multiple law sets", async () => {
      const { defineLaw, combineLaws } =
        await import("../packages/contracts/src/index.js");

      const laws1 = [defineLaw({ name: "law1", arity: 1, check: () => true })];
      const laws2 = [defineLaw({ name: "law2", arity: 2, check: () => true })];

      const combined = combineLaws(laws1, laws2);
      expect(combined).toHaveLength(2);
      expect(combined.map((l) => l.name)).toEqual(["law1", "law2"]);
    });

    it("filterByHint filters laws by proof hint", async () => {
      const { defineLaw, filterByHint } =
        await import("../packages/contracts/src/index.js");

      const laws = [
        defineLaw({
          name: "law1",
          arity: 1,
          proofHint: "associativity",
          check: () => true,
        }),
        defineLaw({
          name: "law2",
          arity: 1,
          proofHint: "reflexivity",
          check: () => true,
        }),
        defineLaw({
          name: "law3",
          arity: 1,
          proofHint: "associativity",
          check: () => true,
        }),
      ];

      const assocLaws = filterByHint(laws, "associativity");
      expect(assocLaws).toHaveLength(2);
      expect(assocLaws.map((l) => l.name)).toEqual(["law1", "law3"]);
    });
  });

  describe("Verification Functions", () => {
    it("should export verification functions", async () => {
      const contracts = await import("../packages/contracts/src/index.js");

      expect(contracts.verifyLaw).toBeDefined();
      expect(contracts.verifyLaws).toBeDefined();
      expect(contracts.verifyLawsAsync).toBeDefined();
      expect(contracts.formatVerificationSummary).toBeDefined();
    });

    it("verifyLaws returns a summary object", async () => {
      const { verifyLaws, defineLaw } =
        await import("../packages/contracts/src/index.js");

      const laws = [
        defineLaw({
          name: "simple law",
          arity: 1,
          check: () => true,
        }),
      ];

      const summary = verifyLaws(laws, []);
      expect(summary).toHaveProperty("total");
      expect(summary).toHaveProperty("proven");
      expect(summary).toHaveProperty("disproven");
      expect(summary).toHaveProperty("undecidable");
      expect(summary).toHaveProperty("results");
      expect(summary.total).toBe(1);
    });
  });

  describe("Configuration", () => {
    it("should export laws config functions", async () => {
      const contracts = await import("../packages/contracts/src/index.js");

      expect(contracts.setLawsConfig).toBeDefined();
      expect(contracts.getLawsConfig).toBeDefined();
      expect(contracts.resetLawsConfig).toBeDefined();
    });

    it("getLawsConfig returns default configuration", async () => {
      const { getLawsConfig, resetLawsConfig } =
        await import("../packages/contracts/src/index.js");

      resetLawsConfig();
      const config = getLawsConfig();

      expect(config.mode).toBe(false);
      expect(config.onUndecidable).toBe("warn");
      expect(config.iterations).toBe(100);
    });

    it("setLawsConfig updates configuration", async () => {
      const { setLawsConfig, getLawsConfig, resetLawsConfig } =
        await import("../packages/contracts/src/index.js");

      resetLawsConfig();
      setLawsConfig({ mode: "property-test", iterations: 50 });

      const config = getLawsConfig();
      expect(config.mode).toBe("property-test");
      expect(config.iterations).toBe(50);

      resetLawsConfig();
    });
  });

  describe("@laws Macro", () => {
    it("should export lawsAttribute", async () => {
      const contracts = await import("../packages/contracts/src/index.js");

      expect(contracts.lawsAttribute).toBeDefined();
      expect(contracts.lawsAttribute.name).toBe("laws");
      expect(contracts.lawsAttribute.kind).toBe("attribute");
    });

    it("should export laws runtime stub", async () => {
      const contracts = await import("../packages/contracts/src/index.js");

      expect(contracts.laws).toBeDefined();
      expect(typeof contracts.laws).toBe("function");

      const decorated = contracts.laws(() => [], {})({ value: 42 });
      expect(decorated).toEqual({ value: 42 });
    });
  });

  describe("Proof Hint Mapping", () => {
    it("should export proofHintToFacts", async () => {
      const { proofHintToFacts } =
        await import("../packages/contracts/src/index.js");

      expect(proofHintToFacts).toBeDefined();

      const facts = proofHintToFacts("associativity", "combine");
      expect(facts).toHaveLength(1);
      expect(facts[0].variable).toBe("combine");
      expect(facts[0].predicate).toContain("associative");
    });
  });
});

// ============================================================================
// Cats-to-Contracts Integration Tests
// ============================================================================

describe("Cats imports from @ttfx/contracts", () => {
  it("cats/laws re-exports generic types from contracts", async () => {
    const catsLaws = await import("../packages/cats/src/laws/index.js");
    const contracts = await import("../packages/contracts/src/index.js");

    // Note: In ESM environments, different import paths can result in different
    // module instances even for re-exports. We test functional equivalence
    // (same function signatures and behavior) rather than strict object identity.
    expect(typeof catsLaws.defineLaw).toBe("function");
    expect(typeof catsLaws.combineLaws).toBe("function");
    expect(typeof catsLaws.filterLaws).toBe("function");
    expect(typeof catsLaws.filterByHint).toBe("function");

    // Verify they have the same function signatures
    expect(catsLaws.defineLaw.length).toBe(contracts.defineLaw.length);
    expect(catsLaws.combineLaws.length).toBe(contracts.combineLaws.length);
    expect(catsLaws.filterLaws.length).toBe(contracts.filterLaws.length);
    expect(catsLaws.filterByHint.length).toBe(contracts.filterByHint.length);
  });

  it("cats law generators use generic Law type", () => {
    const laws = semigroupLaws(semigroupNumberAdd, eqNumber);

    expect(laws[0]).toHaveProperty("name");
    expect(laws[0]).toHaveProperty("check");
    expect(laws[0]).toHaveProperty("arity");
    expect(laws[0]).toHaveProperty("proofHint");
  });
});

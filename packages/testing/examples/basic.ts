/**
 * Basic @ttfx/testing Examples
 *
 * This file demonstrates the core testing macros available in @ttfx/testing.
 * These patterns were developed from dogfooding the macros in the ttfx test suite.
 *
 * Run with: npx vitest run examples/basic.ts
 */

import { describe, it } from "vitest";
import {
  assert,
  staticAssert,
  typeAssert,
  type Equal,
  type Extends,
} from "@ttfx/testing";

// ============================================================================
// assert() — Power Assertions with Sub-Expression Capture
// ============================================================================

describe("assert() — Power Assertions", () => {
  it("basic equality assertions", () => {
    const users = ["alice", "bob", "charlie"];
    const active = ["alice", "charlie"];

    // On failure, assert() captures ALL sub-expressions:
    //   assert(users.length === active.length)
    //
    //   Sub-expressions:
    //     users.length === active.length → false
    //     users.length → 3
    //     active.length → 2
    //     users → ["alice", "bob", "charlie"]
    //     active → ["alice", "charlie"]

    // This test will pass:
    assert(users.length > active.length);
  });

  it("object property assertions", () => {
    const user = { id: 1, name: "Alice", role: "admin" };

    assert(user.name === "Alice");
    assert(user.role !== "guest");
    assert(user.id > 0);
  });

  it("array assertions", () => {
    const items = [1, 2, 3, 4, 5];

    assert(items.length === 5);
    assert(items.includes(3));
    assert(items[0] === 1);
  });

  it("truthy assertions", () => {
    const config = { enabled: true, value: "test" };

    assert(config.enabled);
    assert(config.value !== undefined);
  });

  it("comparison assertions", () => {
    const score = 85;
    const threshold = 70;

    assert(score >= threshold);
    assert(score < 100);
  });
});

// ============================================================================
// staticAssert() — Compile-Time Assertions
// ============================================================================

describe("staticAssert() — Compile-Time Assertions", () => {
  // These assertions are checked at BUILD time, not runtime.
  // If they fail, the build fails with a clear error.

  it("compile-time constant checks", () => {
    // Basic math
    staticAssert(1 + 1 === 2, "basic math must work");
    staticAssert(10 > 5, "comparison must work");

    // No runtime cost — expands to void 0
  });

  it("configuration validation", () => {
    const CONFIG = {
      MAX_RETRIES: 3,
      TIMEOUT_MS: 5000,
      API_VERSION: "v2",
    } as const;

    // Validate config at compile time
    staticAssert(CONFIG.MAX_RETRIES > 0, "must have positive retries");
    staticAssert(CONFIG.TIMEOUT_MS <= 30000, "timeout must be reasonable");
  });
});

// ============================================================================
// typeAssert<>() — Type-Level Assertions
// ============================================================================

describe("typeAssert<>() — Type-Level Assertions", () => {
  // Check that types match at compile time

  it("exact type equality", () => {
    type UserId = number;
    type Score = number;

    // Both are number, so they're equal
    typeAssert<Equal<UserId, Score>>();
  });

  it("type extends relationship", () => {
    interface Animal {
      name: string;
    }

    interface Dog extends Animal {
      breed: string;
    }

    // Dog extends Animal
    typeAssert<Extends<Dog, Animal>>();
  });

  it("return type checking", () => {
    const add = (a: number, b: number): number => a + b;

    // Verify the return type
    typeAssert<Equal<ReturnType<typeof add>, number>>();
  });

  it("generic type checking", () => {
    const identity = <T>(x: T): T => x;

    // Call with number
    const result = identity(42);
    typeAssert<Equal<typeof result, number>>();
  });

  it("object shape checking", () => {
    interface Config {
      host: string;
      port: number;
      debug: boolean;
    }

    // Verify Config has expected shape
    typeAssert<Extends<Config, { host: string }>>();
    typeAssert<Extends<Config, { port: number }>>();
  });
});

// ============================================================================
// Combining Macros — Real-World Patterns
// ============================================================================

describe("Real-World Testing Patterns", () => {
  it("function contract testing", () => {
    // Define a function
    function divide(a: number, b: number): number {
      assert(b !== 0, "divisor cannot be zero");
      return a / b;
    }

    // Test the function
    assert(divide(10, 2) === 5);
    assert(divide(9, 3) === 3);

    // Type assertion for return type
    typeAssert<Equal<ReturnType<typeof divide>, number>>();
  });

  it("interface validation pattern", () => {
    interface User {
      id: number;
      name: string;
      email?: string;
    }

    // Runtime validation
    const user: User = { id: 1, name: "Alice" };

    assert(user.id > 0);
    assert(user.name.length > 0);

    // Type validation
    typeAssert<Extends<User, { id: number; name: string }>>();
  });

  it("macro presence testing", () => {
    // Pattern from dogfooding: testing that macros are registered

    const macros = {
      Eq: { name: "Eq", kind: "derive" as const },
      Ord: { name: "Ord", kind: "derive" as const },
    };

    // Runtime assertions
    assert(macros.Eq !== undefined);
    assert(macros.Eq.name === "Eq");
    assert(macros.Eq.kind === "derive");

    // Type assertions
    typeAssert<Equal<typeof macros.Eq.kind, "derive">>();
  });
});

/**
 * End-to-end integration tests for comprehension macros.
 *
 * Uses transformCode() to run the actual transformer on labeled block syntax
 * and verify the generated output.
 */

import { describe, it, expect } from "vitest";
import { transformCode } from "@typesugar/transformer";
import "@typesugar/std/macros";
import { globalRegistry } from "@typesugar/core";

function errorsOf(result: { diagnostics: { severity: string; message: string }[] }) {
  return result.diagnostics.filter((d) => d.severity === "error");
}

// ============================================================================
// Sanity: macros are registered
// ============================================================================

describe("comprehension macro registration", () => {
  it("let: and seq: are registered", () => {
    expect(globalRegistry.getLabeledBlock("let")).toBeDefined();
    expect(globalRegistry.getLabeledBlock("seq")).toBeDefined();
    expect(globalRegistry.getLabeledBlock("let")).toBe(globalRegistry.getLabeledBlock("seq"));
  });

  it("par: and all: are registered", () => {
    expect(globalRegistry.getLabeledBlock("par")).toBeDefined();
    expect(globalRegistry.getLabeledBlock("all")).toBeDefined();
    expect(globalRegistry.getLabeledBlock("par")).toBe(globalRegistry.getLabeledBlock("all"));
  });
});

// ============================================================================
// Sequential: let:/yield: and seq:/yield:
// ============================================================================

describe("let:/yield: transformation", () => {
  it("transforms single bind to map", () => {
    const result = transformCode(`let: { x << [1, 2, 3]; } yield: { x * 2 }`, {
      fileName: "let-single.ts",
    });
    expect(errorsOf(result)).toHaveLength(0);
    expect(result.changed).toBe(true);
    expect(result.code).toContain("map");
  });

  it("transforms multiple binds to flatMap chain", () => {
    const code = `
let: {
  x << [1, 2, 3];
  y << [x * 10, x * 20];
}
yield: { x + y }
    `.trim();
    const result = transformCode(code, { fileName: "let-multi.ts" });
    expect(errorsOf(result)).toHaveLength(0);
    expect(result.changed).toBe(true);
    expect(result.code).toContain("flatMap");
    expect(result.code).toContain("map");
  });

  it("seq: works identically to let:", () => {
    const code = `
seq: {
  x << [1, 2, 3];
  y << [x * 10];
}
yield: { x + y }
    `.trim();
    const result = transformCode(code, { fileName: "seq-alias.ts" });
    expect(errorsOf(result)).toHaveLength(0);
    expect(result.changed).toBe(true);
    expect(result.code).toContain("flatMap");
  });

  it("handles guard steps", () => {
    const code = `
let: {
  x << [1, 2, 3, 4, 5];
  if (x % 2 === 0) {}
}
yield: { x }
    `.trim();
    const result = transformCode(code, { fileName: "let-guard.ts" });
    expect(errorsOf(result)).toHaveLength(0);
    expect(result.changed).toBe(true);
  });

  it("handles pure map steps", () => {
    const code = `
let: {
  x << [1, 2, 3];
  doubled = x * 2;
}
yield: { doubled }
    `.trim();
    const result = transformCode(code, { fileName: "let-pure-map.ts" });
    expect(errorsOf(result)).toHaveLength(0);
    expect(result.changed).toBe(true);
  });

  it("let: without yield: uses implicit return", () => {
    const code = `
let: {
  x << [1, 2, 3];
  y << [x * 10];
}
    `.trim();
    const result = transformCode(code, { fileName: "let-no-yield.ts" });
    expect(errorsOf(result)).toHaveLength(0);
    expect(result.changed).toBe(true);
  });
});

// ============================================================================
// Parallel: par:/yield: and all:/yield:
// ============================================================================

describe("par:/yield: transformation", () => {
  it("transforms independent binds", () => {
    const code = `
declare function fetchA(): Promise<string>;
declare function fetchB(): Promise<number>;
par: {
  a << fetchA();
  b << fetchB();
}
yield: { a + b }
    `.trim();
    const result = transformCode(code, { fileName: "par-basic.ts" });
    expect(errorsOf(result)).toHaveLength(0);
    expect(result.changed).toBe(true);
    expect(result.code.includes("Promise.all") || result.code.includes(".ap(")).toBe(true);
  });

  it("all: works identically to par:", () => {
    const code = `
declare function fetchA(): Promise<string>;
declare function fetchB(): Promise<number>;
all: {
  a << fetchA();
  b << fetchB();
}
yield: { a + b }
    `.trim();
    const result = transformCode(code, { fileName: "all-alias.ts" });
    expect(errorsOf(result)).toHaveLength(0);
    expect(result.changed).toBe(true);
    expect(result.code.includes("Promise.all") || result.code.includes(".ap(")).toBe(true);
  });

  it("rejects dependent bindings", () => {
    const code = `
declare function fetchUser(): Promise<{ id: number }>;
declare function fetchPosts(userId: number): Promise<string[]>;
par: {
  user << fetchUser();
  posts << fetchPosts(user.id);
}
yield: { user }
    `.trim();
    const result = transformCode(code, { fileName: "par-dependent.ts" });
    expect(errorsOf(result).length).toBeGreaterThan(0);
    expect(errorsOf(result).some((e) => e.message.includes("independent"))).toBe(true);
  });
});

// ============================================================================
// Nested parallel blocks: par:/all: inside seq:/let:
// ============================================================================

describe("nested par: inside seq:", () => {
  it("generates Promise.all inside sequential chain", () => {
    const code = `
declare function loadConfig(): Promise<{ url: string }>;
declare function fetchUsers(c: { url: string }): Promise<string[]>;
declare function fetchProducts(c: { url: string }): Promise<number[]>;
seq: {
  config << loadConfig();
  par: {
    users << fetchUsers(config);
    products << fetchProducts(config);
  }
}
yield: { config }
    `.trim();
    const result = transformCode(code, { fileName: "nested-par.ts" });
    expect(errorsOf(result)).toHaveLength(0);
    expect(result.changed).toBe(true);
    expect(result.code).toContain("Promise.all");
  });

  it("handles multiple nested par: groups", () => {
    const code = `
declare function loadConfig(): Promise<number>;
declare function fetchA(x: number): Promise<number>;
declare function fetchB(x: number): Promise<number>;
declare function fetchC(x: number): Promise<number>;
declare function fetchD(x: number): Promise<number>;
seq: {
  config << loadConfig();
  par: {
    a << fetchA(config);
    b << fetchB(config);
  }
  par: {
    c << fetchC(a);
    d << fetchD(b);
  }
}
yield: { a + b + c + d }
    `.trim();
    const result = transformCode(code, { fileName: "nested-par-multi.ts" });
    expect(errorsOf(result)).toHaveLength(0);
    expect(result.changed).toBe(true);
    expect((result.code.match(/Promise\.all/g) || []).length).toBe(2);
  });

  it("nested all: inside let: works (mixed aliases)", () => {
    const code = `
declare function loadConfig(): Promise<{ url: string }>;
declare function fetchUsers(c: { url: string }): Promise<string[]>;
declare function fetchProducts(c: { url: string }): Promise<number[]>;
let: {
  config << loadConfig();
  all: {
    users << fetchUsers(config);
    products << fetchProducts(config);
  }
}
yield: { config }
    `.trim();
    const result = transformCode(code, { fileName: "nested-all-let.ts" });
    expect(errorsOf(result)).toHaveLength(0);
    expect(result.changed).toBe(true);
    expect(result.code).toContain("Promise.all");
  });
});

// ============================================================================
// Error cases
// ============================================================================

describe("comprehension error reporting", () => {
  it("errors on empty let: block", () => {
    const result = transformCode(`let: {} yield: { 42 }`, { fileName: "empty-let.ts" });
    expect(errorsOf(result).length).toBeGreaterThan(0);
  });

  it("errors on empty par: block", () => {
    const result = transformCode(`par: {} yield: { 42 }`, { fileName: "empty-par.ts" });
    expect(errorsOf(result).length).toBeGreaterThan(0);
  });

  it("errors on par: without yield:", () => {
    const code = `
declare function fetchA(): Promise<string>;
par: { a << fetchA(); }
    `.trim();
    const result = transformCode(code, { fileName: "par-no-yield.ts" });
    expect(errorsOf(result).length).toBeGreaterThan(0);
  });
});

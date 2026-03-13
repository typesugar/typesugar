/**
 * Passthrough tests for oxc-engine
 *
 * Verifies that the transform function correctly parses and regenerates code.
 * Note: Wave 1 passthrough preserves TypeScript syntax - type stripping happens
 * after macro expansion in later waves.
 */

import { describe, test, expect } from "vitest";

// Import the native binding directly
const oxcEngine = require("../oxc-engine.darwin-arm64.node");

describe("oxc-engine passthrough", () => {
  test("simple const roundtrip", () => {
    const source = `const x: number = 42;`;
    const result = oxcEngine.transform(source, "test.ts", {});

    expect(result.diagnostics).toHaveLength(0);
    expect(result.code).toContain("const x");
    expect(result.code).toContain("42");
  });

  test("function roundtrip", () => {
    const source = `
function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
`;
    const result = oxcEngine.transform(source, "test.ts", {});

    expect(result.diagnostics).toHaveLength(0);
    expect(result.code).toContain("function greet");
    expect(result.code).toContain("return");
  });

  test("interface roundtrip", () => {
    const source = `
interface Person {
  name: string;
  age: number;
}
`;
    const result = oxcEngine.transform(source, "test.ts", {});

    expect(result.diagnostics).toHaveLength(0);
    // In passthrough mode, interface is preserved
    expect(result.code).toContain("interface Person");
  });

  test("class roundtrip", () => {
    const source = `
interface Greeter {
  greet(): string;
}

class FormalGreeter implements Greeter {
  greet(): string {
    return "Good day!";
  }
}
`;
    const result = oxcEngine.transform(source, "test.ts", {});

    expect(result.diagnostics).toHaveLength(0);
    expect(result.code).toContain("class FormalGreeter");
    expect(result.code).toContain("greet()");
  });

  test("preprocessed .sts with __binop__ parses correctly", () => {
    const source = `
const result = __binop__(__binop__(1, "|>", double), "|>", square);
const list = __binop__(1, "::", __binop__(2, "::", __binop__(3, "::", [])));
`;
    const result = oxcEngine.transform(source, "preprocessed.ts", {});

    expect(result.diagnostics).toHaveLength(0);
    expect(result.code).toContain("__binop__");
    expect(result.code).toContain('"|>"');
    expect(result.code).toContain('"::"');
  });

  test("preprocessed .sts with Kind type parses correctly", () => {
    const source = `
type Kind<F, A> = { _F: F; _A: A };
const mapped: Kind<F, B> = map(fa)(f);
`;
    const result = oxcEngine.transform(source, "hkt.ts", {});

    expect(result.diagnostics).toHaveLength(0);
    // In passthrough mode, type alias is preserved (stripping happens in macro phase)
    expect(result.code).toContain("type Kind");
    // Runtime code should remain
    expect(result.code).toContain("const mapped");
    expect(result.code).toContain("map(fa)(f)");
  });

  test("reports parse errors correctly", () => {
    const source = `const x: = ;`; // Invalid syntax
    const result = oxcEngine.transform(source, "invalid.ts", {});

    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].severity).toBe("error");
  });

  test("source map generation when enabled", () => {
    const source = `const x: number = 42;`;
    // napi-rs converts snake_case to camelCase
    const result = oxcEngine.transform(source, "test.ts", { sourceMap: true });

    expect(result.diagnostics).toHaveLength(0);
    expect(result.map).toBeDefined();
    expect(result.map).not.toBeNull();

    // Verify it's valid JSON
    const map = JSON.parse(result.map!);
    expect(map.version).toBe(3);
    expect(map.sources).toContain("test.ts");
  });
});

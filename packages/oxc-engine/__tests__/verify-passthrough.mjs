/**
 * Quick verification of oxc-engine passthrough
 */

import { createRequire } from "module";
const require = createRequire(import.meta.url);

// Import the native binding directly
const oxcEngine = require("../oxc-engine.darwin-arm64.node");

// Note: Wave 1 passthrough preserves TypeScript syntax - type stripping happens
// after macro expansion in later waves. These tests verify parse-codegen roundtrip.
const tests = [
  {
    name: "Simple const roundtrip",
    source: `const x: number = 42;`,
    check: (result) => {
      if (result.diagnostics.length > 0) throw new Error("Unexpected diagnostics");
      if (!result.code.includes("const x")) throw new Error("Missing const x");
      if (!result.code.includes("42")) throw new Error("Missing 42");
    },
  },
  {
    name: "Function roundtrip",
    source: `function greet(name: string): string { return \`Hello, \${name}!\`; }`,
    check: (result) => {
      if (result.diagnostics.length > 0) throw new Error("Unexpected diagnostics");
      if (!result.code.includes("function greet")) throw new Error("Missing function");
    },
  },
  {
    name: "Interface roundtrip",
    source: `interface Person { name: string; age: number; }`,
    check: (result) => {
      if (result.diagnostics.length > 0) throw new Error("Unexpected diagnostics");
      if (!result.code.includes("interface Person"))
        throw new Error("Interface should be preserved in passthrough");
    },
  },
  {
    name: "__binop__ parses correctly",
    source: `const result = __binop__(__binop__(1, "|>", double), "|>", square);`,
    check: (result) => {
      if (result.diagnostics.length > 0)
        throw new Error("Unexpected diagnostics: " + JSON.stringify(result.diagnostics));
      if (!result.code.includes("__binop__")) throw new Error("Missing __binop__");
    },
  },
  {
    name: "Parse errors are reported",
    source: `const x: = ;`,
    check: (result) => {
      if (result.diagnostics.length === 0) throw new Error("Expected parse errors");
      if (result.diagnostics[0].severity !== "error") throw new Error("Expected error severity");
    },
  },
  {
    name: "Source map generation",
    source: `const x: number = 42;`,
    options: { sourceMap: true },
    check: (result) => {
      if (result.diagnostics.length > 0) throw new Error("Unexpected diagnostics");
      if (!result.map) throw new Error("Expected source map");
      const map = JSON.parse(result.map);
      if (map.version !== 3) throw new Error("Expected source map version 3");
      if (!map.sources.includes("test.ts")) throw new Error("Expected test.ts in sources");
    },
  },
];

console.log("Verifying oxc-engine passthrough...\n");

let passed = 0;
let failed = 0;

for (const test of tests) {
  try {
    const result = oxcEngine.transform(test.source, "test.ts", test.options || {});
    test.check(result);
    console.log(`✓ ${test.name}`);
    passed++;
  } catch (error) {
    console.log(`✗ ${test.name}`);
    console.log(`  ${error.message}`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}

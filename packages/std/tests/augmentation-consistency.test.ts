/**
 * Global Augmentation ↔ Extension Implementation Consistency (PEP-012 Wave 8)
 *
 * Validates that every method declared in global-augmentations.ts has a
 * corresponding exported function in the extension module for that type.
 * This catches drift when extension functions are added/renamed but the
 * augmentation file isn't updated, or vice versa.
 *
 * Uses file parsing (not runtime imports) to avoid issues with the
 * "use extension" directive and .js path mappings in test context.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const EXTENSIONS_DIR = path.resolve(__dirname, "../src/extensions");

/**
 * Parse global-augmentations.ts and extract method names per interface block.
 */
function parseAugmentedMethods(): Map<string, Set<string>> {
  const source = fs.readFileSync(path.join(EXTENSIONS_DIR, "global-augmentations.ts"), "utf-8");
  const result = new Map<string, Set<string>>();

  let currentInterface: string | null = null;
  let braceDepth = 0;
  let inDeclareGlobal = false;

  for (const line of source.split("\n")) {
    const trimmed = line.trim();

    if (trimmed === "declare global {") {
      inDeclareGlobal = true;
      continue;
    }
    if (!inDeclareGlobal) continue;

    const ifaceMatch = trimmed.match(/^interface\s+(\w+)(?:<[^>]+>)?\s*\{$/);
    if (ifaceMatch) {
      currentInterface = ifaceMatch[1];
      braceDepth = 1;
      result.set(currentInterface, new Set());
      continue;
    }

    if (currentInterface) {
      for (const ch of trimmed) {
        if (ch === "{") braceDepth++;
        if (ch === "}") braceDepth--;
      }

      const methodMatch = trimmed.match(/^(\w+)(?:<[^>]*>)?\s*\(/);
      if (methodMatch && !trimmed.startsWith("//")) {
        result.get(currentInterface)!.add(methodMatch[1]);
      }

      if (braceDepth === 0) {
        currentInterface = null;
      }
    }
  }

  return result;
}

/**
 * Parse a TypeScript source file and extract exported function names.
 * Matches both `export function name(` and `export async function name(`.
 */
function parseExportedFunctions(filePath: string): Set<string> {
  const source = fs.readFileSync(filePath, "utf-8");
  const result = new Set<string>();

  for (const line of source.split("\n")) {
    const match = line.match(/^export\s+(?:async\s+)?function\*?\s+(\w+)/);
    if (match) {
      result.add(match[1]);
    }
  }

  return result;
}

const INTERFACE_TO_FILE: Record<string, string> = {
  Number: "number.ts",
  String: "string.ts",
  Array: "array.ts",
  Boolean: "boolean.ts",
  Date: "date.ts",
  Map: "map.ts",
  Promise: "promise.ts",
};

describe("global augmentation consistency", () => {
  const augmented = parseAugmentedMethods();

  it("should parse augmentation declarations for all expected interfaces", () => {
    for (const iface of Object.keys(INTERFACE_TO_FILE)) {
      expect(augmented.has(iface), `missing interface: ${iface}`).toBe(true);
      expect(augmented.get(iface)!.size, `${iface} has no methods`).toBeGreaterThan(0);
    }
  });

  for (const [iface, file] of Object.entries(INTERFACE_TO_FILE)) {
    it(`all ${iface} augmentation methods have extension implementations`, () => {
      const methods = augmented.get(iface)!;
      const exports = parseExportedFunctions(path.join(EXTENSIONS_DIR, file));
      const missing = [...methods].filter((m) => !exports.has(m));
      expect(
        missing,
        `${iface} augmentation declares methods not found in ${file}: ${missing.join(", ")}`
      ).toEqual([]);
    });
  }
});

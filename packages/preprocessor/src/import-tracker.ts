/**
 * Import Tracker for HKT Resolution
 *
 * Scans source files for imports from typesugar packages to verify that
 * HKT symbols ($, Kind, OptionF, etc.) are actually from typesugar and not
 * user-defined or from other packages (like jQuery's $).
 *
 * This ensures the preprocessor only resolves HKT types when it's safe to do so.
 */

import {
  HKT_OPERATOR_PACKAGES,
  HKT_TYPE_FUNCTIONS,
  isHKTOperatorPackage,
  isExportedFrom,
  type HKTTypeFunction,
} from "./hkt-registry.js";

// Re-export for convenience
export { HKT_OPERATOR_PACKAGES, HKT_TYPE_FUNCTIONS, type HKTTypeFunction };

/**
 * Information about a tracked type function.
 */
export interface TrackedTypeFunction {
  /** The concrete type name (e.g., "Option") */
  concrete: string;
  /** Local name of the concrete type if also imported (e.g., "Opt" for "import { Option as Opt }") */
  localConcrete: string | null;
  /** Whether this type function takes additional type parameters (e.g., EitherF<E>) */
  isParameterized: boolean;
  /** Number of fixed type parameters (for parameterized type functions) */
  fixedParamCount: number;
}

/**
 * Result of scanning imports for typesugar HKT symbols.
 */
export interface TrackedImports {
  /** The local name for $ or Kind, if imported from a typesugar package */
  hktOperator: string | null;
  /** Map of local type function name → type function info */
  typeFunctions: Map<string, TrackedTypeFunction>;
  /** Map of concrete type local name → original name (for aliased imports) */
  concreteTypes: Map<string, string>;
}

/**
 * Scan source code for imports and return tracked typesugar HKT symbols.
 *
 * This function parses import statements to identify:
 * 1. Whether $ or Kind is imported from a typesugar package
 * 2. Which HKT type functions (OptionF, EitherF, etc.) are imported
 * 3. Which concrete types (Option, Either, etc.) are imported
 *
 * @param source - The source code to scan
 * @returns Tracked imports information
 */
export function scanImports(source: string): TrackedImports {
  const result: TrackedImports = {
    hktOperator: null,
    typeFunctions: new Map(),
    concreteTypes: new Map(),
  };

  // Match import statements with named imports
  // Handles:
  //   import { $, OptionF } from "@typesugar/fp"
  //   import { $ as Kind } from "@typesugar/type-system"
  //   import type { $ } from "@typesugar/fp"
  //   import { $, type OptionF } from "@typesugar/fp"
  const importRegex = /import\s+(?:type\s+)?{([^}]+)}\s+from\s+["']([^"']+)["']/g;

  let match;
  while ((match = importRegex.exec(source)) !== null) {
    const [, imports, packageName] = match;

    // Skip non-typesugar packages
    if (!isHKTOperatorPackage(packageName)) {
      continue;
    }

    // Parse individual imports (handles "type X" inline type imports)
    const importList = imports
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    for (const importSpec of importList) {
      // Remove inline "type " prefix if present
      const cleanSpec = importSpec.replace(/^type\s+/, "");

      // Handle aliased imports: "$ as Kind" or "OptionF as OF"
      const aliasMatch = cleanSpec.match(/^(\$|\w+)\s+as\s+(\w+)$/);
      const originalName = aliasMatch ? aliasMatch[1] : cleanSpec;
      const localName = aliasMatch ? aliasMatch[2] : cleanSpec;

      // Check if this is the $ or Kind type
      if (originalName === "$" || originalName === "Kind") {
        result.hktOperator = localName;
      }

      // Check if this is a known HKT type function
      if (isExportedFrom(originalName, packageName)) {
        const hktInfo = HKT_TYPE_FUNCTIONS[originalName];
        result.typeFunctions.set(localName, {
          concrete: hktInfo.concrete,
          localConcrete: null,
          isParameterized: hktInfo.isParameterized ?? false,
          fixedParamCount: hktInfo.fixedParamCount ?? 0,
        });
      }

      // Track concrete type imports (Option, Either, etc.)
      // This helps us use the correct local name when resolving
      for (const [, tfInfo] of Object.entries(HKT_TYPE_FUNCTIONS)) {
        if (originalName === tfInfo.concrete) {
          result.concreteTypes.set(localName, originalName);

          // Link to any matching type function that was already tracked
          for (const [, info] of result.typeFunctions) {
            if (info.concrete === originalName && info.localConcrete === null) {
              info.localConcrete = localName;
            }
          }
        }
      }
    }
  }

  // Second pass: link concrete types to type functions that were imported after them
  for (const [localConcrete, originalConcrete] of result.concreteTypes) {
    for (const [, info] of result.typeFunctions) {
      if (info.concrete === originalConcrete && info.localConcrete === null) {
        info.localConcrete = localConcrete;
      }
    }
  }

  return result;
}

// Re-export registry functions for convenience
export {
  isKnownTypeFunction,
  getTypeFunction,
  getConcreteType,
  isExportedFrom,
} from "./hkt-registry.js";

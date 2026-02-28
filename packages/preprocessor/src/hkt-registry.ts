/**
 * HKT Type Function Registry
 *
 * This module provides the authoritative registry of known HKT type functions
 * from typesugar packages. Only type functions listed here will be resolved
 * by the preprocessor.
 *
 * The registry maps type function names (e.g., "OptionF") to their concrete
 * types (e.g., "Option") and the packages that export them.
 */

/**
 * Packages that export the $ or Kind type for HKT application.
 */
export const HKT_OPERATOR_PACKAGES = new Set([
  "@typesugar/type-system",
  "@typesugar/fp",
  "@typesugar/std",
  "typesugar",
]);

/**
 * Information about a known HKT type function export.
 */
export interface HKTTypeFunction {
  /** The concrete type this resolves to (e.g., "Option" for "OptionF") */
  concrete: string;
  /** Packages that export this type function */
  packages: string[];
  /** Whether this type function takes additional type parameters (e.g., EitherF<E>) */
  isParameterized?: boolean;
  /** Number of fixed type parameters (for parameterized type functions) */
  fixedParamCount?: number;
}

/**
 * Known HKT type functions and their metadata.
 *
 * This is the authoritative registry - only type functions listed here
 * will be resolved by the preprocessor. User-defined type functions
 * will NOT be resolved (they're not in this registry).
 */
export const HKT_TYPE_FUNCTIONS: Record<string, HKTTypeFunction> = {
  // ============================================================================
  // From @typesugar/type-system (built-in TypeScript types)
  // ============================================================================
  ArrayF: {
    concrete: "Array",
    packages: ["@typesugar/type-system", "@typesugar/fp"],
  },
  PromiseF: {
    concrete: "Promise",
    packages: ["@typesugar/type-system", "@typesugar/fp"],
  },
  SetF: {
    concrete: "Set",
    packages: ["@typesugar/type-system"],
  },
  MapF: {
    concrete: "Map",
    packages: ["@typesugar/type-system"],
    isParameterized: true,
    fixedParamCount: 1,
  },
  ReadonlyArrayF: {
    concrete: "ReadonlyArray",
    packages: ["@typesugar/type-system"],
  },

  // ============================================================================
  // From @typesugar/fp (FP data types)
  // ============================================================================
  OptionF: {
    concrete: "Option",
    packages: ["@typesugar/fp"],
  },
  EitherF: {
    concrete: "Either",
    packages: ["@typesugar/fp"],
    isParameterized: true,
    fixedParamCount: 1,
  },
  ListF: {
    concrete: "List",
    packages: ["@typesugar/fp"],
  },
  NonEmptyListF: {
    concrete: "NonEmptyList",
    packages: ["@typesugar/fp"],
  },
  ValidatedF: {
    concrete: "Validated",
    packages: ["@typesugar/fp"],
    isParameterized: true,
    fixedParamCount: 1,
  },
  StateF: {
    concrete: "State",
    packages: ["@typesugar/fp"],
    isParameterized: true,
    fixedParamCount: 1,
  },
  ReaderF: {
    concrete: "Reader",
    packages: ["@typesugar/fp"],
    isParameterized: true,
    fixedParamCount: 1,
  },
  WriterF: {
    concrete: "Writer",
    packages: ["@typesugar/fp"],
    isParameterized: true,
    fixedParamCount: 1,
  },
  IOF: {
    concrete: "IO",
    packages: ["@typesugar/fp"],
  },
  IdF: {
    concrete: "Id",
    packages: ["@typesugar/fp"],
  },
  ResourceF: {
    concrete: "Resource",
    packages: ["@typesugar/fp"],
  },
};

/**
 * Check if a name is a known HKT type function.
 *
 * @param name - The type function name to check (e.g., "OptionF")
 * @returns true if this is a known HKT type function
 */
export function isKnownTypeFunction(name: string): boolean {
  return name in HKT_TYPE_FUNCTIONS;
}

/**
 * Get the HKT type function info for a known type function.
 *
 * @param name - The type function name (e.g., "OptionF")
 * @returns The type function info or undefined if not found
 */
export function getTypeFunction(name: string): HKTTypeFunction | undefined {
  return HKT_TYPE_FUNCTIONS[name];
}

/**
 * Get the concrete type for a known HKT type function.
 *
 * @param name - The type function name (e.g., "OptionF")
 * @returns The concrete type name (e.g., "Option") or null if not found
 */
export function getConcreteType(name: string): string | null {
  return HKT_TYPE_FUNCTIONS[name]?.concrete ?? null;
}

/**
 * Check if a package exports the $ or Kind type.
 *
 * @param packageName - The package name to check
 * @returns true if the package exports HKT operators
 */
export function isHKTOperatorPackage(packageName: string): boolean {
  return HKT_OPERATOR_PACKAGES.has(packageName) || packageName.startsWith("@typesugar/");
}

/**
 * Check if a type function is exported from a specific package.
 *
 * @param typeFunctionName - The type function name (e.g., "OptionF")
 * @param packageName - The package name to check
 * @returns true if the package exports this type function
 */
export function isExportedFrom(typeFunctionName: string, packageName: string): boolean {
  const tf = HKT_TYPE_FUNCTIONS[typeFunctionName];
  if (!tf) return false;

  return tf.packages.some((p) => packageName === p || packageName.startsWith(`${p}/`));
}

/**
 * Get all type functions exported from a specific package.
 *
 * @param packageName - The package name
 * @returns Array of type function names exported from the package
 */
export function getTypeFunctionsFromPackage(packageName: string): string[] {
  const result: string[] = [];

  for (const [name, tf] of Object.entries(HKT_TYPE_FUNCTIONS)) {
    if (tf.packages.some((p) => packageName === p || packageName.startsWith(`${p}/`))) {
      result.push(name);
    }
  }

  return result;
}

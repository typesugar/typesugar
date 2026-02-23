/**
 * Lazy Macro Package Loader
 *
 * Scans a ts.Program's import graph to discover which macro packages are
 * needed, then loads them on demand via sync require(). This replaces
 * eager side-effect imports that previously caused dependency cycles.
 *
 * Local macros (inside @typesugar/macros) still use eager side-effect
 * registration — they're internal and don't create cross-package cycles.
 * External macro packages (@typesugar/mapper, @typesugar/contracts, and
 * future third-party packages) are loaded here.
 */

import { createRequire } from "module";
import * as ts from "typescript";
import { globalRegistry, type MacroDefinition } from "@typesugar/core";

const _require = createRequire(import.meta.url);

/**
 * Tracks which packages have already been loaded in this process.
 * Prevents redundant require() calls across multiple transformer
 * factory invocations (e.g., in watch mode).
 */
const loadedPackages = new Set<string>();

/**
 * Facade packages that re-export from @typesugar/macros.
 * When an import from one of these is found, we load @typesugar/macros
 * (which contains the actual macro implementations) instead.
 */
const FACADE_TO_PROVIDER: Record<string, string> = {
  "@typesugar/comptime": "@typesugar/macros",
  "@typesugar/derive": "@typesugar/macros",
  "@typesugar/reflect": "@typesugar/macros",
  "@typesugar/operators": "@typesugar/macros",
  "@typesugar/typeclass": "@typesugar/macros",
  "@typesugar/specialize": "@typesugar/macros",
  typesugar: "@typesugar/macros",
};

/**
 * Packages known to export macros. When an import from one of these is
 * detected in the program, we require() it to trigger registration.
 */
const KNOWN_MACRO_PACKAGES = new Set([
  "@typesugar/macros",
  "@typesugar/mapper",
  "@typesugar/contracts",
  ...Object.keys(FACADE_TO_PROVIDER),
]);

/**
 * Scan a program's source files for imports from macro packages,
 * then lazily load those packages to register their macros.
 *
 * Called once per macroTransformerFactory() invocation (once per program).
 * Must be called before the visitor pass begins.
 */
export function loadMacroPackages(program: ts.Program, verbose?: boolean): void {
  const importedModules = collectImportedModules(program);

  const toLoad = new Set<string>();

  for (const mod of importedModules) {
    // Map facade packages to their actual provider
    const provider = FACADE_TO_PROVIDER[mod];
    if (provider) {
      toLoad.add(provider);
      continue;
    }

    // Known macro packages
    if (KNOWN_MACRO_PACKAGES.has(mod)) {
      toLoad.add(mod);
      continue;
    }

    // Unknown @typesugar/* packages — speculatively try loading.
    // If the package exports macros (via __typesugar_macros__ or
    // side-effect registration), they'll be picked up.
    if (mod.startsWith("@typesugar/")) {
      toLoad.add(mod);
    }
  }

  // Always load @typesugar/std first if ANY @typesugar/* package is used.
  // This ensures core typeclass definitions (Numeric, Eq, Ord, etc.) and their
  // Op<> syntax mappings are registered before domain-specific instances.
  const hasTypesugarImport = [...toLoad].some((pkg) => pkg.startsWith("@typesugar/"));
  if (hasTypesugarImport) {
    loadPackage("@typesugar/std", verbose);
  }

  for (const pkg of toLoad) {
    loadPackage(pkg, verbose);
  }
}

/**
 * Force-load a specific macro package by name.
 * Useful for programmatic use or testing.
 */
export function loadMacroPackage(packageName: string, verbose?: boolean): boolean {
  return loadPackage(packageName, verbose);
}

/**
 * Load macro packages based on imports in a single source file.
 * Called per-file during transformation to ensure packages are loaded
 * even when the initial program doesn't include all files.
 */
export function loadMacroPackagesFromFile(sourceFile: ts.SourceFile, verbose?: boolean): void {
  const toLoad = new Set<string>();

  for (const stmt of sourceFile.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const mod = stmt.moduleSpecifier.text;
      if (!mod.startsWith(".") && !mod.startsWith("/")) {
        const basePkg = getBasePackageName(mod);
        if (basePkg) {
          // Map facade packages to their actual provider
          const provider = FACADE_TO_PROVIDER[basePkg];
          if (provider) {
            toLoad.add(provider);
          } else if (KNOWN_MACRO_PACKAGES.has(basePkg) || basePkg.startsWith("@typesugar/")) {
            toLoad.add(basePkg);
          }
        }
      }
    }
  }

  // Always load @typesugar/std first if ANY @typesugar/* package is used
  const hasTypesugarImport = [...toLoad].some((pkg) => pkg.startsWith("@typesugar/"));
  if (hasTypesugarImport) {
    loadPackage("@typesugar/std", verbose);
  }

  for (const pkg of toLoad) {
    loadPackage(pkg, verbose);
  }
}

/**
 * Reset the loaded-packages tracker. For testing only.
 */
export function resetLoadedPackages(): void {
  loadedPackages.clear();
}

function loadPackage(pkg: string, verbose?: boolean): boolean {
  if (loadedPackages.has(pkg)) return true;

  try {
    const loaded = _require(pkg);
    loadedPackages.add(pkg);

    // Convention: __typesugar_macros__ exports an array of MacroDefinition
    // objects that should be registered. This is the preferred pattern for
    // third-party macro packages.
    if (Array.isArray(loaded.__typesugar_macros__)) {
      for (const macro of loaded.__typesugar_macros__) {
        if (isMacroDefinition(macro)) {
          globalRegistry.register(macro);
        }
      }
      if (verbose) {
        console.log(
          `[typesugar] Loaded ${loaded.__typesugar_macros__.length} macros from ${pkg} (convention)`
        );
      }
      return true;
    }

    // Side-effect registration: many packages register macros as a side
    // effect of being imported (via globalRegistry.register() calls at
    // module scope). The require() above already triggered this.
    if (verbose) {
      console.log(`[typesugar] Loaded macro package: ${pkg}`);
    }
    return true;
  } catch (e) {
    // Package not installed or failed to load — not an error for
    // speculative loads of @typesugar/* packages.
    if (verbose) {
      console.log(`[typesugar] Could not load macro package ${pkg}: ${e}`);
    }
    return false;
  }
}

function isMacroDefinition(value: unknown): value is MacroDefinition {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    ("name" in value || "label" in value)
  );
}

/**
 * Collect all non-relative module specifiers imported across the program.
 * Only scans user source files (skips node_modules and .d.ts files).
 */
function collectImportedModules(program: ts.Program): Set<string> {
  const modules = new Set<string>();

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.fileName.includes("node_modules")) continue;
    if (sourceFile.isDeclarationFile) continue;

    for (const stmt of sourceFile.statements) {
      if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
        const mod = stmt.moduleSpecifier.text;
        if (!mod.startsWith(".") && !mod.startsWith("/")) {
          const basePkg = getBasePackageName(mod);
          if (basePkg) modules.add(basePkg);
        }
      }

      // Also check re-exports: export { foo } from "pkg"
      if (
        ts.isExportDeclaration(stmt) &&
        stmt.moduleSpecifier &&
        ts.isStringLiteral(stmt.moduleSpecifier)
      ) {
        const mod = stmt.moduleSpecifier.text;
        if (!mod.startsWith(".") && !mod.startsWith("/")) {
          const basePkg = getBasePackageName(mod);
          if (basePkg) modules.add(basePkg);
        }
      }
    }
  }

  return modules;
}

/**
 * Extract the base package name from a module specifier.
 * Strips subpath imports: "@scope/name/sub" → "@scope/name", "name/sub" → "name"
 */
function getBasePackageName(moduleSpecifier: string): string {
  if (moduleSpecifier.startsWith("@")) {
    const parts = moduleSpecifier.split("/");
    return parts.slice(0, 2).join("/");
  }
  return moduleSpecifier.split("/")[0];
}

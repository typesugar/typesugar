/**
 * Import Suggestion System
 *
 * Builds an index of exports from typesugar packages and provides
 * "Did you mean to import...?" suggestions when symbols are used but not imported.
 */

import * as ts from "typescript";

/**
 * Represents a single exportable symbol.
 */
export interface ExportedSymbol {
  /** The symbol name as exported */
  name: string;
  /** The module path this symbol is exported from (e.g., "@typesugar/fp") */
  module: string;
  /** Kind of export: typeclass, instance, extension, macro, type, function, etc. */
  kind: ExportKind;
  /** Whether this is a re-export from another module */
  isReexport: boolean;
  /** Original module if this is a re-export */
  originalModule?: string;
  /** Description for documentation */
  description?: string;
}

export type ExportKind =
  | "typeclass"
  | "instance"
  | "extension"
  | "extension-method"
  | "macro"
  | "type"
  | "function"
  | "value"
  | "derive";

/**
 * Static registry of known typesugar exports.
 * This is populated at compile time or via manifest discovery.
 */
export interface ModuleExportIndex {
  /** Map from symbol name to all modules that export it */
  byName: Map<string, ExportedSymbol[]>;
  /** Map from module to all exports */
  byModule: Map<string, ExportedSymbol[]>;
  /** Map from typeclass name to its source module */
  typeclassToModule: Map<string, string>;
  /** Map from extension method name to source modules */
  extensionToModule: Map<string, string[]>;
  /** Map from macro name to source module */
  macroToModule: Map<string, string>;
}

/**
 * Creates an empty module export index.
 */
export function createModuleExportIndex(): ModuleExportIndex {
  return {
    byName: new Map(),
    byModule: new Map(),
    typeclassToModule: new Map(),
    extensionToModule: new Map(),
    macroToModule: new Map(),
  };
}

/**
 * Default export index populated with known typesugar exports.
 */
const defaultExports: ExportedSymbol[] = [
  // Core typeclasses from @typesugar/std
  {
    name: "Eq",
    module: "@typesugar/std",
    kind: "typeclass",
    isReexport: false,
    description: "Equality comparison",
  },
  {
    name: "Ord",
    module: "@typesugar/std",
    kind: "typeclass",
    isReexport: false,
    description: "Ordering comparison",
  },
  {
    name: "Show",
    module: "@typesugar/std",
    kind: "typeclass",
    isReexport: false,
    description: "String representation",
  },
  {
    name: "Clone",
    module: "@typesugar/std",
    kind: "typeclass",
    isReexport: false,
    description: "Deep cloning",
  },
  {
    name: "Debug",
    module: "@typesugar/std",
    kind: "typeclass",
    isReexport: false,
    description: "Debug output",
  },
  {
    name: "Hash",
    module: "@typesugar/std",
    kind: "typeclass",
    isReexport: false,
    description: "Hash code generation",
  },
  {
    name: "Default",
    module: "@typesugar/std",
    kind: "typeclass",
    isReexport: false,
    description: "Default value construction",
  },
  {
    name: "Semigroup",
    module: "@typesugar/std",
    kind: "typeclass",
    isReexport: false,
    description: "Associative binary operation",
  },
  {
    name: "Monoid",
    module: "@typesugar/std",
    kind: "typeclass",
    isReexport: false,
    description: "Semigroup with identity",
  },
  {
    name: "FlatMap",
    module: "@typesugar/std",
    kind: "typeclass",
    isReexport: false,
    description: "Monadic bind operation",
  },

  // FP typeclasses from @typesugar/fp
  {
    name: "Functor",
    module: "@typesugar/fp",
    kind: "typeclass",
    isReexport: false,
    description: "Mappable container",
  },
  {
    name: "Applicative",
    module: "@typesugar/fp",
    kind: "typeclass",
    isReexport: false,
    description: "Functor with application",
  },
  {
    name: "Monad",
    module: "@typesugar/fp",
    kind: "typeclass",
    isReexport: false,
    description: "Sequential computation",
  },
  {
    name: "Foldable",
    module: "@typesugar/fp",
    kind: "typeclass",
    isReexport: false,
    description: "Reducible container",
  },
  {
    name: "Traversable",
    module: "@typesugar/fp",
    kind: "typeclass",
    isReexport: false,
    description: "Traversable container",
  },

  // FP data types from @typesugar/fp
  {
    name: "Option",
    module: "@typesugar/fp",
    kind: "type",
    isReexport: false,
    description: "Optional value",
  },
  {
    name: "Some",
    module: "@typesugar/fp",
    kind: "function",
    isReexport: false,
    description: "Construct Some value",
  },
  {
    name: "None",
    module: "@typesugar/fp",
    kind: "value",
    isReexport: false,
    description: "None value",
  },
  {
    name: "Either",
    module: "@typesugar/fp",
    kind: "type",
    isReexport: false,
    description: "Either Left or Right",
  },
  {
    name: "Left",
    module: "@typesugar/fp",
    kind: "function",
    isReexport: false,
    description: "Construct Left value",
  },
  {
    name: "Right",
    module: "@typesugar/fp",
    kind: "function",
    isReexport: false,
    description: "Construct Right value",
  },
  {
    name: "Result",
    module: "@typesugar/fp",
    kind: "type",
    isReexport: false,
    description: "Success or failure",
  },
  {
    name: "Ok",
    module: "@typesugar/fp",
    kind: "function",
    isReexport: false,
    description: "Construct Ok value",
  },
  {
    name: "Err",
    module: "@typesugar/fp",
    kind: "function",
    isReexport: false,
    description: "Construct Err value",
  },
  {
    name: "IO",
    module: "@typesugar/fp",
    kind: "type",
    isReexport: false,
    description: "Side-effecting computation",
  },

  // Macros from @typesugar/macros (re-exported by typesugar)
  {
    name: "comptime",
    module: "typesugar",
    kind: "macro",
    isReexport: false,
    description: "Compile-time evaluation",
  },
  {
    name: "specialize",
    module: "typesugar",
    kind: "macro",
    isReexport: false,
    description: "Zero-cost inlining",
  },
  {
    name: "match",
    module: "typesugar",
    kind: "macro",
    isReexport: false,
    description: "Pattern matching",
  },
  {
    name: "derive",
    module: "typesugar",
    kind: "macro",
    isReexport: false,
    description: "Derive typeclass instances",
  },
  {
    name: "typeclass",
    module: "typesugar",
    kind: "macro",
    isReexport: false,
    description: "Define typeclass",
  },
  {
    name: "instance",
    module: "typesugar",
    kind: "macro",
    isReexport: false,
    description: "Define instance",
  },
  {
    name: "summon",
    module: "typesugar",
    kind: "macro",
    isReexport: false,
    description: "Summon typeclass instance",
  },
  {
    name: "extend",
    module: "typesugar",
    kind: "macro",
    isReexport: false,
    description: "Extend type with typeclass",
  },
  {
    name: "cfg",
    module: "typesugar",
    kind: "macro",
    isReexport: false,
    description: "Conditional compilation",
  },
  {
    name: "tailrec",
    module: "typesugar",
    kind: "macro",
    isReexport: false,
    description: "Tail-call optimization",
  },
  {
    name: "quote",
    module: "typesugar",
    kind: "macro",
    isReexport: false,
    description: "AST quasiquoting",
  },
  {
    name: "includeStr",
    module: "typesugar",
    kind: "macro",
    isReexport: false,
    description: "Include file as string",
  },
  {
    name: "includeJson",
    module: "typesugar",
    kind: "macro",
    isReexport: false,
    description: "Include file as JSON",
  },
  {
    name: "static_assert",
    module: "typesugar",
    kind: "macro",
    isReexport: false,
    description: "Compile-time assertion",
  },

  // Extension method namespaces
  {
    name: "NumberExt",
    module: "@typesugar/std",
    kind: "extension",
    isReexport: false,
    description: "Number extensions",
  },
  {
    name: "StringExt",
    module: "@typesugar/std",
    kind: "extension",
    isReexport: false,
    description: "String extensions",
  },
  {
    name: "ArrayExt",
    module: "@typesugar/std",
    kind: "extension",
    isReexport: false,
    description: "Array extensions",
  },

  // Umbrella package re-exports common items
  {
    name: "Option",
    module: "typesugar",
    kind: "type",
    isReexport: true,
    originalModule: "@typesugar/fp",
  },
  {
    name: "Some",
    module: "typesugar",
    kind: "function",
    isReexport: true,
    originalModule: "@typesugar/fp",
  },
  {
    name: "None",
    module: "typesugar",
    kind: "value",
    isReexport: true,
    originalModule: "@typesugar/fp",
  },
  {
    name: "Either",
    module: "typesugar",
    kind: "type",
    isReexport: true,
    originalModule: "@typesugar/fp",
  },
  {
    name: "Result",
    module: "typesugar",
    kind: "type",
    isReexport: true,
    originalModule: "@typesugar/fp",
  },
  {
    name: "Eq",
    module: "typesugar",
    kind: "typeclass",
    isReexport: true,
    originalModule: "@typesugar/std",
  },
  {
    name: "Ord",
    module: "typesugar",
    kind: "typeclass",
    isReexport: true,
    originalModule: "@typesugar/std",
  },
  {
    name: "Show",
    module: "typesugar",
    kind: "typeclass",
    isReexport: true,
    originalModule: "@typesugar/std",
  },
];

/**
 * Known extension methods and their source modules.
 */
const knownExtensionMethods: Array<{ method: string; modules: string[] }> = [
  // Number extensions
  { method: "clamp", modules: ["@typesugar/std"] },
  { method: "abs", modules: ["@typesugar/std"] },
  { method: "sign", modules: ["@typesugar/std"] },
  { method: "floor", modules: ["@typesugar/std"] },
  { method: "ceil", modules: ["@typesugar/std"] },
  { method: "round", modules: ["@typesugar/std"] },
  { method: "pow", modules: ["@typesugar/std"] },
  { method: "sqrt", modules: ["@typesugar/std"] },

  // String extensions
  { method: "capitalize", modules: ["@typesugar/std"] },
  { method: "words", modules: ["@typesugar/std"] },
  { method: "lines", modules: ["@typesugar/std"] },
  { method: "reverse", modules: ["@typesugar/std"] },
  { method: "isEmpty", modules: ["@typesugar/std"] },
  { method: "isBlank", modules: ["@typesugar/std"] },

  // Array extensions
  { method: "head", modules: ["@typesugar/std", "@typesugar/fp"] },
  { method: "tail", modules: ["@typesugar/std", "@typesugar/fp"] },
  { method: "last", modules: ["@typesugar/std", "@typesugar/fp"] },
  { method: "init", modules: ["@typesugar/std", "@typesugar/fp"] },
  { method: "sum", modules: ["@typesugar/std"] },
  { method: "product", modules: ["@typesugar/std"] },
  { method: "grouped", modules: ["@typesugar/std"] },
  { method: "sliding", modules: ["@typesugar/std"] },
  { method: "distinct", modules: ["@typesugar/std"] },
  { method: "partition", modules: ["@typesugar/std"] },

  // Option methods
  { method: "map", modules: ["@typesugar/fp"] },
  { method: "flatMap", modules: ["@typesugar/fp"] },
  { method: "getOrElse", modules: ["@typesugar/fp"] },
  { method: "orElse", modules: ["@typesugar/fp"] },
  { method: "fold", modules: ["@typesugar/fp"] },

  // Typeclass methods
  { method: "show", modules: ["@typesugar/std"] },
  { method: "equals", modules: ["@typesugar/std"] },
  { method: "compare", modules: ["@typesugar/std"] },
  { method: "clone", modules: ["@typesugar/std"] },
  { method: "debug", modules: ["@typesugar/std"] },
  { method: "hash", modules: ["@typesugar/std"] },
  { method: "combine", modules: ["@typesugar/std"] },
];

/**
 * Global module export index.
 */
let globalExportIndex: ModuleExportIndex | null = null;

/**
 * Get or create the global export index.
 */
export function getExportIndex(): ModuleExportIndex {
  if (!globalExportIndex) {
    globalExportIndex = createModuleExportIndex();

    // Populate with default exports
    for (const exp of defaultExports) {
      const byName = globalExportIndex.byName.get(exp.name) ?? [];
      byName.push(exp);
      globalExportIndex.byName.set(exp.name, byName);

      const byModule = globalExportIndex.byModule.get(exp.module) ?? [];
      byModule.push(exp);
      globalExportIndex.byModule.set(exp.module, byModule);

      if (exp.kind === "typeclass") {
        globalExportIndex.typeclassToModule.set(exp.name, exp.module);
      }
      if (exp.kind === "macro") {
        globalExportIndex.macroToModule.set(exp.name, exp.module);
      }
    }

    // Populate extension methods
    for (const { method, modules } of knownExtensionMethods) {
      globalExportIndex.extensionToModule.set(method, modules);
    }
  }

  return globalExportIndex;
}

/**
 * Reset the global export index (for testing).
 */
export function resetExportIndex(): void {
  globalExportIndex = null;
}

/**
 * Register a custom export in the index.
 */
export function registerExport(symbol: ExportedSymbol): void {
  const index = getExportIndex();

  const byName = index.byName.get(symbol.name) ?? [];
  byName.push(symbol);
  index.byName.set(symbol.name, byName);

  const byModule = index.byModule.get(symbol.module) ?? [];
  byModule.push(symbol);
  index.byModule.set(symbol.module, byModule);

  if (symbol.kind === "typeclass") {
    index.typeclassToModule.set(symbol.name, symbol.module);
  }
  if (symbol.kind === "macro") {
    index.macroToModule.set(symbol.name, symbol.module);
  }
  if (symbol.kind === "extension-method") {
    const modules = index.extensionToModule.get(symbol.name) ?? [];
    if (!modules.includes(symbol.module)) {
      modules.push(symbol.module);
    }
    index.extensionToModule.set(symbol.name, modules);
  }
}

/**
 * Import suggestion with context.
 */
export interface ImportSuggestion {
  /** The symbol that should be imported */
  symbolName: string;
  /** The module to import from */
  module: string;
  /** The kind of import */
  kind: ExportKind;
  /** Suggested import statement */
  importStatement: string;
  /** Confidence level (0-1) */
  confidence: number;
  /** Why this is suggested */
  reason: string;
}

/**
 * Get import suggestions for an undefined symbol.
 */
export function getSuggestionsForSymbol(
  symbolName: string,
  context?: { preferredModules?: string[] },
): ImportSuggestion[] {
  const index = getExportIndex();
  const exports = index.byName.get(symbolName);

  if (!exports || exports.length === 0) {
    return [];
  }

  const suggestions: ImportSuggestion[] = [];
  const preferredModules = context?.preferredModules ?? [
    "typesugar",
    "@typesugar/std",
    "@typesugar/fp",
  ];

  // Sort exports by preference: preferred modules first, then non-reexports
  const sorted = [...exports].sort((a, b) => {
    const aPreferred = preferredModules.indexOf(a.module);
    const bPreferred = preferredModules.indexOf(b.module);

    if (aPreferred !== -1 && bPreferred === -1) return -1;
    if (bPreferred !== -1 && aPreferred === -1) return 1;
    if (aPreferred !== -1 && bPreferred !== -1) return aPreferred - bPreferred;

    // Prefer non-reexports
    if (!a.isReexport && b.isReexport) return -1;
    if (a.isReexport && !b.isReexport) return 1;

    return 0;
  });

  for (const exp of sorted) {
    const importStatement =
      exp.kind === "type"
        ? `import type { ${symbolName} } from "${exp.module}";`
        : `import { ${symbolName} } from "${exp.module}";`;

    const confidence = preferredModules.includes(exp.module)
      ? exp.isReexport
        ? 0.8
        : 0.9
      : exp.isReexport
        ? 0.5
        : 0.6;

    suggestions.push({
      symbolName,
      module: exp.module,
      kind: exp.kind,
      importStatement,
      confidence,
      reason: exp.description ?? `${symbolName} is exported from ${exp.module}`,
    });
  }

  return suggestions;
}

/**
 * Get import suggestions for a method that doesn't exist on a type.
 */
export function getSuggestionsForMethod(
  methodName: string,
  receiverType?: string,
): ImportSuggestion[] {
  const index = getExportIndex();
  const modules = index.extensionToModule.get(methodName);

  if (!modules || modules.length === 0) {
    return [];
  }

  const suggestions: ImportSuggestion[] = [];

  for (const module of modules) {
    const exports = index.byModule.get(module) ?? [];

    // Find the extension namespace that provides this method
    const extensionNamespace = exports.find(
      (e) =>
        e.kind === "extension" &&
        e.name.toLowerCase().includes(receiverType?.toLowerCase() ?? ""),
    );

    const importTarget = extensionNamespace?.name ?? methodName;
    const importStatement = `import { ${importTarget} } from "${module}";`;

    suggestions.push({
      symbolName: methodName,
      module,
      kind: "extension-method",
      importStatement,
      confidence: 0.7,
      reason: `Method '${methodName}' is available as an extension from ${module}`,
    });
  }

  return suggestions;
}

/**
 * Get import suggestions for a typeclass that's not in scope.
 */
export function getSuggestionsForTypeclass(
  typeclassName: string,
): ImportSuggestion[] {
  const index = getExportIndex();
  const module = index.typeclassToModule.get(typeclassName);

  if (!module) {
    return [];
  }

  return [
    {
      symbolName: typeclassName,
      module,
      kind: "typeclass",
      importStatement: `import { ${typeclassName} } from "${module}";`,
      confidence: 0.95,
      reason: `Typeclass '${typeclassName}' is defined in ${module}`,
    },
  ];
}

/**
 * Get import suggestions for a macro that's not defined.
 */
export function getSuggestionsForMacro(macroName: string): ImportSuggestion[] {
  const index = getExportIndex();
  const module = index.macroToModule.get(macroName);

  if (!module) {
    return [];
  }

  return [
    {
      symbolName: macroName,
      module,
      kind: "macro",
      importStatement: `import { ${macroName} } from "${module}";`,
      confidence: 0.95,
      reason: `Macro '${macroName}' is exported from ${module}`,
    },
  ];
}

/**
 * Format import suggestions as a diagnostic message.
 */
export function formatSuggestionsMessage(
  suggestions: ImportSuggestion[],
  maxSuggestions = 3,
): string {
  if (suggestions.length === 0) {
    return "";
  }

  const top = suggestions.slice(0, maxSuggestions);
  const lines: string[] = ["Did you mean to import?"];

  for (const suggestion of top) {
    lines.push(`  ${suggestion.importStatement}`);
  }

  if (suggestions.length > maxSuggestions) {
    lines.push(`  ... and ${suggestions.length - maxSuggestions} more`);
  }

  return lines.join("\n");
}

/**
 * Generate a code fix for adding an import.
 */
export function generateImportFix(
  sourceFile: ts.SourceFile,
  suggestion: ImportSuggestion,
): { range: { start: number; end: number }; text: string } {
  // Find the first non-comment, non-empty line to insert after
  const firstStatement = sourceFile.statements[0];
  const insertPos = firstStatement ? firstStatement.getStart(sourceFile) : 0;

  // Check if there are existing imports
  let hasImports = false;
  let lastImportEnd = 0;

  for (const stmt of sourceFile.statements) {
    if (ts.isImportDeclaration(stmt)) {
      hasImports = true;
      lastImportEnd = stmt.getEnd();
    } else if (hasImports) {
      // First non-import after imports
      break;
    }
  }

  if (hasImports) {
    // Insert after the last import
    return {
      range: { start: lastImportEnd, end: lastImportEnd },
      text: `\n${suggestion.importStatement}`,
    };
  } else {
    // Insert at the beginning
    return {
      range: { start: insertPos, end: insertPos },
      text: `${suggestion.importStatement}\n\n`,
    };
  }
}

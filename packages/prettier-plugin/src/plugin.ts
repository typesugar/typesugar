/**
 * Prettier plugin for typesugar custom syntax
 *
 * This plugin provides a custom TypeScript parser that preprocesses custom syntax
 * (|>, ::, F<_>) before Prettier parses it. This prevents Prettier from crashing
 * on typesugar files.
 *
 * Note: This plugin only handles the "don't crash" layer. For full round-trip
 * formatting that preserves custom syntax, use the `format()` function exported
 * from the main index.
 */

import type { Plugin, Parser, Options } from "prettier";
import { preFormat } from "./pre-format.js";

/**
 * Custom options for the typesugar prettier plugin
 */
export interface TypesugarPrettierOptions {
  /**
   * Whether to skip typesugar preprocessing.
   * Default: false
   */
  typesugarSkip?: boolean;
}

/**
 * Get the built-in TypeScript parser from Prettier.
 * Uses dynamic import to avoid bundling issues.
 */
async function getTypescriptParser(): Promise<Parser> {
  // Prettier v3 exports parsers from prettier/plugins/*
  const { parsers } = await import("prettier/plugins/typescript");
  return parsers.typescript;
}

// Cache the TypeScript parser after first load
let cachedTsParser: Parser | null = null;

/**
 * Create the typesugar parser by extending Prettier's TypeScript parser
 */
async function createTypesugarParser(): Promise<Parser> {
  if (!cachedTsParser) {
    cachedTsParser = await getTypescriptParser();
  }

  const tsParser = cachedTsParser;

  return {
    ...tsParser,

    /**
     * Preprocess source code before parsing.
     * Converts custom syntax to valid TypeScript.
     */
    preprocess(text: string, options: Options & TypesugarPrettierOptions): string {
      // Skip preprocessing if explicitly disabled
      if (options.typesugarSkip) {
        return text;
      }

      // Get file path for JSX detection
      const fileName = options.filepath;

      // Run typesugar preprocessor in format mode
      const result = preFormat(text, { fileName });

      return result.code;
    },
  };
}

// The parser is created lazily and cached
let typesugarParser: Parser | null = null;

/**
 * Lazy parser factory that creates the parser on first use.
 * This is needed because we need to async import Prettier's TypeScript parser.
 */
const lazyParser: Parser = {
  // These will be overwritten when the real parser is loaded
  parse: async (text, options) => {
    if (!typesugarParser) {
      typesugarParser = await createTypesugarParser();
    }
    return typesugarParser.parse(text, options);
  },

  astFormat: "estree",

  locStart: (node: unknown) => {
    // Prettier's TypeScript parser uses estree format
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const n = node as any;
    return n.range?.[0] ?? n.start ?? 0;
  },

  locEnd: (node: unknown) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const n = node as any;
    return n.range?.[1] ?? n.end ?? 0;
  },

  preprocess: (text, options) => {
    // Skip preprocessing if explicitly disabled
    const opts = options as Options & TypesugarPrettierOptions;
    if (opts.typesugarSkip) {
      return text;
    }

    // Get file path for JSX detection
    const fileName = options.filepath;

    // Run typesugar preprocessor in format mode
    const result = preFormat(text, { fileName });

    return result.code;
  },
};

/**
 * The Prettier plugin definition
 */
export const plugin: Plugin = {
  languages: [
    {
      name: "TypeSugar TypeScript",
      parsers: ["typesugar-ts"],
      extensions: [".ts", ".tsx", ".mts", ".cts"],
      vscodeLanguageIds: ["typescript", "typescriptreact"],
    },
  ],

  parsers: {
    "typesugar-ts": lazyParser,
  },

  options: {
    typesugarSkip: {
      type: "boolean",
      category: "TypeSugar",
      default: false,
      description: "Skip typesugar preprocessing",
    },
  },
};

export default plugin;

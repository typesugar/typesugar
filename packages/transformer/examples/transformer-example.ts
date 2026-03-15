/**
 * Transformer Configuration Example
 *
 * Shows how to configure the typesugar transformer for different build systems.
 * The transformer is the core engine that expands macros at compile time.
 */

// --- ts-patch Configuration (tsconfig.json) ---

/*
{
  "compilerOptions": {
    "plugins": [
      {
        "transform": "@typesugar/transformer",
        "verbose": true,
        "timeout": 5000
      }
    ]
  }
}
*/

// --- Vite Configuration (vite.config.ts) ---

/*
import { defineConfig } from "vite";
import { typesugarPlugin } from "unplugin-typesugar/vite";

export default defineConfig({
  plugins: [
    typesugarPlugin({
      verbose: false,
      timeout: 5000,
    }),
  ],
});
*/

// --- esbuild Configuration (build.js) ---

/*
import { build } from "esbuild";
import { typesugarPlugin } from "unplugin-typesugar/esbuild";

build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  outfile: "dist/bundle.js",
  plugins: [
    typesugarPlugin({
      verbose: false,
    }),
  ],
});
*/

// --- Webpack Configuration (webpack.config.js) ---

/*
const { typesugarPlugin } = require("unplugin-typesugar/webpack");

module.exports = {
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: [
          {
            loader: "ts-loader",
            options: {
              getCustomTransformers: () => ({
                before: [typesugarPlugin({})],
              }),
            },
          },
        ],
      },
    ],
  },
};
*/

// --- Using the Transformer Directly ---

import { MacroTransformer, MacroTransformerConfig } from "@typesugar/transformer";
import * as ts from "typescript";

console.log("=== Transformer Configuration ===\n");

// Configuration options
const config: MacroTransformerConfig = {
  // Enable verbose logging during transformation
  verbose: false,

  // Timeout for comptime() evaluation (ms)
  timeout: 5000,

  // Custom macro directories to scan
  macroDirectories: [],
};

console.log("Transformer config:", config);

// --- Supported Macro Types ---

console.log("\n--- Supported Macro Types ---");

const macroTypes = [
  {
    type: "Expression",
    example: "comptime()",
    description: "Transform function calls",
  },
  {
    type: "Attribute",
    example: "@derive()",
    description: "Transform decorated declarations",
  },
  {
    type: "Tagged Template",
    example: "sql``",
    description: "Transform template literals",
  },
  {
    type: "Labeled Block",
    example: "let: { } yield: { }",
    description: "Transform labeled statements",
  },
  {
    type: "Type",
    example: "Refined<T>",
    description: "Transform type annotations",
  },
  {
    type: "Derive",
    example: "@derive(Eq)",
    description: "Auto-generate implementations",
  },
];

macroTypes.forEach((m) => {
  console.log(`  ${m.type}: ${m.example}`);
  console.log(`    ${m.description}`);
});

// --- Import-Scoped Resolution ---

console.log("\n--- Import-Scoped Resolution ---");
console.log("Macros are resolved based on imports:");
console.log("  import { sql } from '@typesugar/sql';");
console.log("  sql`SELECT * FROM users`  // Expands with sqlMacro");
console.log("");
console.log("  import { comptime } from 'typesugar';");
console.log("  comptime(Date.now())  // Evaluates at compile time");

// --- CLI Usage ---

console.log("\n--- CLI Usage ---");
console.log("npx typesugar build src/index.ts --outDir dist");
console.log("npx typesugar watch src/ --outDir dist");

/**
 * Bundler Integration Examples
 *
 * Shows how to configure ttfx with various bundlers using the unplugin system.
 */

console.log("=== Bundler Integration Examples ===\n");

// --- Vite Configuration ---

console.log("--- Vite (vite.config.ts) ---");
console.log(`
import { defineConfig } from "vite";
import ttfx from "@ttfx/integrations/vite";

export default defineConfig({
  plugins: [
    ttfx({
      // Enable verbose logging
      verbose: false,
      // Compile-time evaluation timeout (ms)
      timeout: 5000,
      // Additional macro directories
      macroDirectories: [],
    }),
  ],
});
`);

// --- Webpack Configuration ---

console.log("--- Webpack (webpack.config.js) ---");
console.log(`
const ttfx = require("@ttfx/integrations/webpack");

module.exports = {
  plugins: [
    ttfx.default({
      verbose: false,
      timeout: 5000,
    }),
  ],
};
`);

// --- esbuild Configuration ---

console.log("--- esbuild (build.js) ---");
console.log(`
import { build } from "esbuild";
import ttfx from "@ttfx/integrations/esbuild";

build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  outfile: "dist/bundle.js",
  plugins: [
    ttfx({
      verbose: false,
      timeout: 5000,
    }),
  ],
});
`);

// --- Rollup Configuration ---

console.log("--- Rollup (rollup.config.js) ---");
console.log(`
import ttfx from "@ttfx/integrations/rollup";

export default {
  input: "src/index.ts",
  output: {
    file: "dist/bundle.js",
    format: "esm",
  },
  plugins: [
    ttfx({
      verbose: false,
      timeout: 5000,
    }),
  ],
};
`);

// --- ts-patch Configuration ---

console.log("--- ts-patch (tsconfig.json) ---");
console.log(`
{
  "compilerOptions": {
    "plugins": [
      {
        "transform": "@ttfx/transformer",
        "verbose": false,
        "timeout": 5000
      }
    ]
  }
}
`);

// --- Configuration Options ---

console.log("--- Configuration Options ---");
console.log(`
interface TypeMacroPluginOptions {
  // Log macro expansions to console
  verbose?: boolean;
  
  // Timeout for comptime() evaluation in ms (default: 5000)
  timeout?: number;
  
  // Additional directories to scan for macros
  macroDirectories?: string[];
  
  // File patterns to include (default: ['**/*.ts', '**/*.tsx'])
  include?: string[];
  
  // File patterns to exclude (default: ['node_modules/**'])
  exclude?: string[];
}
`);

// --- Usage Notes ---

console.log("--- Usage Notes ---");
console.log(`
1. Install the integration package:
   npm install @ttfx/integrations

2. Import the plugin for your bundler:
   import ttfx from "@ttfx/integrations/vite";

3. Add to your bundler config

4. Import and use macros in your code:
   import { comptime } from "@ttfx/comptime";
   import { sql } from "@ttfx/sql";
   
   const buildTime = comptime(new Date().toISOString());
   const query = sql\`SELECT * FROM users\`;
`);

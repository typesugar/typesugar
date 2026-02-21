/**
 * @typesugar/ts-plugin Showcase
 *
 * Configuration guide for the typesugar TypeScript language service plugin.
 *
 * The TS plugin provides IDE integration by transforming typesugar source files
 * before TypeScript processes them. This enables accurate type checking,
 * completions, and go-to-definition for custom syntax and macros.
 *
 * Install: npm install @typesugar/ts-plugin
 */

// ============================================================================
// 1. TSCONFIG SETUP — Enable the plugin
// ============================================================================

// Add the plugin to your tsconfig.json:
//
//   {
//     "compilerOptions": {
//       "plugins": [
//         { "name": "@typesugar/ts-plugin" }
//       ]
//     }
//   }
//
// The plugin delegates to @typesugar/transformer's language service
// implementation, which handles all the heavy lifting.

// ============================================================================
// 2. VS CODE INTEGRATION — Automatic registration
// ============================================================================

// If you use the @typesugar/vscode extension, the plugin is registered
// automatically via package.json:
//
//   {
//     "contributes": {
//       "typescriptServerPlugins": [{
//         "name": "@typesugar/ts-plugin",
//         "enableForWorkspaceTypeScriptVersions": true
//       }]
//     }
//   }
//
// No tsconfig.json changes needed when using the VS Code extension.

// ============================================================================
// 3. WHAT THE PLUGIN DOES — Transformation pipeline
// ============================================================================

// The plugin intercepts TypeScript's language service at the file level:
//
//   1. Source file requested by TS language service
//   2. Plugin runs typesugar preprocessor (|>, ::, F<_> → valid TS)
//   3. Plugin runs macro expansion (@derive, comptime, etc.)
//   4. Transformed source returned to TS for type checking
//   5. Diagnostics, completions, definitions mapped back to original positions
//
// This means you get full IntelliSense for macro-generated code:
//
//   @derive(Eq, Clone)
//   interface Point { x: number; y: number }
//
//   Point.      ← completions include .equals(), .clone()
//   p1 === p2   ← no type error (Eq generates the comparison)

// ============================================================================
// 4. FEATURES — What the plugin enables
// ============================================================================

// Custom syntax support:
//   - |> (pipeline operator) — no red squiggles
//   - :: (cons operator) — no red squiggles
//   - F<_> (HKT syntax) — no red squiggles
//
// Macro expansion:
//   - @derive generates methods → completions work
//   - @typeclass registers instances → extension methods resolve
//   - comptime() evaluates → result type is accurate
//
// Navigation:
//   - Go-to-definition works through macro expansions
//   - Find references includes macro-generated code
//   - Hover shows expanded types
//
// Diagnostics:
//   - Real type errors from expanded code
//   - Macro-specific error messages
//   - No false positives from macro syntax

// ============================================================================
// 5. CACHING — Performance optimization
// ============================================================================

// The plugin caches transformation results for files that haven't changed.
// This means:
//
//   - First open: full transformation (slower)
//   - Subsequent checks: cached result (instant)
//   - File edit: re-transform only changed file
//
// The cache is per-session (cleared when TS server restarts).

// ============================================================================
// 6. LEGACY MODE — Error suppression only
// ============================================================================

// If the full transformation is too slow or causes issues, the VS Code
// extension supports a legacy mode that only suppresses false errors:
//
//   // In VS Code settings.json:
//   {
//     "typesugar.useLegacyPlugin": true
//   }
//
// Legacy mode:
//   - Suppresses known false-positive diagnostics
//   - No macro expansion (no IntelliSense for generated code)
//   - Faster startup
//   - Suitable for very large projects

// ============================================================================
// 7. VERBOSE LOGGING — Debug plugin issues
// ============================================================================

// Enable verbose logging to diagnose plugin behavior:
//
//   // In VS Code settings.json:
//   {
//     "typesugar.enableVerboseLogging": true
//   }
//
// Logs appear in:
//   - VS Code Output panel → "TypeScript" channel
//   - TS Server log: Help → Open TS Server Log
//
// Look for lines prefixed with [typesugar] for plugin activity.

// ============================================================================
// 8. ARCHITECTURE — How it connects
// ============================================================================

// The plugin is a thin entry point:
//
//   @typesugar/ts-plugin/src/index.ts
//     └─ requires @typesugar/transformer/language-service
//         └─ The canonical implementation (700+ lines)
//
// This ensures a single source of truth for the language service logic.
// The VS Code extension bundles @typesugar/ts-plugin so it works
// without additional npm installs.

// ============================================================================
// 9. COMPATIBILITY — Supported environments
// ============================================================================

// TypeScript version:  >= 5.0.0
// Module format:       CommonJS (required by TS language service plugins)
// Environments:
//   - VS Code (via extension or tsconfig.json)
//   - Any editor with TypeScript language service support
//   - WebStorm / IntelliJ (via tsconfig.json)
//   - Neovim with nvim-lspconfig (via tsconfig.json)
//   - Sublime Text with LSP-typescript (via tsconfig.json)

export {};

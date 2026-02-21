/**
 * @typesugar/vscode Showcase
 *
 * Configuration guide and feature reference for the typesugar VS Code extension.
 *
 * The VS Code extension is not a library — it provides IDE integration for
 * typesugar projects. This file documents configuration patterns, features,
 * and recommended settings.
 *
 * Install: Search "typesugar" in VS Code Extensions, or:
 *   code --install-extension typesugar.typesugar
 */

// ============================================================================
// 1. ACTIVATION — When the extension starts
// ============================================================================

// The extension activates automatically when it detects typesugar in a project:
//
//   - A `typesugar.manifest.json` file exists anywhere in the workspace
//   - The `typesugar` package exists in node_modules
//
// No manual activation needed. The status bar shows "⚡ typesugar (N macros)"
// once active.

// ============================================================================
// 2. SEMANTIC HIGHLIGHTING — Macro-aware syntax colors
// ============================================================================

// The extension provides 7 semantic token types that give macros distinct colors:
//
//   Token Type          Default Color     What It Highlights
//   ─────────────────── ────────────────  ────────────────────────────────
//   macro               #C586C0 (purple)  Expression macros: comptime(), specialize()
//   macroDecorator      #DCDCAA (yellow)  Attribute macros: @derive, @typeclass
//   macroTemplate       #CE9178 (orange)  Tagged template macros: sql`...`
//   extensionMethod     #4EC9B0 (teal)    Typeclass methods: .show(), .clone()
//   deriveArg           #4FC1FF (blue)    Derive arguments: Eq, Ord, Clone
//   bindVariable        #9CDCFE (light)   Monadic binds: x << Some(1)
//   comptimeBlock       italic            Compile-time blocks: comptime { }
//
// These work alongside the injected TextMate grammar which handles structural
// syntax (let:/yield: blocks, << operator, comptime keyword).

// To customize colors in settings.json:
//
// {
//   "editor.semanticTokenColorCustomizations": {
//     "rules": {
//       "macro": { "foreground": "#FF79C6", "bold": true },
//       "extensionMethod": { "foreground": "#50FA7B", "italic": true },
//       "deriveArg": { "foreground": "#8BE9FD" }
//     }
//   }
// }

// ============================================================================
// 3. CODELENS — Inline expansion previews
// ============================================================================

// CodeLens appears above macro invocations showing what they expand to:
//
//   ▸ Expands to: (p1.x === p2.x && p1.y === p2.y)
//   p1 === p2
//
//   ▸ Expands to: while(true) { ... }
//   @tailrec
//   function factorial(n: number, acc = 1): number { ... }
//
// Click the CodeLens to open the full expansion in a side panel.
//
// Disable in settings:
// {
//   "typesugar.enableCodeLens": false
// }

// ============================================================================
// 4. INLAY HINTS — Bind types and comptime results
// ============================================================================

// Inlay hints show type information for monadic binds and compile-time values:
//
//   let: {
//     x << Some(1)        // x: number
//     y << Some("hello")  // y: string
//   }
//
//   const answer = comptime(() => 6 * 7)  // = 42
//
// Disable in settings:
// {
//   "typesugar.enableInlayHints": false
// }

// ============================================================================
// 5. CODE ACTIONS — Quick fixes and refactorings
// ============================================================================

// The extension provides code actions (lightbulb menu):
//
//   - "Expand macro" — expand the macro under cursor and show the result
//   - "Wrap with comptime()" — wrap a constant expression for compile-time eval
//   - "Add @derive(...)" — quick-pick derive macros to add to a type
//
// These appear in the lightbulb menu (Ctrl+.) when the cursor is on a relevant node.

// ============================================================================
// 6. COMMANDS — Command palette actions
// ============================================================================

// Available commands (Ctrl+Shift+P):
//
//   Command                           Description
//   ────────────────────────────────  ─────────────────────────────────────
//   typesugar: Expand Macro at Cursor  Show expansion of macro under cursor
//   typesugar: Show Transformed Source  Diff view: original vs transformed
//   typesugar: Refresh Macro Manifest  Reload manifest from disk
//   typesugar: Generate Macro Manifest  Run `npx typesugar build --manifest`

// ============================================================================
// 7. DIAGNOSTICS — Background error checking
// ============================================================================

// The extension runs the typesugar transformer in the background and reports
// compile-time errors as VS Code diagnostics (red squiggles):
//
//   - staticAssert() failures
//   - Missing typeclass instances
//   - Invalid @derive targets
//   - comptime() evaluation errors
//
// Disable in settings:
// {
//   "typesugar.enableDiagnostics": false
// }

// ============================================================================
// 8. LANGUAGE SERVICE PLUGIN — TypeScript integration
// ============================================================================

// The extension bundles @typesugar/ts-plugin and registers it automatically.
// This handles:
//
//   - Suppressing false TS errors on custom syntax (|>, ::, F<_>)
//   - Providing completions for typeclass methods
//   - Go-to-definition through macro expansions
//
// The plugin is declared in package.json:
// {
//   "contributes": {
//     "typescriptServerPlugins": [{
//       "name": "@typesugar/ts-plugin",
//       "enableForWorkspaceTypeScriptVersions": true
//     }]
//   }
// }
//
// For manual tsconfig.json setup (without the extension):
// {
//   "compilerOptions": {
//     "plugins": [{ "name": "@typesugar/ts-plugin" }]
//   }
// }

// ============================================================================
// 9. CONFIGURATION REFERENCE — All settings
// ============================================================================

// Setting                          Type     Default                  Description
// ──────────────────────────────── ──────── ──────────────────────── ─────────────────────────────────
// typesugar.enableCodeLens          boolean  true                     Show expansion preview CodeLens
// typesugar.enableInlayHints        boolean  true                     Show bind types & comptime values
// typesugar.enableDiagnostics       boolean  true                     Background macro error checking
// typesugar.manifestPath            string   "typesugar.manifest.json" Path to macro manifest file
// typesugar.useLegacyPlugin         boolean  false                    Use legacy error-suppression plugin
// typesugar.enableVerboseLogging    boolean  false                    Verbose plugin logging for debug

// ============================================================================
// 10. TEXTMATE GRAMMAR — Structural syntax highlighting
// ============================================================================

// Two injected TextMate grammars provide highlighting for syntax that the
// semantic token provider doesn't cover:
//
//   source.ts.typesugar:
//     - let:/yield: labeled blocks (keyword.control)
//     - << bind operator (keyword.operator)
//     - comptime keyword (keyword.control)
//
//   source.ts.typesugar.units:
//     - Unit literals like 42_km, 3.14_rad (constant.numeric.unit)
//
// These grammars are injected into source.ts and source.tsx scopes.

export {};

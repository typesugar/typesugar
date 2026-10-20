/**
 * typesugar VS Code extension — feature reference
 *
 * The extension is not a library: it adds typesugar to VS Code's built-in
 * TypeScript support. All language features come from the TypeScript server
 * plugin `@typesugar/ts-plugin` (which loads
 * `@typesugar/transformer/language-service`), the single editor engine for 1.0.
 * The extension doesn't start a separate language server.
 */

// ============================================================================
// 1. THE TSSERVER PLUGIN — where the language features come from
// ============================================================================

// The extension registers the plugin with VS Code's TypeScript server:
//
//   "contributes": {
//     "typescriptServerPlugins": [{
//       "name": "@typesugar/ts-plugin",
//       "enableForWorkspaceTypeScriptVersions": true
//     }]
//   }
//
// Inside tsserver the plugin serves macro-expanded code to TypeScript and maps
// every position back to your source, so VS Code's own features are macro-aware:
// diagnostics (TypeScript's and typesugar's TS9xxx), completions, hover,
// go-to-definition, references, rename, signature help and quick fixes.
//
// Projects that also list the plugin in tsconfig.json (needed for other
// editors) keep working: the project's own copy is used and the bundled copy
// stands down.
//
//   { "compilerOptions": { "plugins": [{ "name": "@typesugar/transformer/language-service" }] } }

// ============================================================================
// 2. COMMANDS — macro expansion views
// ============================================================================

// Command palette (Ctrl/Cmd+Shift+P) and the editor context menu:
//
//   typesugar: Expand Macro at Cursor    Opens the expansion of the macro under
//                                        the cursor in a side editor.
//   typesugar: Show Transformed Source   Diff of the whole file: your source vs
//                                        what TypeScript sees.
//
// Both ask the plugin through custom tsserver requests
// (`_typesugar.expandMacro`, `_typesugar.showTransformed`), so they show the
// current, unsaved buffer.

// ============================================================================
// 3. INLAY HINTS — expansion previews
// ============================================================================

// After an expression macro call the plugin adds a hint with its expansion:
//
//   const fields = fieldNames<User>()  = ["id", "name"]
//
// VS Code only asks the TypeScript server for inlay hints when at least one
// `typescript.inlayHints.*` setting is on, e.g.
//
//   "typescript.inlayHints.variableTypes.enabled": true

// ============================================================================
// 4. SETTINGS
// ============================================================================

//   typesugar.comptimeInEditor  boolean  false  Evaluate comptime(...) in the
//                                               editor. Trusted workspaces only:
//                                               comptime code runs with the
//                                               editor's privileges.
//
// The setting is sent to the plugin with the TypeScript extension's
// `configurePlugin` API. A repository cannot turn it on from its tsconfig.json.

// ============================================================================
// 5. TEXTMATE GRAMMARS — structural syntax highlighting
// ============================================================================

// Two grammars are injected into source.ts and source.tsx:
//
//   source.ts.typesugar:
//     - let:/yield: labeled blocks (keyword.control)
//     - << bind operator (keyword.operator)
//     - comptime keyword (keyword.control)
//
//   source.ts.typesugar.units:
//     - Unit literals like 42_km, 3.14_rad (constant.numeric.unit)

export {};

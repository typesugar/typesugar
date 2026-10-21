# Cursor Manual Verification Checklist

## Setup

1. Open Cursor
2. Copy `integration/fixtures/basic-project` somewhere outside the repo, install its
   dependencies (`npm install`), and open that folder (`File → Open Folder`). The automated
   suite deletes its temp copies when it finishes, so make your own.
3. Open a `.ts` file and check that the TypeScript server loaded the plugin: "TypeScript: Open TS
   Server Log" has `[typesugar]` lines.

## Category 1: Error Positioning (Red Squigglies)

### src/diagnostics.ts

- [ ] Line 7 (`const x: number = "wrong"`) — red squiggly under `"wrong"`
- [ ] Line 13 (`const y: string = 42`) — red squiggly under `42`
- [ ] Line 16 (`staticAssert(false, "intentional failure")`) — red/yellow squiggly under the call
- [ ] Verify squigglies are on the correct lines (not shifted by @derive expansion)

### src/pipe-chain.ts

- [ ] Line 20 (`const bad: number = "wrong"`) — red squiggly under `"wrong"`
- [ ] Verify squiggly is not shifted by the multi-line pipe() expansion above

### src/macros.ts

- [ ] Line 17 (`staticAssert(false, "macro error test")`) — squiggly on the call
- [ ] No false squigglies on the @derive or comptime lines (diagnostic suppression)

## Category 2: Completions

### src/completions.ts

- [ ] Place cursor after `c.` (line 9) — autocomplete shows `r`, `g`, `b`
- [ ] Place cursor after `result.` (line 14) — autocomplete shows `toFixed`, `toString`

## Category 3: Hover

### src/navigation.ts

- [ ] Hover over `greet` at line 9 — shows function signature `(name: string) => string`
- [ ] Hover over `msg` at line 13 — shows type `string`
- [ ] Hover over `add` at line 15 — shows function signature

### src/macros.ts

- [ ] Hover over `trailing` at line 19 — shows type `string` (not shifted)

## Category 4: Navigation

### src/navigation.ts

- [ ] Cmd+Click on `greet("world")` at line 13 — jumps to function declaration at line 9
- [ ] Cmd+Click on `add(1, 2)` at line 19 — jumps to function declaration at line 15
- [ ] Right-click `greet` → "Find All References" — shows both declaration and call

## Category 5: Macro Expansion Features

### src/macros.ts

- [ ] Right-click inside `comptime(() => 6 * 7)` → "typesugar: Expand Macro at Cursor" — opens the
      expansion in a side editor (needs `typesugar.comptimeInEditor: true` to show `42`)
- [ ] Inlay hint after `comptime(() => 6 * 7)` shows `= 42` (with `typesugar.comptimeInEditor`
      on and at least one `typescript.inlayHints.*` setting on)
- [ ] Cmd+Shift+P → "typesugar: Show Transformed Source" — opens diff view showing original vs expanded

## Category 6: Syntax Highlighting

### src/macros.ts

- [ ] `comptime` highlighted by the extension's grammar (the macro semantic tokens were removed
      with the LSP server in PEP-060 D5; only the TextMate grammar colours remain)

## Category 7: Code Actions

### src/macros.ts

### src/code-actions.ts

- [ ] Click the lightbulb on `greetng("there")` — "Change spelling to 'greeting'" is offered and
      applying it edits that call

## Pass Criteria

All checkboxes should be checked. If any fail, note the specific failure with:

- Expected behavior
- Actual behavior
- Screenshot if possible

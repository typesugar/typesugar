# Cursor Manual Verification Checklist

## Setup

1. Open Cursor
2. Open the fixture project: `File → Open Folder → /tmp/typesugar-integ-basic-project-*`
   (or run `cd integration && TYPESUGAR_TEST_MODE=local npx vitest run` first to create the /tmp project, then open it)
3. Wait for "$(zap) typesugar" to appear in the status bar (LSP server started)

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
- [ ] No false squigglies on the @derive or comptime lines (SFINAE suppression)

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

- [ ] CodeLens appears above `comptime(() => 6 * 7)` — click shows expansion
- [ ] CodeLens appears above `/** @derive(Eq, Show) */` — click shows expansion
- [ ] Inlay hint after `comptime(() => 6 * 7)` shows `= 42` (if inlay hints enabled)
- [ ] Cmd+Shift+P → "typesugar: Show Transformed Source" — opens diff view showing original vs expanded

## Category 6: Syntax Highlighting

### src/macros.ts

- [ ] `comptime` keyword highlighted in purple/bold
- [ ] `@derive` decorator highlighted in yellow/bold
- [ ] `Eq`, `Show` derive args highlighted in light blue
- [ ] `staticAssert` highlighted as macro

## Category 7: Code Actions

### src/macros.ts

- [ ] Click lightbulb on `comptime()` line — "Expand macro" action available
- [ ] Click lightbulb on `@derive` line — "Expand macro" action available

## Pass Criteria

All checkboxes should be checked. If any fail, note the specific failure with:

- Expected behavior
- Actual behavior
- Screenshot if possible

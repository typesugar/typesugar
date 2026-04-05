# Zed Manual Verification Checklist

## Setup

1. Open Zed
2. Ensure the typesugar Zed extension is installed (Extensions panel → search "typesugar")
3. Open the fixture project: `File → Open Folder → /tmp/typesugar-integ-basic-project-*`
4. Wait for LSP to start (check Zed's language server status)

**Note:** The Zed extension currently only activates for `.sts`/`.stsx` files. For `.ts` files, Zed uses its built-in TypeScript language server. The typesugar LSP features for `.ts` files (error mapping, completions after macros) are NOT available in Zed yet (PEP-034 §4A).

## STS Files (where Zed extension activates)

### Open sts-project/src/pipe-operator.sts

- [ ] Red squiggly on line 9 (`const bad: number = "wrong"`) — not shifted by `|>` desugaring
- [ ] Hover over `result` shows type info

### Open sts-project/src/hkt-syntax.sts

- [ ] Red squiggly on line 8 (`const bad: number = "wrong"`) — not shifted by `F<_>` preprocessing

## Standard .ts Files (limited — uses Zed's built-in TS)

### Open basic-project/src/diagnostics.ts

- [ ] Standard TS errors appear (Zed's built-in TS server)
- [ ] Note: @derive, pipe(), comptime() features are NOT available since typesugar LSP doesn't activate for .ts in Zed

## Known Limitations

- Zed extension only handles `.sts`/`.stsx` files
- No CodeLens, inlay hints, or semantic tokens from typesugar in Zed
- No macro expansion commands in Zed
- These are tracked in PEP-034 §4A and the future Editor Extension Robustness PEP

## Pass Criteria

STS file diagnostics should appear at correct lines. The .ts file limitations are known and documented.

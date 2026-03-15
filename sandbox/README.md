# Sandbox

Development area for experimental code and testing.

## error-showcase.ts

This file intentionally contains code that triggers typesugar diagnostic errors. It's designed for testing the VS Code plugin's error display.

**Purpose:**

- Verify that each typesugar error code renders correctly in the IDE
- Test error message quality and help suggestions
- Serve as a reference for what triggers each error

**Error codes covered:**

- TS9001: No typeclass instance found
- TS9101: Cannot auto-derive (field lacks instance)
- TS9103: Union without discriminant
- TS9104: Empty type derivation
- TS9205: Non-literal string argument
- TS9209: Runtime value in comptime
- TS9217: Static assertion failed
- TS9219: Non-constant staticAssert condition
- TS9301: Phantom HKT (doesn't use `this["__kind__"]`)
- TS9302: @hkt on class
- TS9800: Forbidden operator
- TS9801: Wrong parameter count for operator

**Excluded from:**

- ESLint (via `eslint.config.mjs`)
- Main build/typecheck (sandbox has its own `tsconfig.json`)
- Test runs

**How to use:**

1. Open `error-showcase.ts` in VS Code/Cursor
2. Ensure the typesugar plugin is active
3. Open the Problems panel (Cmd/Ctrl+Shift+M)
4. Hover over red squiggles to see full error messages

## red-team/

Adversarial test cases that probe edge cases and potential type safety holes.

- `option-attacks.test.ts` — Tests for Option type soundness
- `FINDINGS.md` — Documentation of discovered issues

// Integration test fixture: completions
//
// Test positions:
//   Line 7, char 2: completions after "c." — should include r, g, b

/** @derive(Eq) */
interface Color { r: number; g: number; b: number; }

const c: Color = { r: 0, g: 0, b: 0 };
c.

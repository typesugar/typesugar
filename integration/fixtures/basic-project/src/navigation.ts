// Integration test fixture: navigation (go-to-def, references, rename)
//
// Test positions:
//   Line 7, "greet" call: goto-def → should jump to line 0
//   Line 7, "greet" call: find-references → should find lines 0 and 7
//   Line 11, "add" call: goto-def → should jump to line 9
//   Rename "greet" → "sayHello": should rename at both lines 0 and 7

export function greet(name: string): string {
  return `Hello, ${name}!`;
}

const msg = greet("world");

function add(a: number, b: number): number {
  return a + b;
}

const sum = add(1, 2);

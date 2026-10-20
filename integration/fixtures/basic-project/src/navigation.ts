// Integration test fixture: navigation (go-to-definition, references, rename)
// in a file with no macros. The template literal matters: positions after it
// used to stop mapping (see tests/navigation.test.ts).

export function greet(name: string): string {
  return `Hello, ${name}!`;
}

const msg = greet("world");

function add(a: number, b: number): number {
  return a + b;
}

const sum = add(1, 2);

// Integration test fixture: a type error after a template literal
export function label(n: number): string {
  return `#${n}`;
}

// ERROR: must be reported on this line
const notANumber: number = "text";

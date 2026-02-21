// Expression macros
const answer = comptime(() => 6 * 7);
const pi = comptime(() => Math.PI);

// Decorator macros
@derive(Eq, Ord, Clone)
class Point {
  constructor(public x: number, public y: number) {}
}

@derive(Debug, Hash)
interface Config {
  host: string;
  port: number;
}

// Tagged template macros
const query = sql`SELECT * FROM users WHERE id = ${userId}`;
const page = html`<div>Hello, ${name}!</div>`;

// Extension methods
const s = point.show();
const c = point.clone();

// Labeled block comprehension
let: {
  x << Some(1);
  y << Some(2);
}
yield: {
  x + y;
}

// Regular TypeScript (not macros)
function add(a: number, b: number): number {
  return a + b;
}

const greeting = "Hello, world!";

// Integration test fixture: TypeScript quick fixes after macro expansions
import { pipe } from "typesugar";

/** @derive(Eq) */
interface Pair {
  a: number;
  b: number;
}

const total = pipe(
  [1, 2, 3],
  (xs: number[]) => xs.length,
  (n: number) => n * 2
);

function greeting(name: string): string {
  return "Hi, " + name;
}

// ERROR: misspelled call after the expansions; TypeScript offers "Change spelling to 'greeting'"
const hi = greetng("there");

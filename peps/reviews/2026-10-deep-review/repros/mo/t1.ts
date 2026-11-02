import { tailrec } from "typesugar";

// A: implicit fall-through (void)
@tailrec
function countdown(n: number): void {
  if (n > 0) {
    countdown(n - 1);
  }
}

// B: property names / shorthand renamed
@tailrec
function build(n: number, acc: { n: number }[]): { n: number }[] {
  if (n === 0) return acc;
  return build(n - 1, [...acc, { n }]);
}

// C: closures capturing param
@tailrec
function mk(n: number, fs: (() => number)[]): (() => number)[] {
  if (n === 0) return fs;
  fs.push(() => n);
  return mk(n - 1, fs);
}

// D: default param re-evaluation
@tailrec
function d(n: number, flag: string = "default"): string {
  if (n === 0) return flag;
  if (n === 2) return d(n - 1, "set");
  return d(n - 1);
}

// E: || tail call not transformed
@tailrec
function e(n: number): boolean {
  return n === 0 || e(n - 1);
}

// F: rest params
@tailrec
function sum(acc: number, ...xs: number[]): number {
  if (xs.length === 0) return acc;
  return sum(acc + xs[0], ...xs.slice(1));
}

// G: property access on object with param-named field
@tailrec
function g(len: number, o: { len: number }): number {
  if (len === 0) return o.len;
  return g(len - 1, o);
}

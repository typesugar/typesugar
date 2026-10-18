import { match } from "@typesugar/std";
declare function load(n: number): Promise<string>;
async function f(x: number) {
  return match(x).case(1).then(await load(1)).case(n).then(await load(n));
}

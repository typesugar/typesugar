const { transformCode } = await import("/Users/deapovey/src/personal/typesugar/packages/transformer-core/dist/index.js");
const r = transformCode(`
interface Show<A> { show(a: A): string }
/** @impl Show<number> */
const showN: Show<number> = { show: (n) => "n" + n };
export function outer(k: string) {
  const tag = (S: Show<number>, a: number): string => k + S.show(a);
  return tag(showN, 1);
}
`, { fileName: "input.ts" });
console.log(r.code);

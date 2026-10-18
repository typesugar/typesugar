const { transformCode } = await import("/Users/deapovey/src/personal/typesugar/packages/transformer/dist/index.js");
const code = `
/** @impl Functor<Array> */
const arrayFunctor = {
  map: (fa: any[], f: (a: any) => any) => fa.map(f),
};
const double = (F: { map(fa: any, f: any): any }, xs: number[]) => F.map(xs, (x: number) => x * 2);
const result = double(arrayFunctor, [1, 2, 3]);
export const help = \`Usage:

- run it
<div>

<p>hi</p>
\`;
export const sep = "a = // b";
export const y = 1;
`;
const r = transformCode(code, { fileName: "strip-test.ts" });
console.log(r.changed);
console.log(r.code);

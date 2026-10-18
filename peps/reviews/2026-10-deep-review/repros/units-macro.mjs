const R = "/Users/deapovey/src/personal/typesugar/packages/";
await import(R + "units/dist/macros.js");
const { transformCode } = await import(R + "transformer/dist/pipeline.js");
const code=`import { units } from "@typesugar/units";
export const speed = units\`100 km/h\`;
export function f() { const meters = 42; return units\`5 m\`; }
export const w = units\`5 toString\`;
`;
const r=transformCode(code,{fileName:'/Users/deapovey/src/personal/typesugar/__u.ts', verbose:true});
console.log(r.code); console.log(JSON.stringify((r.diagnostics||[]).map(d=>d.message||d.messageText)));

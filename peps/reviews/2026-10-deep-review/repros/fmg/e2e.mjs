const R = "/Users/deapovey/src/personal/typesugar/packages/";
await import(R + "graph/dist/macros.js");
await import(R + "fusion/dist/macros.js");
await import(R + "mapper/dist/macros.js");
const { transformCode } = await import(R + "transformer/dist/pipeline.js");
const which = process.argv[2];
const srcs = {
graph: `import { stateMachine } from "@typesugar/graph";
const IDLE = "Idle";
const sm = stateMachine\`
  @initial Idle
  @terminal Done
  Idle --start--> Running
  Running --stop--> Done
\`;
const sm2 = stateMachine\`
  @initial \${IDLE}
  @terminal Done
  \${IDLE} --start--> Done
\`;
export const i = sm.create();
`,
fusion: `import { fused } from "@typesugar/fusion";
declare const arr: number[];
export const r = fused(arr.map((x, i) => x * i).reduce((a, b) => a + b, 0));
`,
mapper: `import { transformInto } from "@typesugar/mapper";
interface S { id: string } interface D { id: number }
declare function get(): Promise<S>;
export async function f() { return transformInto<S, D>(await get()); }
`,
};
const r = transformCode(srcs[which], { fileName: R + which + "/__review_input.ts" });
console.log(r.code);
console.log("DIAGS:", JSON.stringify((r.diagnostics ?? []).map(d => d.message ?? d.messageText)));

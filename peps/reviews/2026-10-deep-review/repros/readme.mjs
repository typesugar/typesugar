const m = await import("/Users/deapovey/src/personal/typesugar/packages/transformer/dist/index.js");
const src = `import { derive, Eq, Ord, Clone, Json } from "@typesugar/std";
import "@typesugar/std/syntax/eq/ops";
@derive(Eq, Ord, Clone, Json)
interface User { id: number; name: string; email: string; }
const alice: User = { id: 1, name: "Alice", email: "a" };
const bob: User = { id: 2, name: "Bob", email: "b" };
export const same = alice === bob;
`;
const r = m.transformCode(src, { fileName: "/Users/deapovey/src/personal/typesugar/__readme_check.ts", strictOutput: true });
console.log(r.code.slice(0, 400));
console.log("DIAGS", JSON.stringify(r.diagnostics.map(d => d.message.slice(0, 200)), null, 1));

import { createRequire } from "module";
const require = createRequire(process.cwd() + "/package.json");
const { transformCode } = await import(process.cwd() + "/../transformer/dist/index.js");
await import(process.cwd() + "/dist/macros.js");
const code = `
import { sql, sql$ } from "@typesugar/sql";
const id: number = 5;
const w = sql\`WHERE x = \${id}\`;
const q = sql\`SELECT * FROM t \${w} AND y = \${"a"}\`;
const t = sql$\`SELECT id, name FROM users WHERE id = \${id}\`;
export { q, t };
`;
const r = transformCode(code, { fileName: process.cwd() + "/../../tests/scratch-input.ts", verbose: true });
console.log(r.code);
console.log((r.diagnostics||[]).map(d=>d.message||d.messageText));

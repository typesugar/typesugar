import { createRequire } from "module";
const require = createRequire("/Users/deapovey/src/personal/typesugar/packages/macros/package.json");
const ts = require("typescript");
const src = `import { Point } from "./point";
export const eqPoint = { equals: (l, r) => l.x === r.x };
namespace Point { export const Eq = eqPoint; }
export const p = new Point();`;
console.log(ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);

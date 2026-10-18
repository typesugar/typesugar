const core = require("/Users/deapovey/src/personal/typesugar/packages/core/dist/index.cjs");
const ts = require("/Users/deapovey/src/personal/typesugar/node_modules/typescript");
function run(src, sym, mod) {
  const sf = ts.createSourceFile("a.ts", src, ts.ScriptTarget.Latest, true);
  const c = new core.FileBindingCache(sf);
  const id = c.ensureImport(sym, mod);
  const p = ts.createPrinter();
  console.log(JSON.stringify(src.split("\n")[0]), "->", id.text, "| pending:", c.getPendingImports().map(i => p.printNode(ts.EmitHint.Unspecified, i, sf)).join(" ") || "(none)");
}
run(`import type { Point } from "./point";\nconst p: Point = null as any;`, "Point", "./point");
run(`import { type Point } from "./point";`, "Point", "./point");
run(`import Point from "./point";`, "Point", "./point");
run(`function f(map: number) { return 1 }`, "map", "@typesugar/fp");
run(`import Eq = require("./x");`, "Eq", "@typesugar/std");
run(`import * as Eq from "./x";`, "Eq", "@typesugar/std");

const core = require("/Users/deapovey/src/personal/typesugar/packages/core/dist/index.cjs");
const ts = require("/Users/deapovey/src/personal/typesugar/node_modules/typescript");
const sf = ts.createSourceFile("t.ts", `(42).clamp(0, 100); // @ts-no-typesugar  // one line\nconst s = "@ts-no-typesugar"; a === b;\n// @ts-no-typesugar operators\nx.y();`, ts.ScriptTarget.Latest, true);
const tr = new core.ResolutionScopeTracker();
for (const f of [undefined, "extensions", "macros"]) console.log("line1 feature", f, core.hasInlineOptOut(sf, sf.statements[0], f), "isInOptedOutScope:", core.isInOptedOutScope(sf, sf.statements[0], tr, f));
console.log("string-literal line2 (no feature):", core.hasInlineOptOut(sf, sf.statements[2]));

const P = "/Users/deapovey/src/personal/typesugar/packages/eslint-plugin";
const { Linter } = await import(P + "/node_modules/eslint/lib/api.js");
const plugin = (await import(P + "/dist/index.js")).default;
const proc = plugin.processors.typesugar;
const src = `type Lift<F, A> = { run: F<A>; again: F<A>; more: F<A> };\nvar x = 1;\nexport { x };\n`;
console.log("preprocessed:", JSON.stringify(proc.preprocess(src, "/tmp/h.ts")[0]));
const linter = new Linter({ configType: "flat", cwd: "/tmp" });
const config = [{ files: ["**/*.ts", "**/*"], ...plugin.configs.recommended, rules: { "no-var": "error" } }];
console.log(linter.verify(src, config, { filename: "/tmp/h.ts" }).map(m => `${m.line}:${m.column}-${m.endLine}:${m.endColumn} ${m.ruleId ?? m.message}`));

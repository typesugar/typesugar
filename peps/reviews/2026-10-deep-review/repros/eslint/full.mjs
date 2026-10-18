const P = "/Users/deapovey/src/personal/typesugar/packages/eslint-plugin";
const { Linter } = await import(P + "/node_modules/eslint/lib/api.js");
const plugin = (await import(P + "/dist/index.js")).default;
const cwd = process.cwd();
const linter = new Linter({ configType: "flat", cwd });
const config = [{ files: ["**/*.ts", "**/*"], ...plugin.configs.full, rules: { "no-var": "error" } }];
const buffer = `var x = 1;\nexport { x };\n`;   // unsaved editor buffer; disk has different content
const msgs = linter.verify(buffer, config, { filename: cwd + "/a.ts" });
console.log("messages for buffer with a 'var':", msgs.map(m => `${m.line}:${m.column} ${m.ruleId} ${m.message}`));

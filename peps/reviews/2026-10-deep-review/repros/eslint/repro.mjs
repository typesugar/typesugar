const P = "/Users/deapovey/src/personal/typesugar/packages/eslint-plugin";
const { Linter } = await import(P + "/node_modules/eslint/lib/api.js");
const plugin = (await import(P + "/dist/index.js")).default;
const linter = new Linter({ configType: "flat", cwd: "/tmp" });
const config = [{ files: ["**/*.ts", "**/*"], ...plugin.configs.recommended, rules: { "no-var": "error", "prefer-const": "error", semi: "error" } }];
const src = `@derive(Eq)\nclass A {}\nvar x = 1\nconsole.log(x)\n`;
const r = linter.verifyAndFix(src, config, { filename: "/tmp/a.ts" });
console.log("FIXED:\n" + r.output);
console.log(r.messages.map(m => `${m.line}:${m.column} ${m.ruleId} ${m.message}`));
const lint = linter.verify(src, config, { filename: "/tmp/a.ts" });
console.log(lint.map(m => `${m.line}:${m.column} ${m.ruleId} ${JSON.stringify(m.fix)}`));
// nested-brace requires block
const src2 = `function f(x) {\n  requires: {\n    if (x) {\n      x;\n    }\n    x;\n  }\n  return x;\n}\n`;
console.log(linter.verify(src2, config, { filename: "/tmp/b.ts" }).map(m => `${m.line}:${m.column} ${m.message}`));
// object literal key named ensures
const src3 = `const o = {\n  ensures: {\n    a: 1\n  },\n  b: 2,\n};\nconsole.log(o)\n`;
console.log(linter.verify(src3, config, { filename: "/tmp/c.ts" }).map(m => `${m.line}:${m.column} ${m.message}`));

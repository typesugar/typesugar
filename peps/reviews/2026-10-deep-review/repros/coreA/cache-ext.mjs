const T = await import('/Users/deapovey/src/personal/typesugar/packages/transformer/dist/index.js');
const dir = '/Users/deapovey/src/personal/typesugar/packages/transformer/';
const cacheDir = process.argv[2];
const a = `import { registerExtension } from "typesugar";\nfunction shout(s: string): string { return s.toUpperCase(); }\nregisterExtension("string", shout);\nconst s: string = "hi";\nconsole.log(s.shout());\n`;
const r = T.transformCode(a, { fileName: dir + '__review_c.ts', cacheDir });
console.log(r.code); T.saveExpansionCache(); console.log("stats", T.getExpansionCacheStats());

const T = await import('/Users/deapovey/src/personal/typesugar/packages/transformer/dist/index.js');
const dir = '/Users/deapovey/src/personal/typesugar/packages/transformer/';
const a = `import { extension } from "typesugar";\n/** @extension */\n@extension\nfunction clamp(n: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, n)); }\nconsole.log(clamp(5,0,1));\n`;
const b = `const x: number = 5;\nconsole.log(x.clamp(0, 1));\n`;
const ra = T.transformCode(a, { fileName: dir + '__review_a.ts' });
console.log('--- A ---\n' + ra.code);
const rb = T.transformCode(b, { fileName: dir + '__review_b.ts' });
console.log('--- B (no import, separate pipeline) ---\n' + rb.code);

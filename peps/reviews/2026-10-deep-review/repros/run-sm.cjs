const tc = require("/Users/deapovey/src/personal/typesugar/packages/transformer-core/dist/index.cjs");
// generated line 0: col0 -> src(0,0), col20 -> src(0,10)
// VLQ: "AAAA" = [0,0,0,0]; next segment delta gen +20 ("oB"), src 0 ("A"), line 0 ("A"), col +10 ("U")
const map = { version: 3, sources: ["a.ts"], names: [], mappings: "AAAA,oBAAU" };
const d = tc.decodeSourceMap ? tc.decodeSourceMap(map) : null;
console.log(JSON.stringify(d && d.mappings));
console.log("gen for src col 12 (expect col 22):", JSON.stringify(tc.findGeneratedPosition(d, 0, 12)));
console.log("orig for gen col 22 (expect col 12):", JSON.stringify(tc.findOriginalPosition(d, 0, 22)));

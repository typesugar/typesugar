import { multi } from "./mf.mjs";
const cases = {
 array: `/** @derive(Eq) */\nexport interface TA { tags: string[] }`,
 optional: `/** @derive(Eq) */\nexport interface TO { name?: string; n: number }`,
 nested: `/** @derive(Eq) */\nexport interface PN { x: number }\n/** @derive(Eq) */\nexport interface LN { a: PN; b: PN }`,
 showopt: `/** @derive(Show) */\nexport interface SO { name?: string; n: number }`,
};
for (const [k, src] of Object.entries(cases)) {
  const r = multi({ ["/p/" + k + ".ts"]: src }, "/p/" + k + ".ts", k);
}

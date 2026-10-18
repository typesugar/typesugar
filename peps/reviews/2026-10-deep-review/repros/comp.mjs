const { transformCode } = await import("/Users/deapovey/src/personal/typesugar/packages/transformer/dist/index.js");
const src = `
import { Effect } from "effect";
import "@typesugar/effect/syntax/do";

const getUser = (userId: string) =>
let: {
  user << Effect.succeed({ id: userId, name: "Alice" });
}
yield: { user }
`;
const dir = process.argv[2];
for (const n of [1, 2]) {
  const r = transformCode(src, { fileName: dir + "/src/comp" + n + ".ts" });
  console.log("run", n, "errors:", r.diagnostics.filter(d => d.severity === "error").length, "| has flatMap:", /flatMap|gen\(|andThen|map\(/.test(r.code));
  console.log(r.code.split("\n").filter(l=>l.trim()).slice(2, 6).join(" / "));
}

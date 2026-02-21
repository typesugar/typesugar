const ts = require("typescript");

function scan(text) {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    text
  );
  let token = scanner.scan();
  const tokens = [];
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    tokens.push({
      kind: ts.tokenToString(token) || token,
      text: scanner.getTokenText(),
      start: scanner.getTokenPos(),
      end: scanner.getTextPos(),
    });
    token = scanner.scan();
  }
  return tokens;
}

console.log("--- x<|y ---");
console.log(scan("x<|y"));

console.log("\n--- x::y ---");
console.log(scan("x::y"));

console.log("\n--- x |> y ---");
console.log(scan("x |> y"));

console.log("\n--- x<| y (space) ---");
console.log(scan("x<| y"));

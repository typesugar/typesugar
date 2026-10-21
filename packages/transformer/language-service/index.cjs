// Entry point tsserver loads for `{ "name": "@typesugar/transformer/language-service" }`
// in tsconfig.json. tsserver resolves plugins without package.json "exports", so
// it reaches this directory, and it requires `module.exports` to BE the plugin
// factory. The CommonJS build exports `{ default, ...named }`, so unwrap it here
// (keeping the named exports on the function for anyone who reads them).
const mod = require("../dist/language-service.cjs");
module.exports = Object.assign(mod.default, mod);

//! cfg() — Dead Code Elimination
//! Conditional compilation: debug code vanishes in production

import { cfg, comptime, staticAssert } from "typesugar";

// cfg(condition, ifTrue, ifFalse) evaluates at COMPILE TIME.
// When the condition is false, the entire branch is eliminated —
// not just skipped at runtime, but physically absent from the output.

const MODE = comptime(() => "production");
staticAssert(MODE === "production" || MODE === "debug");

// cfg() strips debug-only code from production builds
const debugBanner = cfg("debug", "🐛 DEBUG MODE ACTIVE", "");
const logLevel = cfg("debug", "trace", "error");

// This entire function body would vanish in a production build
const diagnostics = cfg("debug", () => ({
  heapUsed: 0,
  uptime: 0,
  version: "dev",
}), null);

// Feature flags via cfg — disabled features are removed entirely
const betaFeature = cfg("features.beta", "✨ Beta UI enabled", "Standard UI");

console.log("mode:", MODE);
console.log("log level:", logLevel);
console.log("banner:", debugBanner || "(none)");
console.log("beta:", betaFeature);
console.log("diagnostics:", diagnostics);

// 👀 Check JS Output — cfg() calls become their resolved values.
//    In a production build with debug=false, the debug branches
//    and their closures are completely eliminated from the bundle.
// Try: imagine switching cfg from "debug"=false to "debug"=true

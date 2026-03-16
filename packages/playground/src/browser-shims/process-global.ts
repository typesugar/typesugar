/**
 * Process Global Injection for Browser
 *
 * This file is injected by esbuild to provide a global `process` object
 * in browser environments.
 */

import processShim from "./process.js";

if (typeof globalThis !== "undefined" && !globalThis.process) {
  (globalThis as Record<string, unknown>).process = processShim;
}

if (typeof window !== "undefined" && !(window as Record<string, unknown>).process) {
  (window as Record<string, unknown>).process = processShim;
}

/**
 * Browser Bundle Entry Point
 *
 * This file is the entry point for the browser bundle (ESM).
 * It re-exports everything from the main index and ensures all
 * dependencies are bundled together for browser use.
 */

import "./browser-shims/process-global.js";

export * from "./index.js";

import * as ts from "typescript";

export { ts };

export const VERSION = "0.1.0";

export function isReady(): boolean {
  return typeof globalThis !== "undefined";
}

/**
 * Browser Bundle Entry Point
 *
 * Re-exports the main index for browser consumption.
 * The browser transformer fallback has been removed (PEP-017 Wave 3) —
 * all compilation now goes through the server endpoint.
 */

export * from "./index.js";

export { default as ts } from "typescript";

export const VERSION = "0.1.0";

export function isReady(): boolean {
  return typeof globalThis !== "undefined";
}

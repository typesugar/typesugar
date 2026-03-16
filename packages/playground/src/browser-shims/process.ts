/**
 * Browser Shim for Node.js 'process'
 *
 * Provides a minimal process object for code that accesses process.env
 * in a browser environment.
 */

export const env: Record<string, string | undefined> = {
  NODE_ENV: "production",
};

export const platform = "browser";
export const version = "";
export const versions = {};

export const cwd = () => "/";
export const nextTick = (fn: () => void) => Promise.resolve().then(fn);

export default {
  env,
  platform,
  version,
  versions,
  cwd,
  nextTick,
};

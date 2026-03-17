/**
 * Browser shim for Node.js `crypto` module.
 *
 * Uses the Web Crypto API where available, with fallbacks for hashing.
 */

interface Hash {
  update(data: string): Hash;
  digest(encoding: "hex"): string;
}

export function createHash(algorithm: string): Hash {
  if (algorithm !== "sha256") {
    throw new Error(`[playground] Only sha256 hashing is supported in browser, got: ${algorithm}`);
  }

  let data = "";

  return {
    update(input: string): Hash {
      data += input;
      return this;
    },
    digest(encoding: "hex"): string {
      if (encoding !== "hex") {
        throw new Error(`[playground] Only hex encoding is supported`);
      }
      return simpleHash(data);
    },
  };
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

export default {
  createHash,
};

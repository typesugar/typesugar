/**
 * Browser shim for Node.js `path` module.
 *
 * Provides path manipulation utilities that work in the browser.
 */

export const sep = "/";
export const delimiter = ":";

export function join(...paths: string[]): string {
  return paths.join("/").replace(/\/+/g, "/");
}

export function resolve(...paths: string[]): string {
  let resolved = "";
  for (let i = paths.length - 1; i >= 0 && !isAbsolute(resolved); i--) {
    const path = paths[i];
    if (path) {
      resolved = path + "/" + resolved;
    }
  }
  return normalize(resolved);
}

export function normalize(path: string): string {
  const parts = path.split("/").filter(Boolean);
  const result: string[] = [];
  for (const part of parts) {
    if (part === "..") {
      result.pop();
    } else if (part !== ".") {
      result.push(part);
    }
  }
  const normalized = result.join("/");
  return path.startsWith("/") ? "/" + normalized : normalized;
}

export function dirname(path: string): string {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  const dir = parts.join("/");
  return path.startsWith("/") ? "/" + dir : dir || ".";
}

export function basename(path: string, ext?: string): string {
  let base = path.split("/").pop() || "";
  if (ext && base.endsWith(ext)) {
    base = base.slice(0, -ext.length);
  }
  return base;
}

export function extname(path: string): string {
  const base = basename(path);
  const dotIndex = base.lastIndexOf(".");
  return dotIndex > 0 ? base.slice(dotIndex) : "";
}

export function isAbsolute(path: string): boolean {
  return path.startsWith("/");
}

export function relative(from: string, to: string): string {
  const fromParts = normalize(from).split("/").filter(Boolean);
  const toParts = normalize(to).split("/").filter(Boolean);

  let commonLength = 0;
  for (let i = 0; i < Math.min(fromParts.length, toParts.length); i++) {
    if (fromParts[i] !== toParts[i]) break;
    commonLength++;
  }

  const upCount = fromParts.length - commonLength;
  const result = [...Array(upCount).fill(".."), ...toParts.slice(commonLength)];
  return result.join("/") || ".";
}

export const posix = {
  sep,
  delimiter,
  join,
  resolve,
  normalize,
  dirname,
  basename,
  extname,
  isAbsolute,
  relative,
};

export default {
  sep,
  delimiter,
  join,
  resolve,
  normalize,
  dirname,
  basename,
  extname,
  isAbsolute,
  relative,
  posix,
};

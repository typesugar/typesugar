/**
 * Browser shim for Node.js `fs` module.
 *
 * File system operations are not available in the browser playground.
 * This shim provides helpful error messages for macros that try to use fs.
 */

export function readFileSync(path: string, _encoding?: string): never {
  throw new Error(
    `[playground] File system access is not available in the browser.\n` +
      `Cannot read file: "${path}"\n` +
      `The includeStr(), includeJson(), and includeBytes() macros require Node.js.`
  );
}

export function writeFileSync(_path: string, _data: string): never {
  throw new Error(
    `[playground] File system access is not available in the browser.\n` +
      `Cannot write files in the playground.`
  );
}

export function existsSync(_path: string): boolean {
  return false;
}

export function mkdirSync(_path: string, _options?: { recursive?: boolean }): void {
  // No-op in browser
}

export function unlinkSync(_path: string): void {
  // No-op in browser
}

export function readdirSync(_path: string): string[] {
  return [];
}

export default {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  readdirSync,
};

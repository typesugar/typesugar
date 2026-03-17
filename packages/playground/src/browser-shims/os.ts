/**
 * Browser Shim for Node.js 'os'
 */
export function platform() {
  return "browser";
}
export function arch() {
  return "wasm";
}
export function tmpdir() {
  return "/tmp";
}
export function homedir() {
  return "/";
}
export function hostname() {
  return "localhost";
}
export function type() {
  return "Browser";
}
export function release() {
  return "0.0.0";
}
export function cpus() {
  return [];
}
export function totalmem() {
  return 0;
}
export function freemem() {
  return 0;
}
export function networkInterfaces() {
  return {};
}
export const EOL = "\n";

export default {
  platform,
  arch,
  tmpdir,
  homedir,
  hostname,
  type,
  release,
  cpus,
  totalmem,
  freemem,
  networkInterfaces,
  EOL,
};

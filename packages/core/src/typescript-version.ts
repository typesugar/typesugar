/**
 * TypeScript-major guard (PEP-060 item 1).
 *
 * typesugar's engine is built on TypeScript's JavaScript compiler API
 * (`ts.factory`, `ts.createProgram`, transformers, the type checker). That API
 * exists in TypeScript 5.x and 6.x (typesugar needs 5.9 or later, see
 * `MIN_MINOR` below). TypeScript 7 (`typescript@7`, the native Go
 * port) removed it: the package root exports only `version`/`versionMajorMinor`,
 * and the compiler lives behind an unstable IPC API with no transformer hook.
 *
 * Without this guard, a project with TS 7 installed fails on the first top-level
 * `ts.ScriptTarget.ES2022` or `ts.factory.*` access with an opaque
 * "Cannot read properties of undefined". Every host (the transformer,
 * transformer-core, `@typesugar/macros`, unplugin, the tsserver plugin, the LSP
 * server and the ESLint plugin) calls {@link assertSupportedTypeScript} once,
 * before it first touches the compiler API, so the user sees one actionable
 * message instead.
 *
 * This module only reads `version`/`versionMajorMinor`/`factory`/`createProgram`
 * from the module it is given, so it is safe to call on a TS-7-shaped module.
 */

import * as ts from "typescript";

/** The `typescript` range typesugar's compiler-facing packages support. */
export const SUPPORTED_TYPESCRIPT_RANGE = ">=5.9.0 <7.0.0";

/**
 * The oldest TypeScript typesugar runs on. Measured, not guessed (PEP-060
 * item 1, 2026-10-19, build + typecheck + core/transformer-core/macros/
 * transformer/std/fp tests per version):
 * - < 5.5: `import * as ts from "typescript"` in Node ESM yields no named
 *   exports (TypeScript only added the cjs-module-lexer hints in 5.5), so every
 *   ESM entry (the CLI, unplugin under Vite) dies on its first `ts.X` access;
 *   5.0–5.3 also lack `checker.isTypeAssignableTo`, `Scanner.getTokenStart`
 *   and `ImportDeclaration.attributes`.
 * - 5.5–5.8: no `checker.getNonPrimitiveType()` (and before 5.8 no
 *   `getUnknownType()`), so an `@impl X<object>` (or `X<unknown>`) instance
 *   silently never resolves.
 * 5.9.3 (the lockfile's version, every CI job) and 6.0.3 pass.
 */
const MIN_MAJOR = 5;
const MIN_MINOR = 9;

/** Troubleshooting entry the guard's message links to. */
export const TYPESCRIPT_SUPPORT_URL =
  "https://typesugar.org/getting-started/troubleshooting#typescript-7";

const INSTALL_HINT =
  `Install typescript@6 (or 5.${MIN_MINOR}+) as a devDependency for typesugar ` +
  `(npm i -D typescript@6); see ${TYPESCRIPT_SUPPORT_URL}`;

/** Thrown by {@link assertSupportedTypeScript} for a TypeScript typesugar cannot run on. */
export class UnsupportedTypeScriptError extends Error {
  /** The `version` the rejected module reported (`"unknown"` if none). */
  readonly typescriptVersion: string;

  constructor(message: string, typescriptVersion: string) {
    super(message);
    this.name = "UnsupportedTypeScriptError";
    this.typescriptVersion = typescriptVersion;
  }
}

interface TypeScriptLike {
  version?: unknown;
  versionMajorMinor?: unknown;
  factory?: unknown;
  createProgram?: unknown;
  default?: unknown;
}

/**
 * ESM-interop wrappers (`import ts from "typescript"` through some bundlers)
 * can put the real module under `default`. Prefer whichever object actually
 * carries a `version`.
 */
function unwrap(tsModule: unknown): TypeScriptLike {
  const mod = (tsModule ?? {}) as TypeScriptLike;
  if (typeof mod.version !== "string" && mod.default && typeof mod.default === "object") {
    return mod.default as TypeScriptLike;
  }
  return mod;
}

/**
 * Why `tsModule` can't host typesugar, or `undefined` if it can.
 *
 * Rejects: TypeScript 7 or later (by major, regardless of shape); TypeScript
 * older than 5.9; and any module missing `ts.factory` / `ts.createProgram`
 * (a TS-7-shaped or otherwise stripped module that misreports its version).
 */
export function getUnsupportedTypeScriptReason(tsModule: unknown): string | undefined {
  const mod = unwrap(tsModule);
  const version = typeof mod.version === "string" ? mod.version : "unknown";
  const majorMinor = typeof mod.versionMajorMinor === "string" ? mod.versionMajorMinor : version;
  const major = Number.parseInt(majorMinor, 10);

  if (Number.isFinite(major) && major >= 7) {
    return (
      `[typesugar] TypeScript ${version} is not supported: TypeScript 7 removed the ` +
      `JavaScript compiler API that typesugar's transformer needs. ${INSTALL_HINT}`
    );
  }
  const minor = Number.parseInt(majorMinor.split(".")[1] ?? "", 10);
  if (
    Number.isFinite(major) &&
    (major < MIN_MAJOR || (major === MIN_MAJOR && Number.isFinite(minor) && minor < MIN_MINOR))
  ) {
    return (
      `[typesugar] TypeScript ${version} is not supported: typesugar needs TypeScript ` +
      `${MIN_MAJOR}.${MIN_MINOR} or later (${SUPPORTED_TYPESCRIPT_RANGE}). ${INSTALL_HINT}`
    );
  }
  // Node's ESM view of a CJS module may expose only some names directly, with
  // the full module under `default`; accept the API from either.
  const full =
    mod.default && typeof mod.default === "object" ? (mod.default as TypeScriptLike) : mod;
  const factory = mod.factory ?? full.factory;
  const createProgram = mod.createProgram ?? full.createProgram;
  if (factory === undefined || typeof createProgram !== "function") {
    return (
      `[typesugar] The "typescript" module (version ${version}) does not expose the ` +
      `JavaScript compiler API (ts.factory / ts.createProgram are missing) that ` +
      `typesugar's transformer needs. ${INSTALL_HINT}`
    );
  }
  return undefined;
}

/** Modules already accepted, so repeat calls from several hosts cost nothing. */
const accepted = new WeakSet<object>();

/**
 * Throw an {@link UnsupportedTypeScriptError} with one actionable message if
 * `tsModule` (default: the `typescript` this package resolves) can't host
 * typesugar. Call once per host, before the first compiler-API access.
 */
export function assertSupportedTypeScript(tsModule: unknown = ts): void {
  const key = typeof tsModule === "object" && tsModule !== null ? tsModule : undefined;
  if (key && accepted.has(key)) return;
  const reason = getUnsupportedTypeScriptReason(tsModule);
  if (reason !== undefined) {
    const version = unwrap(tsModule).version;
    throw new UnsupportedTypeScriptError(reason, typeof version === "string" ? version : "unknown");
  }
  if (key) accepted.add(key);
}

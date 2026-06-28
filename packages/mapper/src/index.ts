/**
 * @typesugar/mapper — runtime entry (PEP-050).
 *
 * This `.` entry is **runtime-only** and does NOT import `typescript`. It exposes
 * the runtime API surface (stubs + types) that application code calls.
 *
 * The macro *definitions* (which import `typescript`) live in the `./macros` entry,
 * loaded by the transformer at build time. See PEP-050.
 */

export * from "./api.js";

/**
 * TypeScript-major guard for `@typesugar/macros` (PEP-060 item 1).
 *
 * Several macro modules read the compiler API at module load (for example
 * `comptime`'s `ts.ScriptTarget.ES2022` transpile options), so under
 * TypeScript 7 — whose root entry exports only `version` — loading this package
 * used to fail with an opaque "Cannot read properties of undefined". This module
 * is the FIRST import of `index.ts`, so the version check runs before any of
 * them and the user sees one actionable message instead.
 */

import * as ts from "typescript";
import { assertSupportedTypeScript } from "@typesugar/core";

assertSupportedTypeScript(ts);

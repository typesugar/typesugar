/**
 * @typesugar/sql — Macro definitions (BUILD-TIME ONLY).
 *
 * This entry (transitively) imports `typescript` and is loaded by the transformer
 * at build time (via the `./macros` subpath). It must NOT be imported by
 * application runtime code — the runtime values, types, and macro-emitted helpers
 * (`__sql_build`, `sql`, `Fragment`, the query builder, typeclasses, …) live in the
 * package's `.` entry. See PEP-050.
 *
 * Provides the compile-time macros: `sql`, `sql$`/`@schema`, `@deriving(Meta)`,
 * and `@deriving(Read|Write|Codec)`, plus the `validateSqlSyntax` macro util and
 * the `registerSchema` compile-time registration helper.
 */

import { globalRegistry } from "@typesugar/core";

import { sqlMacro } from "./macro.js";
import { sql$Macro, schemaMacro } from "./infer-macro.js";
import { deriveMetaMacro } from "./derive-meta.js";
import { deriveReadMacro, deriveWriteMacro, deriveCodecMacro } from "./derive-typeclasses.js";

// Re-export the macro definitions + compile-time helpers.
export { sqlMacro } from "./macro.js";
export { sql$Macro, schemaMacro, registerSchema } from "./infer-macro.js";
export { deriveMetaMacro } from "./derive-meta.js";
export { deriveReadMacro, deriveWriteMacro, deriveCodecMacro } from "./derive-typeclasses.js";
export { validateSqlSyntax } from "./macro-utils.js";

// ============================================================================
// Registration
// ============================================================================

export function register(): void {
  globalRegistry.register(sqlMacro);
  globalRegistry.register(sql$Macro);
  globalRegistry.register(schemaMacro);
  globalRegistry.register(deriveMetaMacro);
  globalRegistry.register(deriveReadMacro);
  globalRegistry.register(deriveWriteMacro);
  globalRegistry.register(deriveCodecMacro);
}

// Auto-register on import (the transformer loads this entry for its side effects).
register();

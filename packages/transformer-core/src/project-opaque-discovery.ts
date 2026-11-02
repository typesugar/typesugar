/**
 * `@opaque` types declared in the program's own source files, registered
 * before any file is transformed.
 *
 * The `@opaque` attribute macro registers a type's rewrite when the file that
 * declares it is transformed. A consumer transformed earlier (`typesugar
 * expand use.ts`, the language service, a bundler that reaches the consumer
 * first) found nothing, so its `a.map(f)` stayed a method call on a value
 * that is really `A | null`. `.d.ts` types have their own discovery
 * (`discoverOpaqueTypesFromImports`); this is the same for source.
 */

import * as ts from "typescript";
import {
  ResolutionScopeTracker,
  isInOptedOutScope,
  isJSDocTagAtLineStart,
  scanImportsForScope,
} from "@typesugar/core";
import { registerOpaqueInterface } from "@typesugar/macros";
import { jsDocTagMacroName } from "./macro-helpers.js";

const registeredPrograms = new WeakSet<ts.Program>();

/**
 * Register every `@opaque` interface declared in `program`'s own source
 * files (not `.d.ts`, not external libraries), once per program, exactly as
 * the attribute macro would when its file is transformed (which registers the
 * same entry again): only where the macro would run — the tag starts a line,
 * the declaring file activates `@opaque` (imports typesugar), and isn't opted
 * out.
 *
 * Shape (CLAUDE.md "Resolving things a macro just generated"): a scan of the
 * source as written, bound once at the start of the pass. That is safe here
 * because nothing it reads is synthesized: the `@opaque` tag, the interface
 * and its companion functions are all in the source before any pass starts.
 * A consumer's reference is still matched to an entry by identity (the
 * erasure pass resolves the symbol and checks the entry's declaring file).
 */
export function registerProgramOpaqueTypes(program: ts.Program, verbose?: boolean): void {
  if (registeredPrograms.has(program)) return;
  registeredPrograms.add(program);

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile || program.isSourceFileFromExternalLibrary(sourceFile)) {
      continue;
    }
    if (!sourceFile.text.includes("@opaque")) continue;
    const declarations = opaqueInterfaces(sourceFile.statements);
    if (declarations.length === 0) continue;

    const scope = new ResolutionScopeTracker();
    scanImportsForScope(sourceFile, scope, program);
    for (const iface of declarations) {
      if (isInOptedOutScope(sourceFile, iface, scope, "macros")) continue;
      try {
        // An error (no underlying type) is the macro's to report, when the
        // declaring file is transformed.
        registerOpaqueInterface(iface, sourceFile, program.getTypeChecker());
        if (verbose) {
          console.log(
            `[typesugar] @opaque ${iface.name.text} registered from ${sourceFile.fileName}`
          );
        }
      } catch (e) {
        console.warn(
          `[typesugar] could not register @opaque ${iface.name.text} from ${sourceFile.fileName} ` +
            `ahead of its file: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
  }
}

/** Interfaces (top level, or in a namespace) whose `@opaque` tag would trigger the macro. */
function opaqueInterfaces(statements: readonly ts.Statement[]): ts.InterfaceDeclaration[] {
  const out: ts.InterfaceDeclaration[] = [];
  for (const stmt of statements) {
    if (ts.isModuleDeclaration(stmt) && stmt.body && ts.isModuleBlock(stmt.body)) {
      out.push(...opaqueInterfaces(stmt.body.statements));
      continue;
    }
    if (!ts.isInterfaceDeclaration(stmt)) continue;
    const triggers = ts
      .getJSDocTags(stmt)
      .some(
        (tag) =>
          tag.tagName.text === "opaque" &&
          isJSDocTagAtLineStart(tag) &&
          jsDocTagMacroName(tag, stmt) === "opaque"
      );
    if (triggers) out.push(stmt);
  }
  return out;
}

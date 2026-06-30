/**
 * Typeclass declaration index (PEP-052).
 *
 * A generic, registry-free source of typeclass operator/method metadata. Given a
 * `ts.Program`, it discovers every `@typeclass`-annotated interface in scope and
 * reads each member's `@op <token>` JSDoc tag, producing a per-typeclass map from
 * operator token → method name (and the set of method names).
 *
 * This replaces the hardcoded `STANDARD_TYPECLASS_DEFS` + global `typeclassRegistry`
 * for the operator/method-resolution path: the compiler special-cases no typeclass,
 * and a third-party `@typeclass` is read identically to std's. The index caches its
 * result per `ts.Program`; watch/LSP rebuilds produce a fresh program, so the cache
 * invalidates naturally.
 *
 * @packageDocumentation
 */

import * as ts from "typescript";
import { extractOpFromJSDoc, getStandardTypeclassOpInfos } from "./typeclass.js";

/** Operator/method metadata for a single typeclass, read from its declaration. */
export interface TypeclassOpInfo {
  /** The typeclass name (e.g., "Eq"). */
  name: string;
  /** Map from operator token (e.g., "===") to the method it dispatches to (e.g., "equals"). */
  opToMethod: Map<string, string>;
  /** All method names declared by the typeclass interface. */
  methodNames: Set<string>;
  /**
   * Operators that two same-named declarations mapped to DIFFERENT methods — the
   * bare name is ambiguous for these, so they are excluded from `opToMethod` and
   * yield no operator candidate (native fallback).
   */
  conflictedOps: Set<string>;
}

const indexCache = new WeakMap<ts.Program, Map<string, TypeclassOpInfo>>();

/** Does this declaration carry a `@typeclass` JSDoc tag? */
function hasTypeclassTag(node: ts.Node): boolean {
  return ts.getJSDocTags(node).some((tag) => tag.tagName.text === "typeclass");
}

/** Read a single `@typeclass` interface declaration into a {@link TypeclassOpInfo}. */
function readTypeclassInterface(iface: ts.InterfaceDeclaration): TypeclassOpInfo {
  const opToMethod = new Map<string, string>();
  const methodNames = new Set<string>();

  for (const member of iface.members) {
    if (!member.name || !ts.isIdentifier(member.name)) continue;
    const methodName = member.name.text;
    methodNames.add(methodName);

    const op = extractOpFromJSDoc(member);
    if (op) opToMethod.set(op, methodName);
  }

  return { name: iface.name.text, opToMethod, methodNames, conflictedOps: new Set() };
}

/** Build (and cache) the typeclass index for a program. */
function buildIndex(program: ts.Program): Map<string, TypeclassOpInfo> {
  const cached = indexCache.get(program);
  if (cached) return cached;

  const index = new Map<string, TypeclassOpInfo>();

  // Seed with the built-in standard typeclass metadata (plain static data) so
  // standard typeclasses (Eq/Ord/Show/…) resolve even when their interface isn't
  // in the program's source. Source `@typeclass` interfaces below merge over this.
  for (const info of getStandardTypeclassOpInfos()) {
    index.set(info.name, {
      name: info.name,
      opToMethod: new Map(info.opToMethod),
      methodNames: new Set(info.methodNames),
      conflictedOps: new Set(),
    });
  }

  // Names that came from the built-in seed. The FIRST source `@typeclass`
  // declaration of such a name is authoritative and REPLACES the seed (rather than
  // merging) — otherwise the built-in `Eq` would mask/conflict with a user `Eq`
  // that maps the same operator to a different method. Subsequent same-name source
  // declarations then merge against the (now source-authoritative) entry.
  const seededNames = new Set(index.keys());

  for (const sourceFile of program.getSourceFiles()) {
    // Default lib files (lib.es*.d.ts) never carry @typeclass — skip the scan cost.
    if (program.isSourceFileDefaultLibrary(sourceFile)) continue;

    for (const stmt of sourceFile.statements) {
      if (!ts.isInterfaceDeclaration(stmt)) continue;
      if (!hasTypeclassTag(stmt)) continue;

      const info = readTypeclassInterface(stmt);
      if (seededNames.has(info.name)) {
        // First source declaration overrides the built-in seed.
        index.set(info.name, info);
        seededNames.delete(info.name);
        continue;
      }
      const existing = index.get(info.name);
      if (existing) {
        // Same-named typeclass declared in multiple modules (e.g. std `Eq` vs a
        // third-party `Eq`). Union the method names. For op→method mappings: if the
        // two declarations AGREE, keep it; if they CONFLICT (map the same operator
        // to different methods), the bare name is ambiguous — drop that op entirely
        // so the operator falls back to native rather than emitting a call to a
        // method the resolved instance may not implement (silent miscompile).
        // A fully correct fix keys activation by declaring module, not bare name.
        for (const [op, method] of info.opToMethod) {
          if (existing.conflictedOps.has(op)) continue;
          const prev = existing.opToMethod.get(op);
          if (prev === undefined) {
            existing.opToMethod.set(op, method);
          } else if (prev !== method) {
            existing.opToMethod.delete(op);
            existing.conflictedOps.add(op);
          }
        }
        for (const m of info.methodNames) existing.methodNames.add(m);
      } else {
        index.set(info.name, info);
      }
    }
  }

  indexCache.set(program, index);
  return index;
}

/**
 * Get the operator/method metadata for a typeclass by name, read generically from
 * its `@typeclass` declaration in the program. Returns `undefined` if no such
 * typeclass is declared.
 */
export function getOpMapForTypeclass(
  program: ts.Program,
  tcName: string
): TypeclassOpInfo | undefined {
  return buildIndex(program).get(tcName);
}

/**
 * Among a set of activated typeclasses, find those whose declaration maps the
 * given operator token, returning `{ typeclass, method }` candidates. This is the
 * registry-free replacement for `getSyntaxForOperator`, scoped to the typeclasses
 * the using file actually activated via `@syntax-operators` imports.
 */
export function getOperatorCandidates(
  program: ts.Program,
  activatedTypeclasses: Iterable<string>,
  op: string
): Array<{ typeclass: string; method: string }> {
  const candidates: Array<{ typeclass: string; method: string }> = [];
  for (const tc of activatedTypeclasses) {
    const info = getOpMapForTypeclass(program, tc);
    const method = info?.opToMethod.get(op);
    if (method) candidates.push({ typeclass: tc, method });
  }
  return candidates;
}

/**
 * Among a set of activated typeclasses, find those whose declaration declares the
 * given method name, returning `{ typeclass, method }` candidates. Registry-free
 * replacement for `getTypeclassesForMethod`, scoped to activated method syntax.
 */
export function getMethodCandidates(
  program: ts.Program,
  activatedTypeclasses: Iterable<string>,
  methodName: string
): Array<{ typeclass: string; method: string }> {
  const candidates: Array<{ typeclass: string; method: string }> = [];
  for (const tc of activatedTypeclasses) {
    const info = getOpMapForTypeclass(program, tc);
    if (info?.methodNames.has(methodName)) candidates.push({ typeclass: tc, method: methodName });
  }
  return candidates;
}

/**
 * Find EVERY `@typeclass` in the program that declares a method with the given
 * name. This is the registry-free replacement for `getTypeclassesForMethod`
 * (which scanned the global `typeclassRegistry`). Unscoped — used by the
 * instance-method-sugar path, which resolves the concrete instance from scope and
 * is not yet gated on `@syntax-methods` activation.
 */
export function getTypeclassesDeclaringMethod(
  program: ts.Program,
  methodName: string
): Array<{ typeclass: string; method: string }> {
  const candidates: Array<{ typeclass: string; method: string }> = [];
  for (const info of buildIndex(program).values()) {
    if (info.methodNames.has(methodName)) {
      candidates.push({ typeclass: info.name, method: methodName });
    }
  }
  return candidates;
}

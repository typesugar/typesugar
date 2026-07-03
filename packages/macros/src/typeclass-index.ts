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
import {
  extractOpFromJSDoc,
  getStandardTypeclassOpInfos,
  buildTypeclassInfoFromInterface,
  type TypeclassInfo,
} from "./typeclass.js";

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
  /**
   * The full typeclass definition (methods, typeParam, fullSignatureText, …) — the
   * registry-free replacement for `typeclassRegistry.get(name)`, used by HKT
   * expansion and the public `getTypeclass`/`getTypeclasses` API (PEP-052 Phase C).
   */
  def?: TypeclassInfo;
  /**
   * Whether the typeclass is higher-kinded: its declaration (or an inherited
   * one) applies its type parameter as a type constructor (`Kind<F, ...>`).
   * Declaration-derived (PEP-052 Wave 4) — replaces the hardcoded
   * `hktTypeclassNames` table. Built-in seeds are never HKT.
   */
  isHkt: boolean;
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

  const def = buildTypeclassInfoFromInterface(iface);

  return {
    name: iface.name.text,
    opToMethod,
    methodNames,
    conflictedOps: new Set(),
    def,
    // Direct Kind<F, ...> usage only; buildIndex's finalize pass folds in
    // heritage (a typeclass extending an HKT typeclass is itself HKT).
    isHkt: def?.usesKind ?? false,
  };
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
      def: info.def,
      isHkt: false,
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

  finalizeHeritage(index);

  indexCache.set(program, index);
  return index;
}

/** Escape a string for literal use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Positionally substitute a parent's type parameter names with the child's type arguments. */
function substituteTypeParams(text: string, params: string[], args: string[]): string {
  const renames = new Map<string, string>();
  params.forEach((p, i) => {
    const arg = args[i];
    if (arg && arg !== p) renames.set(p, arg);
  });
  if (renames.size === 0) return text;
  const pattern = new RegExp(`\\b(${[...renames.keys()].map(escapeRegExp).join("|")})\\b`, "g");
  return text.replace(pattern, (m) => renames.get(m) ?? m);
}

/**
 * Resolve `extends` heritage across the indexed `@typeclass` declarations
 * (PEP-052 Wave 4):
 *
 * - `isHkt` propagates: a typeclass extending an HKT typeclass with its own
 *   type parameter in the Kind-bearing (first) position is itself HKT
 *   (`Monad<F> extends FlatMap<F>, Applicative<F> {}` is HKT even though its
 *   own body is empty).
 * - `fullSignatureText` is flattened: inherited member signatures are folded in
 *   (with positional type-parameter substitution) so HKT expansion of e.g.
 *   `Monad<Option>` produces the full map/flatMap/pure/ap structural type, not
 *   just the empty child body. Child members override same-named parents;
 *   diamond parents (Monad → FlatMap/Applicative → Apply → Functor) dedupe by
 *   member name.
 *
 * Own-member metadata (`opToMethod`, `methodNames`) is deliberately NOT
 * flattened — operator/method-sugar activation semantics are unchanged.
 */
function finalizeHeritage(index: Map<string, TypeclassOpInfo>): void {
  type Flat = { members: Array<{ name: string; text: string }>; isHkt: boolean };
  const memo = new Map<string, Flat>();

  function flatten(name: string, visiting: Set<string>): Flat {
    const cached = memo.get(name);
    if (cached) return cached;

    const def = index.get(name)?.def;
    // Unknown parent, built-in seed, or cycle: nothing to inherit.
    if (!def?.memberEntries || visiting.has(name)) {
      return { members: def?.memberEntries ?? [], isHkt: def?.usesKind ?? false };
    }

    visiting.add(name);
    const members = [...def.memberEntries];
    const seen = new Set(members.map((m) => m.name));
    let isHkt = def.usesKind === true;

    for (const h of def.heritage ?? []) {
      const parentDef = index.get(h.name)?.def;
      if (!parentDef) continue;
      const parentFlat = flatten(h.name, visiting);
      const parentParams = parentDef.typeParams ?? [parentDef.typeParam];
      for (const m of parentFlat.members) {
        if (seen.has(m.name)) continue;
        seen.add(m.name);
        members.push({
          name: m.name,
          text: substituteTypeParams(m.text, parentParams, h.typeArgs),
        });
      }
      // HKT-ness inherits only when the child passes its own type param where
      // the parent's (first, Kind-bearing) type param goes.
      if (parentFlat.isHkt && h.typeArgs[0] === def.typeParam) isHkt = true;
    }
    visiting.delete(name);

    const flat: Flat = { members, isHkt };
    memo.set(name, flat);
    return flat;
  }

  for (const [name, info] of index) {
    if (!info.def?.memberEntries) continue; // built-in seed — leave untouched
    const flat = flatten(name, new Set());
    info.isHkt = flat.isHkt;
    if (flat.members.length > 0) {
      info.def.fullSignatureText = `{ ${flat.members.map((m) => m.text).join("; ")} }`;
    }
  }
}

/**
 * Whether the named typeclass is higher-kinded, derived from its `@typeclass`
 * declaration in the program: some member signature (own or inherited) applies
 * the interface's type parameter as a type constructor (`Kind<F, ...>`).
 * Registry-free replacement for the hardcoded `hktTypeclassNames` set.
 */
export function isHktTypeclass(program: ts.Program, tcName: string): boolean {
  return buildIndex(program).get(tcName)?.isHkt ?? false;
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
 * (which scanned the global `typeclassRegistry`). Unscoped by design — used by
 * the `extend()` macro, a NAMED trigger that self-activates via its own explicit
 * import (PEP-052's two-trigger-class rule), so it needs no separate
 * `@syntax-methods` gate. Instance-method sugar (`p.equals(q)`) is a distinct,
 * syntactic-trigger path and uses the scoped `getMethodCandidates` instead
 * (Phase E).
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

/**
 * Get the full definition of a typeclass by name, read from its `@typeclass`
 * declaration in the program (or the built-in seed). Registry-free replacement for
 * `typeclassRegistry.get(name)` — used by HKT expansion (`fullSignatureText`).
 */
export function getTypeclassDef(program: ts.Program, tcName: string): TypeclassInfo | undefined {
  return buildIndex(program).get(tcName)?.def;
}

/**
 * All typeclass definitions in scope for the program (source `@typeclass`
 * declarations + the built-in seed). Registry-free replacement for `getTypeclasses()`.
 */
export function getAllTypeclassDefs(program: ts.Program): Map<string, TypeclassInfo> {
  const out = new Map<string, TypeclassInfo>();
  for (const info of buildIndex(program).values()) {
    if (info.def) out.set(info.name, info.def);
  }
  return out;
}

/** Whether a typeclass with the given name is declared/seeded for the program. */
export function isTypeclassDeclared(program: ts.Program, tcName: string): boolean {
  return buildIndex(program).has(tcName);
}

/**
 * TS9804 "operator syntax not activated" hint (PEP-052 follow-up) — the
 * operator counterpart of `label-activation.ts`'s TS9224.
 *
 * PEP-052 made operator syntax opt-in per file: `a + b` only dispatches to a
 * typeclass's `@op +` method when the file imports that typeclass's `/ops`
 * marker module (or declares the typeclass). Without the import the operator
 * stays native, which on an object is almost always a bug (`a + b` on two
 * complex numbers is string concatenation), and typesugar said nothing.
 *
 * {@link findInactiveOperatorMatch} answers "would activating some typeclass
 * make this expression rewrite?" with the same machinery the rewrite itself
 * uses (`getOperatorCandidates`' per-typeclass lookup + `resolveInstance` +
 * the right-operand check), so the hint fires exactly when adding the named
 * import would change the output. It is only reached from the operator
 * rewrite in `rewriting.ts`, after the operand type has been resolved and
 * found to be non-primitive — no second scanner, no extra checker calls on
 * primitive arithmetic.
 *
 * Resolution shape (CLAUDE.md "Resolving things a macro just generated"):
 * instance lookup goes through `resolveInstance`, which reads the
 * pre-transform local scan PLUS `InstanceScanner.getSynthesized` — the LIVE,
 * same-pass side-table — so an instance a `@derive` generated earlier in this
 * pass is seen. The marker-module lookup below scans the program's source
 * files; that is a snapshot, which is safe here because marker modules are
 * hand-written files no macro synthesizes.
 */

import * as ts from "typescript";
import {
  findSyntaxMarkerSpecifiers,
  globalResolutionScope,
  isInOptedOutScope,
  TS9804,
  type MacroContextImpl,
} from "@typesugar/core";
import { getInactiveOperatorCandidates, resolveInstance } from "@typesugar/macros";

const PRIMITIVE_FLAGS =
  ts.TypeFlags.NumberLike |
  ts.TypeFlags.StringLike |
  ts.TypeFlags.BooleanLike |
  ts.TypeFlags.BigIntLike |
  ts.TypeFlags.EnumLike |
  ts.TypeFlags.ESSymbolLike |
  ts.TypeFlags.Null |
  ts.TypeFlags.Undefined |
  ts.TypeFlags.Void |
  ts.TypeFlags.Never |
  ts.TypeFlags.Any |
  ts.TypeFlags.Unknown;

/** Primitive, literal, `any`/`unknown`, or a union made only of those. */
function isPrimitiveLike(type: ts.Type): boolean {
  if (type.isUnion()) return type.types.every(isPrimitiveLike);
  return (type.flags & PRIMITIVE_FLAGS) !== 0;
}

/** The slice of the operator-rewrite state the hint needs. */
export interface InactiveOperatorQuery {
  operator: string;
  arity: "binary" | "unary";
  /** Typeclasses already activated (or declared) in this file — already tried. */
  activated: ReadonlySet<string>;
  /** The (left) operand's type; the rewrite resolves instances from it. */
  operandType: ts.Type;
  /** Binary only: the right operand's type, for the same check the rewrite does. */
  rightType?: ts.Type;
}

/**
 * Cheap pre-check, before any checker call: is there any non-activated
 * typeclass that maps this operator, in a file/line not opted out of
 * operators? Uses only the program's cached typeclass index.
 */
export function mayNeedOperatorActivationHint(
  ctx: MacroContextImpl,
  node: ts.Node,
  operator: string,
  arity: "binary" | "unary",
  activated: ReadonlySet<string>
): boolean {
  if (getInactiveOperatorCandidates(ctx.program, activated, operator, arity).length === 0) {
    return false;
  }
  return !isInOptedOutScope(ctx.sourceFile, node, globalResolutionScope, "operators");
}

/**
 * The non-activated typeclass whose operator mapping WOULD rewrite this
 * expression if the file activated it, or `undefined`. Mirrors the rewrite's
 * own checks: an instance for the operand type must resolve from scope, and
 * for a method whose right parameter is the type parameter, the right operand
 * must be assignable to the instance type.
 */
export function findInactiveOperatorMatch(
  ctx: MacroContextImpl,
  query: InactiveOperatorQuery
): { typeclass: string; method: string } | undefined {
  // Only now, with the operand known to be non-primitive, look up instances.
  if (isPrimitiveLike(query.operandType)) return undefined;
  const candidates = getInactiveOperatorCandidates(
    ctx.program,
    query.activated,
    query.operator,
    query.arity
  );
  for (const candidate of candidates) {
    const result = resolveInstance(ctx, candidate.typeclass, query.operandType);
    if (!result) continue;
    if (candidate.rightOperandIsSelf && query.rightType) {
      const instanceType = result.kind === "resolved" ? result.forType : query.operandType;
      if (!ctx.typeChecker.isTypeAssignableTo(query.rightType, instanceType)) continue;
    }
    return { typeclass: candidate.typeclass, method: candidate.method };
  }
  return undefined;
}

// Marker modules declared in the program, by typeclass — memoized per program.
const markerFileCache = new WeakMap<ts.Program, Map<string, string | undefined>>();

/** A program source file carrying a `@syntax-operators <typeclass>` marker. */
function findOperatorMarkerFile(program: ts.Program, typeclass: string): string | undefined {
  let byTc = markerFileCache.get(program);
  if (!byTc) {
    byTc = new Map();
    markerFileCache.set(program, byTc);
  }
  if (byTc.has(typeclass)) return byTc.get(typeclass);
  let found: string | undefined;
  for (const sf of program.getSourceFiles()) {
    if (program.isSourceFileDefaultLibrary(sf) || !sf.text.includes("@syntax-operators")) continue;
    const hit = sf.statements.some((stmt) =>
      ts.getJSDocTags(stmt).some((tag) => {
        if (tag.tagName.text !== "syntax-operators") return false;
        const text =
          typeof tag.comment === "string" ? tag.comment : ts.getTextOfJSDocComment(tag.comment);
        return text?.trim() === typeclass;
      })
    );
    if (hit) {
      found = sf.fileName;
      break;
    }
  }
  byTc.set(typeclass, found);
  return found;
}

/**
 * The import specifier that activates `typeclass`'s operator syntax, if one
 * can be named exactly: a provider-registered marker specifier first (std
 * registers `@typesugar/std/syntax/<tc>/ops`), else a marker module in this
 * project, as a path relative to the using file. A marker inside
 * `node_modules` has no reliably derivable public specifier, so it yields
 * `undefined` and the hint names the marker tag instead.
 */
export function operatorActivationSpecifier(
  ctx: MacroContextImpl,
  typeclass: string
): string | undefined {
  const registered = findSyntaxMarkerSpecifiers("operators", typeclass);
  if (registered.length > 0) return registered[0];
  const markerFile = findOperatorMarkerFile(ctx.program, typeclass);
  if (!markerFile || /[\\/]node_modules[\\/]/.test(markerFile)) return undefined;
  const fromDir = ctx.sourceFile.fileName.replace(/\\/g, "/").replace(/\/[^/]*$/, "");
  const target = markerFile.replace(/\\/g, "/").replace(/(\.d)?\.[cm]?[jt]sx?$/, "");
  let rel = relativePath(fromDir, target);
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}

/** POSIX `path.relative` over `/`-normalized paths, kept free of `node:path`. */
function relativePath(fromDir: string, to: string): string {
  const a = fromDir.split("/").filter(Boolean);
  const b = to.split("/").filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const up = a.slice(i).map(() => "..");
  return [...up, ...b.slice(i)].join("/") || ".";
}

/** Emit TS9804 at `anchor` (the operator token, or the unary expression). */
export function emitOperatorSyntaxNotActivatedHint(
  ctx: MacroContextImpl,
  anchor: ts.Node,
  operator: string,
  typeName: string,
  match: { typeclass: string; method: string }
): void {
  const specifier = operatorActivationSpecifier(ctx, match.typeclass);
  ctx
    .diagnostic(TS9804)
    .at(anchor)
    .withArgs({ operator, type: typeName, typeclass: match.typeclass, method: match.method })
    .help(
      specifier
        ? `Add \`import "${specifier}";\` to rewrite it to ${match.typeclass}.${match.method}(...). Without it the operator stays native JavaScript.`
        : `Import a module carrying a \`@syntax-operators ${match.typeclass}\` marker to rewrite it to ${match.typeclass}.${match.method}(...). Without it the operator stays native JavaScript.`
    )
    .emit();
}

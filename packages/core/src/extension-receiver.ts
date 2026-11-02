/**
 * Does a receiver fit an extension function's first parameter?
 *
 * Shared by the transformer's import-scoped extension resolution
 * (transformer-core `checkImportedSymbolForExtension`) and the diagnostic
 * suppression rule that hides the pre-expansion TS2339 for the same calls
 * (macros `ExtensionMethodCall`), so the two agree on which `recv.method()`
 * calls are extension calls. They used to differ for generic extensions:
 * the rule's plain assignability check against `Effect<A, E, R>` was false,
 * and `typesugar check` reported TS2339 for `eff.map(f)` with `EffectExt`
 * imported, a call the transformer rewrites.
 *
 * @packageDocumentation
 */

import * as ts from "typescript";

/**
 * Can `receiverType` be passed as the first argument of `sig`?
 *
 * A generic signature's parameter types still mention its own type
 * parameters (`head<A>(arr: readonly A[])` has `readonly A[]`), and the
 * public checker API offers no way to infer/instantiate them, so a plain
 * `isTypeAssignableTo(number[], readonly A[])` is always false — which is why
 * every generic extension (`arr.head()`, `arr.chunk(2)`) was silently left
 * un-rewritten. For a generic signature, fall back to matching against the
 * parameter type with its type parameters erased to their constraints.
 */
export function receiverMatchesFirstParam(
  checker: ts.TypeChecker,
  receiverType: ts.Type,
  sig: ts.Signature,
  location: ts.Node
): boolean {
  const params = sig.getParameters();
  if (params.length === 0) return false;
  // A rest first parameter (`join(...paths: string[])`) is not a receiver
  // slot: its array type would swallow an array receiver, turning
  // `xs.join("/")` into node:path's `join(xs, "/")`.
  const decl = params[0].valueDeclaration;
  if (decl && ts.isParameter(decl) && decl.dotDotDotToken) return false;
  const paramType = checker.getTypeOfSymbolAtLocation(params[0], location);
  if (checker.isTypeAssignableTo(receiverType, paramType)) return true;
  const typeParams = sig.getTypeParameters();
  if (!typeParams || typeParams.length === 0) return false;
  return matchesErased(checker, receiverType, paramType, new Set<ts.Type>(typeParams), 0);
}

function isReferenceType(type: ts.Type): type is ts.TypeReference {
  return (
    (type.flags & ts.TypeFlags.Object) !== 0 &&
    ((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference) !== 0
  );
}

/** Structural match of `recv` against `param`, treating `typeParams` as wildcards bounded by their constraints. */
function matchesErased(
  checker: ts.TypeChecker,
  recv: ts.Type,
  param: ts.Type,
  typeParams: ReadonlySet<ts.Type>,
  depth: number
): boolean {
  if (depth > 8) return false;
  if (checker.isTypeAssignableTo(recv, param)) return true;
  const next = (r: ts.Type, p: ts.Type) => matchesErased(checker, r, p, typeParams, depth + 1);

  if (param.flags & ts.TypeFlags.TypeParameter) {
    if (!typeParams.has(param)) return false;
    const constraint = checker.getBaseConstraintOfType(param);
    if (!constraint || constraint.flags & (ts.TypeFlags.Unknown | ts.TypeFlags.Any)) return true;
    // `{}` is the base constraint the checker reports for an unconstrained
    // parameter in some positions; it accepts every non-nullish receiver.
    return next(recv, constraint);
  }
  if (recv.isUnion()) return recv.types.every((t) => next(t, param));
  if (param.isUnion()) return param.types.some((t) => next(recv, t));
  if (param.isIntersection()) return param.types.every((t) => next(recv, t));

  if (checker.isArrayType(param)) {
    const recvIsArray = checker.isArrayType(recv);
    const recvIsTuple = checker.isTupleType(recv);
    if (!recvIsArray && !recvIsTuple) return false;
    const paramReadonly = param.getSymbol()?.getName() === "ReadonlyArray";
    const recvReadonly = recvIsTuple
      ? ((recv as ts.TypeReference).target as ts.TupleType).readonly
      : recv.getSymbol()?.getName() === "ReadonlyArray";
    if (recvReadonly && !paramReadonly) return false;
    const [paramElem] = checker.getTypeArguments(param as ts.TypeReference);
    const recvElem = checker.getIndexTypeOfType(recv, ts.IndexKind.Number);
    if (!paramElem || !recvElem) return true;
    return next(recvElem, paramElem);
  }

  // Same generic interface/class (`Box<A>` vs `Box<number>`): match type arguments pairwise.
  if (isReferenceType(param) && isReferenceType(recv) && param.target === recv.target) {
    const pArgs = checker.getTypeArguments(param);
    const rArgs = checker.getTypeArguments(recv);
    if (pArgs.length !== rArgs.length) return false;
    return pArgs.every((p, i) => next(rArgs[i], p));
  }

  return false;
}

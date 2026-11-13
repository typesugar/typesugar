/**
 * forward<S>(inner, advice?) — a typed forwarding object generated from an
 * interface (PEP-063 Wave 2).
 *
 * The macro reads `S`'s members with the type checker and emits an object
 * literal typed `S` whose every method calls the same method on `inner`. An
 * advice's `around` is inlined into each method it applies to, with `method`
 * as the member name, `args` as the call's arguments and `next` as the call
 * on `inner` (beta-reduced when called once): the statement inliner of
 * auto-specialization (PEP-063 Wave 1), so the result is the code you would
 * write by hand.
 *
 * ```typescript
 * const repo = forward<UserRepo>(new PgUserRepo(db), {
 *   around: (method, args, next) => {
 *     const t0 = performance.now();
 *     try { return next(); } finally { record(method, performance.now() - t0); }
 *   },
 *   only: ["get"],
 *   when: "metrics",
 * });
 *
 * // emits (with `metrics` on)
 * const repo = ((inner: UserRepo): UserRepo => ({
 *   get(id) {
 *     const __typesugar_t0_0__ = performance.now();
 *     try { return inner.get(id); } finally { record("get", performance.now() - __typesugar_t0_0__); }
 *   },
 *   save(user) { return inner.save(user); },
 * }))(new PgUserRepo(db));
 *
 * // with `metrics` off: the advice is dropped, and with none left
 * const repo = new PgUserRepo(db);
 * ```
 *
 * Self-calls bypass the advice: `inner`'s own `this.get()` calls `inner.get`,
 * not the forwarding object (as with every forwarding proxy).
 *
 * @module
 */

import * as ts from "typescript";
import {
  cloneNodeDeep,
  defineExpressionMacro,
  globalRegistry,
  isSyntheticNode,
  type MacroContext,
} from "@typesugar/core";
import { evaluateCfgCondition, evaluateConditionOrReport } from "./cfg.js";
import {
  forEachMethodFreeReference,
  inlineMethodAsStatements,
  type DictMethod,
} from "./specialize.js";

/** One advice argument, read from the call. */
interface AdviceSpec {
  /** The expression the advice is read from at run time (a non-literal advice). */
  expr: ts.Expression;
  /** The `around` function, when the advice is an object literal that has one inline. */
  around?: ts.ArrowFunction | ts.FunctionExpression | ts.MethodDeclaration;
  /** The advice has an `around` that isn't written inline: call it through `expr`. */
  aroundByReference: boolean;
  /** Member names from `only`; undefined: every method. */
  only?: Set<string>;
  async: boolean;
  /**
   * Not an object literal: its `around` and `only` are only known at run
   * time, so each method checks them (see wrapCall).
   */
  runtime?: boolean;
}

/** A method member of `S` with one call signature. */
interface MethodMember {
  name: string;
  params: { name: string; rest: boolean }[];
  returnsPromise: boolean;
  /**
   * `ReturnType<S["name"]>`, or `never` for a generic method, whose
   * `ReturnType` would lose its type parameters (the call-through's result is
   * the method's own, so the cast only restates it).
   */
  returnType: () => ts.TypeNode;
}

export const forwardMacro = defineExpressionMacro({
  name: "forward",
  module: "typesugar",
  cacheable: false, // `when` depends on the cfg configuration, not just the call text
  description:
    "Generate a typed forwarding object for an interface, with around-advice inlined per method.",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    const typeArg = callExpr.typeArguments?.length === 1 ? callExpr.typeArguments[0] : undefined;
    if (!typeArg) {
      ctx.reportError(callExpr, "forward<S>() requires exactly one type argument: the interface");
      return callExpr;
    }
    if (args.length < 1 || args.length > 2) {
      ctx.reportError(callExpr, "forward<S>(inner, advice?) takes one or two arguments");
      return callExpr;
    }
    if (isSyntheticNode(typeArg)) {
      ctx.reportWarning(
        callExpr,
        "forward<S>(): the type argument is macro-generated and cannot be resolved by the type checker; left as the runtime call"
      );
      return callExpr;
    }

    const f = ctx.factory;
    const checker = ctx.typeChecker;
    const advices = args[1] ? readAdvices(ctx, args[1]) : [];
    if (!advices) return callExpr;
    // No advice left: `(inner satisfies S) as S`, the value itself, checked
    // against S and typed S, as the call was.
    if (advices.length === 0) {
      return f.createAsExpression(
        f.createSatisfiesExpression(
          f.createParenthesizedExpression(args[0]),
          cloneNodeDeep(typeArg)
        ),
        cloneNodeDeep(typeArg)
      );
    }

    const type = checker.getTypeFromTypeNode(typeArg);
    const problem = unsupportedTarget(checker, type);
    if (problem) {
      ctx.reportError(callExpr, `forward<S>(): ${problem}`);
      return callExpr;
    }
    // The IIFE's parameters must not capture a name the type argument uses
    // (`forward<typeof inner>(x)`).
    const typeNames = new Set<string>();
    const collectNames = (n: ts.Node): void => {
      if (ts.isIdentifier(n)) typeNames.add(n.text);
      ts.forEachChild(n, collectNames);
    };
    collectNames(typeArg);
    const innerName = typeNames.has("inner") ? ctx.generateUniqueName("inner").text : "inner";
    // Every advice may need a parameter (see wrapCall); only those that do get one.
    const paramNames = advices.map((_, i) =>
      typeNames.has(`advice${i}`) ? ctx.generateUniqueName(`advice${i}`).text : `advice${i}`
    );
    const paramName = (a: AdviceSpec): string => paramNames[advices.indexOf(a)];
    const needsParam = new Set<AdviceSpec>(advices.filter((a) => a.aroundByReference));
    const typeNode = (): ts.TypeNode => cloneNodeDeep(typeArg);
    // Each inline `around` as a method, built (and its free names resolved) once.
    const adviceMethods = new Map<AdviceSpec, DictMethod>();
    const adviceMethod = (a: AdviceSpec): DictMethod => {
      let m = adviceMethods.get(a);
      if (!m) adviceMethods.set(a, (m = adviceAsMethod(ctx, a.around!)));
      return m;
    };

    const members: ts.ObjectLiteralElementLike[] = [];
    for (const prop of checker.getPropertiesOfType(type)) {
      // Symbol-keyed members ("__@iterator@12") have no name to write here.
      if (prop.name.startsWith("__@")) continue;
      // Read at the type argument, which is real source (checked above); the
      // call itself may have been rebuilt by another macro.
      const propType = checker.getTypeOfSymbolAtLocation(prop, typeArg);
      // An optional method's type is `F | undefined`: its signatures are F's.
      const signatures = checker.getNonNullableType(propType).getCallSignatures();
      const optional = (prop.flags & ts.SymbolFlags.Optional) !== 0;
      const innerMember = (): ts.Expression =>
        memberAccess(f, f.createIdentifier(innerName), prop.name);

      if (signatures.length === 0) {
        members.push(...forwardedProperty(f, prop, innerMember));
        continue;
      }
      if (signatures.length > 1 || optional) {
        // `inner.m.bind(inner) as S["m"]`: an overloaded or optional method
        // keeps all its signatures; advice isn't applied to it.
        if (advices.some((a) => appliesTo(a, prop.name))) {
          ctx.reportWarning(
            callExpr,
            `forward<S>(): '${prop.name}' is ${optional ? "optional" : "overloaded"}, so it is forwarded without advice`
          );
        }
        members.push(boundMethod(f, typeNode(), prop.name, innerName, innerMember(), optional));
        continue;
      }

      const member = methodMember(f, checker, typeArg, innerName, prop.name, signatures[0]);
      const callArgs = member.params.map((p) =>
        p.rest ? f.createSpreadElement(f.createIdentifier(p.name)) : f.createIdentifier(p.name)
      );
      const innerCall = f.createCallExpression(innerMember(), undefined, callArgs);
      const applicable = advices.filter(
        (a) => appliesTo(a, member.name) && (!a.async || member.returnsPromise)
      );
      for (const a of advices) {
        if (a.async && appliesTo(a, member.name) && !member.returnsPromise) {
          ctx.reportWarning(
            callExpr,
            `forward<S>(): the async advice is not applied to '${member.name}', which doesn't return a promise`
          );
        }
      }

      const bindings = new Set([innerName, ...paramNames, ...member.params.map((p) => p.name)]);
      const body = wrapCall(
        ctx,
        adviceMethod,
        applicable,
        member,
        innerCall,
        paramName,
        needsParam,
        bindings
      );
      members.push(
        f.createMethodDeclaration(
          undefined,
          undefined,
          propertyName(f, prop.name),
          undefined,
          undefined,
          member.params.map((p) =>
            f.createParameterDeclaration(
              undefined,
              p.rest ? f.createToken(ts.SyntaxKind.DotDotDotToken) : undefined,
              p.name
            )
          ),
          undefined,
          f.createBlock(body, true)
        )
      );
    }

    // ((inner: S, advice0: import("typesugar").Advice<S>): S => ({ ... }))(innerExpr, adviceExpr)
    const passed = advices.filter((a) => needsParam.has(a));
    const params = [
      f.createParameterDeclaration(undefined, undefined, innerName, undefined, typeNode()),
      ...passed.map((a) =>
        f.createParameterDeclaration(
          undefined,
          undefined,
          paramName(a),
          undefined,
          f.createImportTypeNode(
            f.createLiteralTypeNode(f.createStringLiteral("typesugar")),
            undefined,
            f.createIdentifier("Advice"),
            [typeNode()]
          )
        )
      ),
    ];
    const arrow = f.createArrowFunction(
      undefined,
      undefined,
      params,
      typeNode(),
      f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      f.createParenthesizedExpression(f.createObjectLiteralExpression(members, true))
    );
    return f.createCallExpression(f.createParenthesizedExpression(arrow), undefined, [
      args[0],
      ...passed.map((a) => a.expr),
    ]);
  },
});

function appliesTo(a: AdviceSpec, name: string): boolean {
  return (a.around !== undefined || a.aroundByReference) && (!a.only || a.only.has(name));
}

/**
 * The advices of `forward`'s second argument, outermost first: an object
 * literal, or an array literal of them; any other expression is one advice
 * called through at run time. An advice whose `when` is false at compile time
 * is dropped. Undefined after reporting an error.
 */
function readAdvices(ctx: MacroContext, arg: ts.Expression): AdviceSpec[] | undefined {
  const items = ts.isArrayLiteralExpression(arg) ? Array.from(arg.elements) : [arg];
  const out: AdviceSpec[] = [];
  for (const item of items) {
    if (ts.isSpreadElement(item)) {
      ctx.reportError(item, "forward<S>(): a spread advice list can't be read at compile time");
      return undefined;
    }
    if (!ts.isObjectLiteralExpression(item)) {
      // Read at run time: its `around` and `only` are checked per call (see
      // wrapCall). A `when` can't be: it is a compile-time condition.
      let hasWhen = false;
      try {
        // A macro-generated advice has no type to read (CLAUDE.md); its
        // `when`, if any, is ignored, as a plain object's would be.
        hasWhen =
          !isSyntheticNode(item) && !!ctx.typeChecker.getTypeAtLocation(item).getProperty("when");
      } catch (error) {
        ctx.reportWarning(
          item,
          `forward<S>(): the type checker failed reading the advice's type (${error}); a \`when\` in it would be ignored`
        );
      }
      if (hasWhen) {
        ctx.reportError(
          item,
          "forward<S>(): `when` is a compile-time condition, read only from an advice written inline as an object literal"
        );
        return undefined;
      }
      out.push({ expr: item, aroundByReference: true, async: false, runtime: true });
      continue;
    }
    const spec: AdviceSpec = { expr: item, aroundByReference: false, async: false };
    let keep = true;
    for (const p of item.properties) {
      const key =
        p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : undefined;
      if (key === "around") {
        const fn = ts.isMethodDeclaration(p)
          ? p
          : ts.isPropertyAssignment(p) &&
              (ts.isArrowFunction(p.initializer) || ts.isFunctionExpression(p.initializer))
            ? p.initializer
            : undefined;
        if (fn) {
          spec.around = fn;
          spec.async = !!fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
        } else {
          spec.aroundByReference = true;
        }
      } else if (key === "only" && ts.isPropertyAssignment(p)) {
        if (!ts.isArrayLiteralExpression(p.initializer)) {
          ctx.reportError(p.initializer, "forward<S>(): `only` must be an array of member names");
          return undefined;
        }
        spec.only = new Set();
        for (const e of p.initializer.elements) {
          if (!ts.isStringLiteralLike(e)) {
            ctx.reportError(e, "forward<S>(): `only` must list member names as string literals");
            return undefined;
          }
          spec.only.add(e.text);
        }
      } else if (key === "when" && ts.isPropertyAssignment(p)) {
        if (!ts.isStringLiteralLike(p.initializer)) {
          ctx.reportError(
            p.initializer,
            "forward<S>(): `when` must be a string literal cfg condition"
          );
          return undefined;
        }
        const on = evaluateConditionOrReport(
          ctx,
          p.initializer,
          p.initializer.text,
          evaluateCfgCondition
        );
        if (on === undefined) return undefined;
        keep = on;
      } else {
        ctx.reportError(
          p,
          "forward<S>(): an advice literal takes only `around`, `only` and `when`"
        );
        return undefined;
      }
    }
    if (spec.aroundByReference) {
      // An advice literal with a non-inline `around` is read at run time as a whole.
      spec.around = undefined;
    }
    if (keep) out.push(spec);
  }
  return out;
}

/** The member's parameters (named after the interface's, or `arg<i>`) and whether it returns a promise. */
function methodMember(
  f: ts.NodeFactory,
  checker: ts.TypeChecker,
  typeArg: ts.TypeNode,
  innerName: string,
  name: string,
  sig: ts.Signature
): MethodMember {
  const used = new Set<string>([innerName]);
  const params = sig.getParameters().map((p, i) => {
    const decl = p.valueDeclaration;
    const rest = !!decl && ts.isParameter(decl) && !!decl.dotDotDotToken;
    let id = /^[A-Za-z_$][\w$]*$/.test(p.name) && !p.name.startsWith("__") ? p.name : `arg${i}`;
    while (used.has(id) || /^advice\d+$/.test(id)) id = `${id}_`;
    used.add(id);
    return { name: id, rest };
  });
  const ret = checker.getReturnTypeOfSignature(sig);
  const returnsPromise = ret.getSymbol()?.getName() === "Promise";
  const returnType = (): ts.TypeNode =>
    sig.typeParameters?.length
      ? f.createKeywordTypeNode(ts.SyntaxKind.NeverKeyword)
      : f.createTypeReferenceNode("ReturnType", [
          f.createIndexedAccessTypeNode(
            cloneNodeDeep(typeArg),
            f.createLiteralTypeNode(f.createStringLiteral(name))
          ),
        ]);
  return { name, params, returnsPromise, returnType };
}

/**
 * The statements of one forwarding method: `return inner.m(args);` wrapped in
 * each applicable advice, outermost first in `advices`. The outermost inline
 * `around` is inlined as statements; each inner one becomes the body of the
 * `next` thunk passed outward. An advice that isn't inline, or whose `around`
 * the inliner declines, is called through its parameter (`advice0.around`),
 * evaluated once outside the generated object, so its body never sits where
 * the member's parameters could capture its names; `needsParam` collects
 * those.
 */
function wrapCall(
  ctx: MacroContext,
  adviceMethod: (a: AdviceSpec) => DictMethod,
  advices: readonly AdviceSpec[],
  member: MethodMember,
  innerCall: ts.Expression,
  paramName: (a: AdviceSpec) => string,
  needsParam: Set<AdviceSpec>,
  bindings: ReadonlySet<string>
): ts.Statement[] {
  const f = ctx.factory;
  let statements: ts.Statement[] = [f.createReturnStatement(innerCall)];
  for (let i = advices.length - 1; i >= 0; i--) {
    const a = advices[i];
    const only = statements.length === 1 ? statements[0] : undefined;
    const thunk = f.createArrowFunction(
      undefined,
      undefined,
      [],
      undefined,
      f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      only && ts.isReturnStatement(only) && only.expression
        ? only.expression
        : f.createBlock(statements, true)
    );
    const callArgs: ts.Expression[] = [
      f.createStringLiteral(member.name),
      f.createArrayLiteralExpression(
        member.params.map((p) =>
          p.rest ? f.createSpreadElement(f.createIdentifier(p.name)) : f.createIdentifier(p.name)
        )
      ),
      thunk,
    ];
    const inlined =
      a.around && inlineMethodAsStatements(ctx, adviceMethod(a), callArgs, { bindings });
    if (inlined) {
      // An async advice's statements are `return (async () => { ... })();`
      // (see inlineMethodAsStatements): no `await` reaches this method or the
      // `next` thunk the next advice out receives.
      statements = inlined;
    } else {
      // Called through the advice's parameter: `around` (optional in Advice)
      // and, for a non-literal advice, `only` are checked at run time; the
      // `next` thunk is bound once so the unadvised path calls it too.
      needsParam.add(a);
      const ref = (): ts.Identifier => f.createIdentifier(paramName(a));
      const nextName = ctx.generateUniqueName("next");
      callArgs[2] = f.createIdentifier(nextName.text);
      let guard: ts.Expression = f.createPropertyAccessExpression(ref(), "around");
      if (a.runtime) {
        guard = f.createLogicalAnd(
          guard,
          f.createLogicalOr(
            f.createLogicalNot(f.createPropertyAccessExpression(ref(), "only")),
            f.createCallExpression(
              f.createPropertyAccessExpression(
                f.createPropertyAccessExpression(ref(), "only"),
                "includes"
              ),
              undefined,
              [f.createStringLiteral(member.name)]
            )
          )
        );
      }
      // `around` is typed `R | Promise<unknown>` (see Advice); the member returns R.
      const advised = f.createAsExpression(
        f.createCallExpression(
          f.createPropertyAccessExpression(ref(), "around"),
          undefined,
          callArgs
        ),
        member.returnType()
      );
      statements = [
        f.createVariableStatement(
          undefined,
          f.createVariableDeclarationList(
            [f.createVariableDeclaration(nextName, undefined, undefined, thunk)],
            ts.NodeFlags.Const
          )
        ),
        f.createReturnStatement(
          f.createConditionalExpression(
            guard,
            f.createToken(ts.SyntaxKind.QuestionToken),
            advised,
            f.createToken(ts.SyntaxKind.ColonToken),
            f.createCallExpression(f.createIdentifier(nextName.text), undefined, [])
          )
        ),
      ];
    }
  }
  return statements;
}

/**
 * The `around` function as a method for inlineMethodAsStatements, which takes
 * block bodies: a concise arrow `=> e` is given as `=> { return e; }`.
 *
 * Its free names are recorded with the checker (`freeSymbols`), as instance
 * extraction does for an instance method: the advice is real source at the
 * `forward` call, and the statement inliner renames the body's locals only
 * when it can tell them from free names. A checker failure leaves the record
 * out, so an advice with locals is called through instead of inlined, and
 * says so.
 */
function adviceAsMethod(
  ctx: MacroContext,
  fn: ts.ArrowFunction | ts.FunctionExpression | ts.MethodDeclaration
): DictMethod {
  const f = ctx.factory;
  const node =
    ts.isArrowFunction(fn) && !ts.isBlock(fn.body)
      ? f.createArrowFunction(
          fn.modifiers,
          fn.typeParameters,
          fn.parameters,
          fn.type,
          fn.equalsGreaterThanToken,
          f.createBlock([f.createReturnStatement(fn.body)], true)
        )
      : fn;
  const params = fn.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : ""));
  if (isSyntheticNode(fn)) return { node: node as unknown as ts.Expression, params };

  const freeSymbols = new Map<string, ts.Symbol>();
  let failed = false;
  forEachMethodFreeReference(fn, (id) => {
    if (failed) return;
    let symbol: ts.Symbol | undefined;
    try {
      // A shorthand `{ tag }` names the property; its value is the variable.
      symbol =
        id.parent && ts.isShorthandPropertyAssignment(id.parent) && id.parent.name === id
          ? ctx.typeChecker.getShorthandAssignmentValueSymbol(id.parent)
          : ctx.typeChecker.getSymbolAtLocation(id);
    } catch (error) {
      failed = true;
      ctx.reportWarning(
        fn,
        `forward<S>(): the type checker failed resolving '${id.text}' in the advice (${error}); the advice is called through instead of inlined`
      );
      return;
    }
    const decls = symbol?.getDeclarations();
    if (!symbol || !decls || decls.length === 0) return;
    // Declared inside the advice: a local, not a free name.
    if (
      decls.every(
        (d) => d.pos >= fn.pos && d.end <= fn.end && d.getSourceFile() === fn.getSourceFile()
      )
    ) {
      return;
    }
    freeSymbols.set(id.text, symbol);
  });
  return {
    node: node as unknown as ts.Expression,
    params,
    ...(failed ? {} : { freeSymbols }),
  };
}

/**
 * `get name() { return inner.name; }`, and `set name(value) { inner.name =
 * value; }` when the member is writable: a property without `readonly`, or
 * an accessor with a setter.
 */
function forwardedProperty(
  f: ts.NodeFactory,
  prop: ts.Symbol,
  innerMember: () => ts.Expression
): ts.ObjectLiteralElementLike[] {
  const getter = f.createGetAccessorDeclaration(
    undefined,
    propertyName(f, prop.name),
    [],
    undefined,
    f.createBlock([f.createReturnStatement(innerMember())], true)
  );
  const decls = prop.declarations ?? [];
  const writable =
    decls.some((d) => ts.isSetAccessorDeclaration(d)) ||
    decls.some(
      (d) =>
        (ts.isPropertySignature(d) || ts.isPropertyDeclaration(d)) &&
        !d.modifiers?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword)
    );
  if (!writable) return [getter];
  const setter = f.createSetAccessorDeclaration(
    undefined,
    propertyName(f, prop.name),
    [f.createParameterDeclaration(undefined, undefined, "value")],
    f.createBlock(
      [f.createExpressionStatement(f.createAssignment(innerMember(), f.createIdentifier("value")))],
      true
    )
  );
  return [getter, setter];
}

/** `name: inner.name.bind(inner) as S["name"]` (`inner.name?.bind(inner)` when optional). */
function boundMethod(
  f: ts.NodeFactory,
  typeArg: ts.TypeNode,
  name: string,
  innerName: string,
  innerMember: ts.Expression,
  optional: boolean
): ts.ObjectLiteralElementLike {
  const bind = optional
    ? f.createCallChain(
        f.createPropertyAccessChain(
          innerMember,
          f.createToken(ts.SyntaxKind.QuestionDotToken),
          "bind"
        ),
        undefined,
        undefined,
        [f.createIdentifier(innerName)]
      )
    : f.createCallExpression(f.createPropertyAccessExpression(innerMember, "bind"), undefined, [
        f.createIdentifier(innerName),
      ]);
  return f.createPropertyAssignment(
    propertyName(f, name),
    f.createAsExpression(
      bind,
      f.createIndexedAccessTypeNode(typeArg, f.createLiteralTypeNode(f.createStringLiteral(name)))
    )
  );
}

/** An identifier name (reserved words included: they are valid property names). */
function isIdentifierName(name: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(name);
}

/** `name` as written in an object literal: an identifier, or a quoted name. */
function propertyName(f: ts.NodeFactory, name: string): ts.PropertyName {
  return isIdentifierName(name) ? f.createIdentifier(name) : f.createStringLiteral(name);
}

/** `obj.name`, or `obj["name"]` when the name isn't an identifier (`"content-type"`, `0`). */
function memberAccess(f: ts.NodeFactory, obj: ts.Expression, name: string): ts.Expression {
  return isIdentifierName(name)
    ? f.createPropertyAccessExpression(obj, name)
    : f.createElementAccessExpression(obj, f.createStringLiteral(name));
}

/**
 * Why `forward` can't generate an object for this `S`, or undefined. It
 * forwards an object type's members: not `any`/`unknown`, a type parameter
 * (its members aren't known here) or a union (only the shared ones are), not
 * a callable or constructible type (the object itself isn't forwarded), and
 * not a class with private or protected members (only an instance of the
 * class can be one).
 */
function unsupportedTarget(checker: ts.TypeChecker, type: ts.Type): string | undefined {
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) {
    return "S is `any` or `unknown`; give the interface to forward";
  }
  if (type.flags & ts.TypeFlags.TypeParameter) {
    return "S is a type parameter, whose members aren't known where forward<S>() expands; give the interface to forward";
  }
  if (type.isUnion()) return "S is a union; give one interface to forward";
  if (!(type.flags & ts.TypeFlags.Object) && !type.isIntersection()) {
    return `S (${checker.typeToString(type)}) is not an object type`;
  }
  if (type.getCallSignatures().length > 0 || type.getConstructSignatures().length > 0) {
    return "S has call or construct signatures; only an object's members can be forwarded";
  }
  const props = checker.getPropertiesOfType(type);
  if (props.length === 0) return "S has no members to forward";
  for (const prop of props) {
    const hidden =
      prop.name.startsWith("__#") ||
      (prop.declarations ?? []).some(
        (d) =>
          (ts.getCombinedModifierFlags(d as ts.Declaration) &
            (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) !==
          0
      );
    if (hidden) {
      return `S has a private or protected member ('${prop.name.replace(/^__#\d+@/, "")}'), so only an instance of the class can be one; forward an interface of its public members`;
    }
  }
  return undefined;
}

globalRegistry.register(forwardMacro);

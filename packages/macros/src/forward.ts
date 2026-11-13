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

    const advices = args[1] ? readAdvices(ctx, args[1]) : [];
    if (!advices) return callExpr;
    if (advices.length === 0) return args[0];

    const checker = ctx.typeChecker;
    const type = checker.getTypeFromTypeNode(typeArg);
    const f = ctx.factory;
    const innerName = "inner";
    // Every advice may need a parameter (see wrapCall); only those that do get one.
    const paramName = (a: AdviceSpec): string => `advice${advices.indexOf(a)}`;
    const needsParam = new Set<AdviceSpec>(advices.filter((a) => a.aroundByReference));
    const allParamNames = advices.map(paramName);
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
      const propType = checker.getTypeOfSymbolAtLocation(prop, callExpr);
      const signatures = propType.getCallSignatures();
      const optional = (prop.flags & ts.SymbolFlags.Optional) !== 0;
      const innerMember = (): ts.PropertyAccessExpression =>
        f.createPropertyAccessExpression(f.createIdentifier(innerName), prop.name);

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
        members.push(boundMethod(f, typeNode(), prop.name, innerMember(), optional));
        continue;
      }

      const member = methodMember(f, checker, typeArg, prop.name, signatures[0]);
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

      const bindings = new Set([innerName, ...allParamNames, ...member.params.map((p) => p.name)]);
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
          prop.name,
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
      out.push({ expr: item, aroundByReference: true, async: false });
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
  name: string,
  sig: ts.Signature
): MethodMember {
  const used = new Set<string>(["inner"]);
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
      needsParam.add(a);
      const around = f.createPropertyAccessExpression(f.createIdentifier(paramName(a)), "around");
      // `around` is typed `R | Promise<unknown>` (see Advice); the member returns R.
      statements = [
        f.createReturnStatement(
          f.createAsExpression(
            f.createCallExpression(around, undefined, callArgs),
            member.returnType()
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
      symbol = ctx.typeChecker.getSymbolAtLocation(id);
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

/** `get name() { return inner.name; }`, and `set name(v) { inner.name = v; }` unless it is readonly. */
function forwardedProperty(
  f: ts.NodeFactory,
  prop: ts.Symbol,
  innerMember: () => ts.PropertyAccessExpression
): ts.ObjectLiteralElementLike[] {
  const getter = f.createGetAccessorDeclaration(
    undefined,
    prop.name,
    [],
    undefined,
    f.createBlock([f.createReturnStatement(innerMember())], true)
  );
  const decl = prop.valueDeclaration;
  const readonly =
    !decl ||
    !(ts.isPropertySignature(decl) || ts.isPropertyDeclaration(decl)) ||
    !!decl.modifiers?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword);
  if (readonly) return [getter];
  const setter = f.createSetAccessorDeclaration(
    undefined,
    prop.name,
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
  innerMember: ts.PropertyAccessExpression,
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
        [f.createIdentifier("inner")]
      )
    : f.createCallExpression(f.createPropertyAccessExpression(innerMember, "bind"), undefined, [
        f.createIdentifier("inner"),
      ]);
  return f.createPropertyAssignment(
    name,
    f.createAsExpression(
      bind,
      f.createIndexedAccessTypeNode(typeArg, f.createLiteralTypeNode(f.createStringLiteral(name)))
    )
  );
}

globalRegistry.register(forwardMacro);

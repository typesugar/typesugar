/**
 * The one attribute-macro dispatcher, shared by decorators (`@reflect class
 * A {}`) and JSDoc tags (`/** @reflect *\/ class A {}`).
 *
 * Each syntax turns what it found into {@link AttributeSource}s (the
 * decorator path in transformer.ts, the JSDoc path in macro-helpers.ts) and
 * then rebuilds its own node from the {@link AttributeExpansion}: a decorator
 * that expanded is removed, a JSDoc tag stays in the comment. Everything in
 * between happens here, once: `expandAfter` ordering, the `derive` and
 * per-macro opt-outs, `@derive` against the pristine declaration, the hygiene
 * scope around `expand`, expansion tracking, and failure handling. The two
 * paths used to do each of these differently (audit/ARCH-REVIEW-2026-11.md A1).
 */

import * as ts from "typescript";
import {
  globalResolutionScope,
  isInOptedOutScope,
  isMacroOptedOut,
  type AttributeMacro,
  type MacroContextImpl,
} from "@typesugar/core";
import { lookupMacroByName } from "./import-resolution.js";
import { createMacroErrorStatement } from "./transformer-utils.js";
import { expandDeriveDecorator, functionsFirst } from "./macro-helpers.js";

/** One attribute-macro use: a decorator, or a JSDoc tag. */
export interface AttributeSource {
  /** The macro name as written (`derive`, `reflect`, ...). */
  macroName: string;
  args: ts.Expression[];
  /** The decorator `expand` receives: the real one, or one synthesized from the tag. */
  decorator: ts.Decorator;
  /** Where this source's diagnostics are reported (the decorator, or the tag). */
  reportAt: ts.Node;
  /**
   * Where its opt-outs are looked up: the decorator, or for a tag the
   * declaration, whose line carries a `// @ts-no-typesugar <feature>` comment
   * (a tag's own line is inside the comment block).
   */
  optOutAt: ts.Node;
  /** A real decorator's identifier, resolved through the checker; none for a tag. */
  identNode?: ts.Node;
  /**
   * A `@derive` written as documentation (`@derive Eq, then ...`): applied to
   * a type declaration, but never reported (TS9102) on anything else.
   */
  prose?: boolean;
}

/** What differs between the syntaxes: how a name finds its macro, and what each records. */
export interface AttributeDispatchHooks {
  /** The macro a source names, if any (the decorator path resolves by symbol first). */
  resolve(source: AttributeSource): AttributeMacro | undefined;
  /** Whether `macro` applies to `target` from this syntax; reports why not itself. */
  accepts?(source: AttributeSource, macro: AttributeMacro, target: ts.Node): boolean;
  /** A source that failed on an earlier visit of the same node: not retried. */
  isFailed?(source: AttributeSource): boolean;
  markFailed?(source: AttributeSource): void;
  /** Record an expansion (the language service's expansion view). */
  recordExpansion?(macroName: string, expanded: ts.Node): void;
}

export interface AttributeExpansion {
  /** The target after every expansion (the input target when none replaced it). */
  target: ts.Node;
  /** Statements to emit after the target: derive output, macro extras, error stubs. */
  extras: ts.Statement[];
  /** The extras a macro returned, which may contain macros of their own: visit them. */
  visitExtras: Set<ts.Statement>;
  /** Sources left as written: no macro, opted out, refused, failed, or no change. */
  unhandled: AttributeSource[];
  /** Whether anything was expanded or reported as handled. */
  transformed: boolean;
}

const isTypeDeclaration = (node: ts.Node): boolean =>
  ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node) || ts.isTypeAliasDeclaration(node);

/**
 * Expand `sources` on `target`, in `expandAfter` order. `declaration` is the
 * pristine declaration the sources are attached to: `@derive` always reads
 * it, never a target an earlier macro already rewrote, whose shape
 * extractTypeInfo's checker-backed lookups (getTypeAtLocation,
 * getPropertiesOfType) don't expect.
 */
export function expandAttributeSources(
  ctx: MacroContextImpl,
  verbose: boolean,
  declaration: ts.Node,
  target: ts.Node,
  sources: readonly AttributeSource[],
  hooks: AttributeDispatchHooks
): AttributeExpansion {
  let current = target;
  const extras: ts.Statement[] = [];
  const visitExtras = new Set<ts.Statement>();
  const unhandled: AttributeSource[] = [];
  let transformed = false;

  for (const source of sortSourcesByDependency(ctx.sourceFile, sources)) {
    const { macroName, args } = source;

    if (macroName === "derive" || macroName === "deriving") {
      // @derive(Eq, Clone, ...) is handled here: no attribute macro named
      // "derive" exists to look up (PEP-032 deleted it); individual derives
      // are registered under globalRegistry.getDerive. `@deriving(...)` is the
      // deprecated alias (expandDeriveDecorator warns).
      if (
        isInOptedOutScope(ctx.sourceFile, source.optOutAt, globalResolutionScope, "derive") ||
        (source.prose && !isTypeDeclaration(declaration))
      ) {
        unhandled.push(source);
        continue;
      }
      const derives = expandDeriveDecorator(ctx, verbose, source.decorator, declaration, args);
      if (derives) {
        extras.push(...derives);
        // Several @derive sources: functions before namespaces (TS2434).
        extras.splice(0, extras.length, ...functionsFirst(extras));
      }
      // Handled on a type even when it generated nothing (each failure is
      // reported): a decorator is then dropped, since `@derive` is not valid
      // TypeScript on an interface or type alias and would be an undefined
      // decorator on a class. On anything else expandDeriveDecorator reported
      // TS9102 and the source stays.
      if (derives || isTypeDeclaration(declaration)) transformed = true;
      else unhandled.push(source);
      continue;
    }

    const macro = hooks.resolve(source);
    if (
      !macro ||
      isMacroOptedOut(ctx.sourceFile, source.optOutAt, macro) ||
      hooks.isFailed?.(source) ||
      (hooks.accepts && !hooks.accepts(source, macro, current))
    ) {
      unhandled.push(source);
      continue;
    }

    if (verbose) console.log(`[typesugar] Expanding attribute macro: @${macroName}`);
    try {
      const result = ctx.hygiene.withScope(() =>
        macro.expand(ctx, source.decorator, current as ts.Declaration, args)
      );
      if (result === undefined) {
        unhandled.push(source);
        continue;
      }
      // An empty array: handled, the target unchanged.
      if (Array.isArray(result) && result.length > 0) {
        current = result[0];
        for (const extra of result.slice(1).filter(ts.isStatement)) {
          extras.push(extra);
          visitExtras.add(extra);
        }
      } else if (!Array.isArray(result)) {
        current = result;
      }
      transformed = true;
      hooks.recordExpansion?.(macroName, current);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.reportError(source.reportAt, `@${macroName} macro expansion failed: ${message}`);
      if (verbose && error instanceof Error) {
        console.error(`[typesugar] @${macroName} expand threw: ${error.stack}`);
      }
      extras.push(
        createMacroErrorStatement(
          ctx.factory,
          `typesugar: attribute macro '${macroName}' failed: ${message}`
        )
      );
      hooks.markFailed?.(source);
      unhandled.push(source);
      transformed = true;
    }
  }

  return { target: current, extras, visitExtras, unhandled, transformed };
}

/**
 * `sources` in `expandAfter` order (a stable topological sort; the written
 * order when there is no dependency or there is a cycle). Expand-order
 * metadata only: the file's imports pick among same-named macros of
 * different modules (PEP-060 item 8).
 */
export function sortSourcesByDependency<S extends { macroName: string }>(
  sourceFile: ts.SourceFile | undefined,
  sources: readonly S[]
): S[] {
  const orderingMacro = (name: string) =>
    lookupMacroByName(sourceFile, name, "attribute") ??
    lookupMacroByName(sourceFile, name, "derive");
  const deps = sources.map((s) =>
    s.macroName ? orderingMacro(s.macroName)?.expandAfter : undefined
  );
  if (!deps.some((d) => d && d.length > 0)) return [...sources];

  const nameToIndex = new Map<string, number>();
  sources.forEach((s, i) => s.macroName && nameToIndex.set(s.macroName, i));
  const n = sources.length;
  const inDegree = new Array<number>(n).fill(0);
  const adj: number[][] = Array.from({ length: n }, () => []);
  deps.forEach((list, i) => {
    for (const dep of list ?? []) {
      const depIdx = nameToIndex.get(dep);
      if (depIdx !== undefined) {
        adj[depIdx].push(i);
        inDegree[i]++;
      }
    }
  });

  const queue: number[] = [];
  for (let i = 0; i < n; i++) if (inDegree[i] === 0) queue.push(i);
  const sorted: S[] = [];
  while (queue.length > 0) {
    queue.sort((a, b) => a - b);
    const idx = queue.shift()!;
    sorted.push(sources[idx]);
    for (const next of adj[idx]) if (--inDegree[next] === 0) queue.push(next);
  }
  return sorted.length < n ? [...sources] : sorted;
}

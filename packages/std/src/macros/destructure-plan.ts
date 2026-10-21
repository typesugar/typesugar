/**
 * What `@derive(Destructure)` generates for a type, as data (PEP-008 Wave 11).
 *
 * One function, {@link planDestructure}, decides the extractors a declaration
 * gets: their names, positional fields and `@destructure` descriptors. Both
 * sides use it, so they can't disagree:
 *
 * - the derive macro (derive-destructure.ts) turns a plan into code;
 * - the match macro (match-extractors.ts) turns the same plan into an
 *   inlined pattern when the generated code is not in the program it checks
 *   against, which is always the case for the file being expanded and for
 *   other source files of the same program (they are expanded separately).
 *
 * **Product** (`interface Point { x; y }`, or an object type alias): one
 * extractor, `Point`, binding the fields in declaration order
 * (`@destructure always -> x, y`).
 *
 * **Discriminated union**: one extractor per variant, testing the
 * discriminant and binding the variant's other fields in declaration order
 * (`@destructure kind = "circle" -> r`). A variant that is a named interface
 * (or object type alias) keeps its name; an inline variant is named from its
 * string tag in PascalCase (`"circle"` → `Circle`, `"line-string"` →
 * `LineString`).
 *
 * Anything ambiguous is an error, never a guess: an `extends` clause (whose
 * fields come first?), a tag that makes no name, two variants with one name,
 * a name some value already has (a global included: a variant `"error"` must
 * not shadow `Error` in the module), more than one candidate discriminant.
 */

import * as ts from "typescript";
import { isSyntheticNode } from "@typesugar/core";

/** A field an extractor binds, in order. */
export interface FieldPlan {
  name: string;
  /** The field's type as written (undefined: no annotation, i.e. `any`). */
  type: ts.TypeNode | undefined;
  optional: boolean;
}

export interface ExtractorPlan {
  /** The value the pattern names, and the constructor function's name. */
  name: string;
  /** The `Destructure` instance's name (`destructurePoint`). */
  instanceName: string;
  /** The `@destructure` descriptor text. */
  descriptor: string;
  fields: FieldPlan[];
  discriminant?: { field: string; value: string | boolean };
  /**
   * - `product`: the derived type itself;
   * - `named`: a variant declared as its own interface / object type alias;
   * - `inline`: a variant written as a type literal inside the union.
   */
  kind: "product" | "named" | "inline";
  /**
   * The declaration the constructor function merges with (product: the type;
   * named variant: its interface). Undefined for an inline variant.
   */
  merges?: ObjectDeclaration;
  /** Inline variant: the type literal. */
  literal?: ts.TypeLiteralNode;
  /** Named variant: the union member as written (`Some<A>`). */
  memberRef?: ts.TypeReferenceNode;
  exported: boolean;
}

export interface DestructurePlan {
  kind: "product" | "sum";
  target: ts.InterfaceDeclaration | ts.TypeAliasDeclaration;
  extractors: ExtractorPlan[];
}

export interface PlanError {
  error: string;
  at: ts.Node;
}

/** An interface, or a type alias of an object type: a shape with ordered fields. */
export type ObjectDeclaration =
  | ts.InterfaceDeclaration
  | (ts.TypeAliasDeclaration & { type: ts.TypeLiteralNode });

const IDENT_RE = /^[A-Za-z_$][\w$]*$/;

// ---------------------------------------------------------------------------
// @derive annotations
// ---------------------------------------------------------------------------

/**
 * The derive names on a declaration: `/** @derive(Eq, Destructure) *\/` JSDoc
 * tags and `@derive(...)` decorators. A syntax check (which derives the
 * user asked for), not a type check.
 */
export function deriveNamesOf(node: ts.Node): string[] {
  const names: string[] = [];
  for (const tag of ts.getJSDocTags(node)) {
    if (tag.tagName.text !== "derive" && tag.tagName.text !== "deriving") continue;
    const c = typeof tag.comment === "string" ? tag.comment : ts.getTextOfJSDocComment(tag.comment);
    const t = (c ?? "").trim();
    const inner = t.startsWith("(") && t.endsWith(")") ? t.slice(1, -1) : t;
    for (const n of inner.split(",")) if (n.trim()) names.push(n.trim());
  }
  const modifiers = (node as { modifiers?: ts.NodeArray<ts.ModifierLike> }).modifiers ?? [];
  for (const m of modifiers) {
    if (!ts.isDecorator(m) || !ts.isCallExpression(m.expression)) continue;
    const callee = m.expression.expression;
    if (!ts.isIdentifier(callee) || (callee.text !== "derive" && callee.text !== "deriving")) {
      continue;
    }
    for (const a of m.expression.arguments) if (ts.isIdentifier(a)) names.push(a.text);
  }
  return names;
}

export function derivesDestructure(node: ts.Node): boolean {
  return deriveNamesOf(node).includes("Destructure");
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

function isExported(node: ts.Node): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function isDefaultExport(node: ts.Node): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return mods?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
}

function unparen(t: ts.TypeNode): ts.TypeNode {
  while (ts.isParenthesizedTypeNode(t)) t = t.type;
  return t;
}

function isObjectDeclaration(d: ts.Node): d is ObjectDeclaration {
  return (
    ts.isInterfaceDeclaration(d) || (ts.isTypeAliasDeclaration(d) && ts.isTypeLiteralNode(d.type))
  );
}

/** The ordered data fields of a shape, or an error. */
function fieldsOf(owner: string, members: ts.NodeArray<ts.TypeElement>): FieldPlan[] | PlanError {
  const fields: FieldPlan[] = [];
  for (const m of members) {
    if (ts.isIndexSignatureDeclaration(m)) continue; // not a field
    if (ts.isPropertySignature(m)) {
      const name = ts.isIdentifier(m.name) || ts.isStringLiteral(m.name) ? m.name.text : undefined;
      if (name === undefined || !IDENT_RE.test(name)) {
        return {
          error: `${owner}'s field ${m.name.getText()} is not a plain name, so it can't be bound positionally`,
          at: m,
        };
      }
      fields.push({ name, type: m.type, optional: m.questionToken !== undefined });
      continue;
    }
    return {
      error:
        `${owner} has a ${ts.isMethodSignature(m) ? "method" : "call, construct or accessor signature"}, ` +
        `so a constructor function can't build one. Write the Destructure instance by hand (@impl and @destructure)`,
      at: m,
    };
  }
  return fields;
}

function ownFieldsOf(decl: ObjectDeclaration, checker: ts.TypeChecker): FieldPlan[] | PlanError {
  const name = decl.name.text;
  if (ts.isInterfaceDeclaration(decl)) {
    if (decl.heritageClauses?.length) {
      return {
        error:
          `${name} extends another type, so the order of ${name}(...)'s fields is ambiguous ` +
          `(inherited first, or its own?). Use an object pattern, or write the instance by hand ` +
          `with @impl and @destructure`,
        at: decl.heritageClauses[0],
      };
    }
    const sym = checker.getSymbolAtLocation(decl.name);
    const decls = sym?.declarations?.filter(ts.isInterfaceDeclaration) ?? [];
    if (decls.length > 1) {
      return {
        error: `${name} is declared more than once (merged), so the order of its fields is ambiguous`,
        at: decl.name,
      };
    }
    return fieldsOf(name, decl.members);
  }
  return fieldsOf(name, decl.type.members);
}

/** `"circle"` → `Circle`, `"line-string"` → `LineString`; undefined if no name results. */
export function variantNameFromTag(tag: string): string | undefined {
  const name = tag
    .split(/[-_]/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
  return /^[A-Za-z$][\w$]*$/.test(name) ? name : undefined;
}

/** A JSON literal safe inside a JSDoc comment (no `*\/`, no tag-starting `@`). */
export function jsdocSafeJson(value: string | boolean): string {
  return JSON.stringify(value).replace(/\*\//g, "*\\/").replace(/@/g, "\\u0040");
}

function descriptorFor(e: Pick<ExtractorPlan, "fields" | "discriminant">): string {
  const payload = e.fields.length ? ` -> ${e.fields.map((f) => f.name).join(", ")}` : "";
  if (!e.discriminant) return `always${payload}`;
  return `${e.discriminant.field} = ${jsdocSafeJson(e.discriminant.value)}${payload}`;
}

/** The literal value of a discriminant property's type, if it has one. */
function literalValue(checker: ts.TypeChecker, t: ts.Type): string | boolean | undefined {
  if (t.isStringLiteral()) return t.value;
  if (t === checker.getTrueType()) return true;
  if (t === checker.getFalseType()) return false;
  return undefined;
}

interface Member {
  node: ts.TypeLiteralNode | ts.TypeReferenceNode;
  type: ts.Type;
  decl?: ObjectDeclaration;
}

function findDiscriminant(
  checker: ts.TypeChecker,
  target: ts.TypeAliasDeclaration,
  members: Member[]
): { field: string; values: (string | boolean)[] } | PlanError {
  const candidates: { field: string; values: (string | boolean)[] }[] = [];
  for (const prop of checker.getPropertiesOfType(members[0].type)) {
    const values: (string | boolean)[] = [];
    for (const m of members) {
      const p = checker.getPropertyOfType(m.type, prop.name);
      if (!p || p.flags & ts.SymbolFlags.Optional) break;
      const v = literalValue(checker, checker.getTypeOfSymbolAtLocation(p, m.node));
      if (v === undefined) break;
      values.push(v);
    }
    if (values.length === members.length && new Set(values).size === values.length) {
      candidates.push({ field: prop.name, values });
    }
  }
  if (candidates.length === 0) {
    return {
      error:
        `${target.name.text} has no discriminant: no field has a different string or boolean ` +
        `literal type in every variant`,
      at: target.name,
    };
  }
  if (candidates.length > 1) {
    return {
      error:
        `${target.name.text} has more than one discriminant (${candidates.map((c) => c.field).join(", ")}), ` +
        `so which one the extractors test is ambiguous`,
      at: target.name,
    };
  }
  return candidates[0];
}

/**
 * Plan `@derive(Destructure)` for `target`. Pure: reads the declaration
 * (and the checker for discriminant literal types and name collisions),
 * generates nothing.
 */
export function planDestructure(
  checker: ts.TypeChecker,
  target: ts.Node
): DestructurePlan | PlanError {
  // A macro-generated declaration is outside the checker's contract (CLAUDE.md).
  if (isSyntheticNode(target)) {
    return {
      error:
        "@derive(Destructure) can't read a macro-generated type; derive it on a type of your own source",
      at: target,
    };
  }
  if (ts.isClassDeclaration(target)) {
    return {
      error:
        "@derive(Destructure) goes on an interface, an object type or a discriminated union, not on a class " +
        "(a class has a constructor already; write its instance by hand with @impl and @destructure)",
      at: target.name ?? target,
    };
  }
  if (!ts.isInterfaceDeclaration(target) && !ts.isTypeAliasDeclaration(target)) {
    return { error: "@derive(Destructure) goes on an interface or a type alias", at: target };
  }
  if (isDefaultExport(target)) {
    return { error: "@derive(Destructure) on a default export is not supported", at: target.name };
  }

  const plan =
    ts.isTypeAliasDeclaration(target) && ts.isUnionTypeNode(unparen(target.type))
      ? planSum(checker, target, unparen(target.type) as ts.UnionTypeNode)
      : planProduct(checker, target);
  if ("error" in plan) return plan;
  const collision = checkCollisions(checker, plan);
  return collision ?? plan;
}

function planProduct(
  checker: ts.TypeChecker,
  target: ts.InterfaceDeclaration | ts.TypeAliasDeclaration
): DestructurePlan | PlanError {
  if (!isObjectDeclaration(target)) {
    return {
      error:
        `${target.name.text} is not an interface, an object type or a union of them, ` +
        `so it has no fields in a known order`,
      at: target.name,
    };
  }
  const fields = ownFieldsOf(target, checker);
  if ("error" in fields) return fields;
  if (fields.length === 0) {
    return { error: `${target.name.text} has no fields to destructure`, at: target.name };
  }
  const name = target.name.text;
  const e = {
    name,
    instanceName: `destructure${name}`,
    fields,
    kind: "product" as const,
    merges: target,
    exported: isExported(target),
  };
  return { kind: "product", target, extractors: [{ ...e, descriptor: descriptorFor(e) }] };
}

function planSum(
  checker: ts.TypeChecker,
  target: ts.TypeAliasDeclaration,
  union: ts.UnionTypeNode
): DestructurePlan | PlanError {
  const sf = target.getSourceFile();
  const members: Member[] = [];
  for (const raw of union.types) {
    const node = unparen(raw);
    if (ts.isTypeLiteralNode(node)) {
      members.push({ node, type: checker.getTypeFromTypeNode(node) });
      continue;
    }
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
      let sym = checker.getSymbolAtLocation(node.typeName);
      if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
      const decl = sym?.declarations?.find(isObjectDeclaration);
      if (decl && decl.getSourceFile() !== sf) {
        return {
          error:
            `variant ${node.typeName.text} is declared in another module, and its extractor ` +
            `function must merge with its declaration. Derive Destructure for the union in that module`,
          at: node,
        };
      }
      if (decl) {
        members.push({ node, type: checker.getTypeFromTypeNode(node), decl });
        continue;
      }
    }
    return {
      error: `variant ${raw.getText()} of ${target.name.text} is not an object type`,
      at: raw,
    };
  }

  const disc = findDiscriminant(checker, target, members);
  if ("error" in disc) return disc;

  const extractors: ExtractorPlan[] = [];
  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    const value = disc.values[i];
    const tagText = `${disc.field}: ${jsdocSafeJson(value)}`;
    let name: string | undefined;
    let fields: FieldPlan[] | PlanError;
    if (m.decl) {
      name = m.decl.name.text;
      fields = ownFieldsOf(m.decl, checker);
    } else {
      if (typeof value !== "string") {
        return {
          error:
            `the variant with ${tagText} has no name to give its extractor: ` +
            `name the variants with interfaces (interface Ok { ${tagText}; ... })`,
          at: m.node,
        };
      }
      name = variantNameFromTag(value);
      if (!name) {
        return {
          error:
            `the tag ${JSON.stringify(value)} does not make an extractor name. ` +
            `Name the variant with an interface`,
          at: m.node,
        };
      }
      fields = fieldsOf(`the ${tagText} variant`, (m.node as ts.TypeLiteralNode).members);
    }
    if ("error" in fields) return fields;
    const dup = extractors.find((e) => e.name === name);
    if (dup) {
      return {
        error: `both variants would be named ${name} (${dup.discriminant!.field}: ${jsdocSafeJson(dup.discriminant!.value)} and ${tagText}). Name them with interfaces`,
        at: m.node,
      };
    }
    const e = {
      name,
      instanceName: `destructure${name}`,
      fields: fields.filter((f) => f.name !== disc.field),
      discriminant: { field: disc.field, value },
      kind: m.decl ? ("named" as const) : ("inline" as const),
      merges: m.decl,
      literal: m.decl ? undefined : (m.node as ts.TypeLiteralNode),
      memberRef: m.decl ? (m.node as ts.TypeReferenceNode) : undefined,
      exported: m.decl ? isExported(m.decl) : isExported(target),
    };
    extractors.push({ ...e, descriptor: descriptorFor(e) });
  }
  return { kind: "sum", target, extractors };
}

/**
 * Names the generated declarations would take that something else already
 * has. Checked with the checker's own scope lookup at the declaration, so
 * module-level values, imports and globals all count. A namespace of the
 * same name declared AFTER the type is fine: it merges with the function.
 */
function checkCollisions(checker: ts.TypeChecker, plan: DestructurePlan): PlanError | undefined {
  const { target } = plan;
  const sf = target.getSourceFile();
  for (const e of plan.extractors) {
    // A named variant's own derives emit `namespace Circle { ... }` right after
    // it; declared before the union, that namespace would precede the function
    // it merges with (TS2434).
    if (e.kind === "named" && e.merges) {
      const own = deriveNamesOf(e.merges);
      if (own.includes("Destructure")) {
        return {
          error:
            `${e.name} has @derive(Destructure) of its own, and this union's extractor for the ` +
            `variant would also be named ${e.name}. Remove one`,
          at: e.merges.name,
        };
      }
      if (own.length > 0 && e.merges.end <= target.pos) {
        return {
          error:
            `${e.name}'s own @derive(${own.join(", ")}) adds a namespace ${e.name} before the ` +
            `extractor function ${e.name} that this union adds, which TypeScript rejects (TS2434). ` +
            `declare ${target.name.text} before ${e.name}`,
          at: target.name,
        };
      }
    }
    for (const name of [e.name, e.instanceName]) {
      const existing = checker.resolveName(name, target, ts.SymbolFlags.Value, false);
      if (!existing) continue;
      const decls = existing.declarations ?? [];
      const mergingNamespace =
        decls.length > 0 &&
        decls.every(
          (d) => ts.isModuleDeclaration(d) && d.getSourceFile() === sf && d.pos >= target.end
        );
      if (mergingNamespace && name === e.name) continue;
      const local = decls.some((d) => d.getSourceFile() === sf);
      const where = local
        ? existing.flags & ts.SymbolFlags.Alias
          ? "an import"
          : "a declaration in this module"
        : undefined;
      return {
        error: where
          ? `'${name}' already names a value (${where}), so @derive(Destructure) can't declare ` +
            `it for ${target.name.text}. Rename one, or write the instance by hand with @impl and @destructure`
          : `'${name}' would shadow the global ${name} in this module. ` +
            (e.kind === "inline"
              ? `Name the variant with an interface`
              : `Rename the type, or write the instance by hand with @impl and @destructure`),
        at: e.merges?.name ?? e.literal ?? target.name,
      };
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Live same-pass registry
// ---------------------------------------------------------------------------

/**
 * Plans the derive macro expanded in the CURRENT pass, per file — the live,
 * same-pass registry CLAUDE.md asks for ("Resolving things a macro just
 * generated"): the constructor function and instance the derive generates
 * are spliced into the output tree only, so nothing reading the program can
 * see them. The match macro reads this first; it also plans `@derive`
 * annotations itself (planDestructure is pure), which covers a match that
 * comes before the declaration and other source files of the program.
 */
const synthesized = new WeakMap<ts.Program, Map<string, DestructurePlan[]>>();

export function registerSynthesizedDestructure(
  program: ts.Program,
  fileName: string,
  plan: DestructurePlan
): void {
  let perProgram = synthesized.get(program);
  if (!perProgram) synthesized.set(program, (perProgram = new Map()));
  const plans = (perProgram.get(fileName) ?? []).filter((p) => p.target !== plan.target);
  plans.push(plan);
  perProgram.set(fileName, plans);
}

export function synthesizedDestructures(
  program: ts.Program,
  fileName: string
): readonly DestructurePlan[] {
  return synthesized.get(program)?.get(fileName) ?? [];
}

// ---------------------------------------------------------------------------
// Annotations in a file
// ---------------------------------------------------------------------------

const annotatedCache = new WeakMap<ts.Program, Map<string, DestructurePlan[]>>();

/**
 * The plans of the `@derive(Destructure)` declarations written in `file`
 * (top level). A declaration whose plan fails is left out: its own file's
 * expansion reports the error.
 */
export function annotatedDestructures(
  program: ts.Program,
  checker: ts.TypeChecker,
  file: ts.SourceFile
): readonly DestructurePlan[] {
  let perProgram = annotatedCache.get(program);
  if (!perProgram) annotatedCache.set(program, (perProgram = new Map()));
  const cached = perProgram.get(file.fileName);
  if (cached) return cached;
  const out: DestructurePlan[] = [];
  if (!file.isDeclarationFile) {
    for (const stmt of file.statements) {
      if (!ts.isInterfaceDeclaration(stmt) && !ts.isTypeAliasDeclaration(stmt)) continue;
      if (!stmt.getFullText(file).includes("Destructure") || !derivesDestructure(stmt)) continue;
      let plan: DestructurePlan | PlanError;
      try {
        plan = planDestructure(checker, stmt);
      } catch {
        continue;
      }
      if (!("error" in plan)) out.push(plan);
    }
  }
  perProgram.set(file.fileName, out);
  return out;
}

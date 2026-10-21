/**
 * Extractor patterns from `Destructure` instances (PEP-008's `unapply`).
 *
 * `Name(...)` (or a bare `Name`) in a pattern is an extractor when a
 * `Destructure<typeof Name, Input, Output>` instance is in scope for it:
 *
 * ```ts
 * /**
 *  * @impl Destructure<typeof Some, Option<unknown>, unknown>
 *  * @destructure not-null -> self
 *  *\/
 * export const destructureSome: Destructure<typeof Some, Option<any>, any> = {
 *   extract: (o) => (o != null ? o : undefined),
 * };
 * ```
 *
 * **Which instance.** The instance is keyed by the constructor's SYMBOL (the
 * first type argument, `typeof Some`), so two different `Some`s never share
 * one, and the scrutinee's representation follows from whose `Some` it is.
 * Scope is the PEP-052 one, plus co-location: the current file, the modules
 * it imports, and the module that declares `Name` itself — an instance that
 * ships next to its type needs no extra import.
 *
 * **Zero cost.** An instance with a `@destructure` descriptor is never called:
 * the macro inlines the test and the field reads it describes
 * (`o != null` and `const v = o`). The descriptor is declarative data, so it
 * survives `.d.ts` emit (a library's instance body does not). Grammar:
 *
 *     @destructure <test> [-> <payload>]
 *     test    := not-null | null | always | has <key> | <field> = <json literal>
 *     payload := self | <field>, <field>, ...
 *
 * `not-null`/`null` compare with `!= null`/`== null`; `has left` is
 * `"left" in v`; `_tag = "Some"` / `ok = true` compare a discriminant (string
 * or boolean); `always` matches every value (a product type). The payload
 * lists what the arguments bind, in order: `self` is the value itself, a
 * field name is `v.field`. No payload: a zero-argument pattern (`None`).
 * The descriptor must agree with `extract`; the macro trusts it.
 *
 * **Without a descriptor** (hand-written logic, e.g. parsing a string):
 * `extract` is called once and its result destructured.
 */

import * as ts from "typescript";
import { isSyntheticNode, type MacroContext } from "@typesugar/core";

/** A payload field name meaning "the matched value itself" (fp's `Some(v)`). */
export const SELF_PAYLOAD = "";

/**
 * How an extractor pattern tests and binds a value.
 *
 * - `sum-variant`: a variant test (`test`, or `discriminantField ===
 *   discriminantValue`) and payload fields read directly (zero cost).
 * - `product`: structural fields in declaration order (legacy name tables).
 * - `custom`: a `Destructure` instance with no descriptor: `extract()` once.
 */
export interface ExtractorDef {
  kind: "sum-variant" | "product" | "custom";
  /**
   * A presence test used INSTEAD of the discriminant check — for untagged
   * representations (Option = `A | null`, Either = `{ left } | { right }`).
   * `always`: the pattern matches every value (a product type).
   */
  test?: "not-null" | "null" | "always" | { hasKey: string };
  discriminantField?: string;
  discriminantValue?: string | boolean;
  payloadFields?: string[];
  productFields?: string[];
  zeroArg: boolean;
  /** For `custom`: an expression referring to the instance (`destructureEmail`). */
  instance?: (ctx: MacroContext) => ts.Expression;
}

// ---------------------------------------------------------------------------
// Descriptor
// ---------------------------------------------------------------------------

/** Parse a `@destructure` descriptor. Returns an error message for bad input. */
export function parseDestructureDescriptor(text: string): ExtractorDef | string {
  const [testPart, payloadPart, extra] = text.split("->").map((s) => s.trim());
  if (extra !== undefined) return `more than one "->"`;
  const def: ExtractorDef = { kind: "sum-variant", zeroArg: payloadPart === undefined };

  const words = testPart.split(/\s+/).filter(Boolean);
  if (words.length === 1 && words[0] === "not-null") def.test = "not-null";
  else if (words.length === 1 && words[0] === "null") def.test = "null";
  else if (words.length === 1 && words[0] === "always") def.test = "always";
  else if (words.length === 2 && words[0] === "has" && isFieldName(words[1])) {
    def.test = { hasKey: words[1] };
  } else {
    const m = /^([A-Za-z_$][\w$]*)\s*=\s*(.+)$/.exec(testPart);
    if (!m) {
      return `unknown test "${testPart}" (expected not-null, null, always, has <key> or <field> = <literal>)`;
    }
    let value: unknown;
    try {
      value = JSON.parse(m[2]);
    } catch {
      return `the discriminant value ${m[2]} is not a JSON string or boolean`;
    }
    if (typeof value !== "string" && typeof value !== "boolean") {
      return `the discriminant value ${m[2]} is not a string or boolean`;
    }
    def.discriminantField = m[1];
    def.discriminantValue = value;
  }

  if (payloadPart !== undefined) {
    const fields = payloadPart.split(",").map((s) => s.trim());
    if (fields.some((f) => f !== "self" && !isFieldName(f))) {
      return `bad payload "${payloadPart}" (expected self or field names)`;
    }
    def.payloadFields = fields.map((f) => (f === "self" ? SELF_PAYLOAD : f));
  }
  return def;
}

function isFieldName(s: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(s);
}

// ---------------------------------------------------------------------------
// Instances in a file
// ---------------------------------------------------------------------------

interface DestructureInstance {
  /** The constructor the instance is for (`Some`), alias-resolved. */
  target: ts.Symbol;
  exportName: string;
  declaration: ts.VariableDeclaration;
  /** Parsed `@destructure` descriptor, or an error message; undefined if absent. */
  descriptor?: ExtractorDef | string;
}

const instanceCache = new WeakMap<ts.Program, Map<string, DestructureInstance[]>>();

/**
 * The symbol identity two references to the same constructor share: aliases
 * resolved, and an exported declaration's local symbol mapped to its export
 * symbol (the checker hands out either, depending on the lookup).
 */
function resolveAlias(checker: ts.TypeChecker, sym: ts.Symbol): ts.Symbol {
  const target = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
  return checker.getExportSymbolOfSymbol(target);
}

function jsDocTagText(tag: ts.JSDocTag): string {
  const c = typeof tag.comment === "string" ? tag.comment : ts.getTextOfJSDocComment(tag.comment);
  return (c ?? "").trim();
}

/** The `typeof X` symbol of a `Destructure<typeof X, ...>` annotation or `@impl` tag. */
function instanceTarget(
  checker: ts.TypeChecker,
  stmt: ts.VariableStatement,
  decl: ts.VariableDeclaration
): ts.Symbol | undefined {
  const t = decl.type;
  if (
    t &&
    ts.isTypeReferenceNode(t) &&
    (ts.isIdentifier(t.typeName) ? t.typeName.text : t.typeName.right.text) === "Destructure" &&
    t.typeArguments?.[0] &&
    ts.isTypeQueryNode(t.typeArguments[0])
  ) {
    const sym = checker.getSymbolAtLocation(t.typeArguments[0].exprName);
    if (sym) return resolveAlias(checker, sym);
  }
  for (const tag of ts.getJSDocTags(stmt)) {
    if (tag.tagName.text !== "impl" && tag.tagName.text !== "instance") continue;
    const m = /^Destructure\s*<\s*typeof\s+([A-Za-z_$][\w$]*)/.exec(jsDocTagText(tag));
    if (!m) continue;
    const sym = checker
      .getSymbolsInScope(decl, ts.SymbolFlags.Value | ts.SymbolFlags.Alias)
      .find((s) => s.name === m[1]);
    if (sym) return resolveAlias(checker, sym);
  }
  return undefined;
}

function instancesIn(ctx: MacroContext, file: ts.SourceFile): DestructureInstance[] {
  let perProgram = instanceCache.get(ctx.program);
  if (!perProgram) {
    perProgram = new Map();
    instanceCache.set(ctx.program, perProgram);
  }
  const cached = perProgram.get(file.fileName);
  if (cached) return cached;

  const checker = ctx.typeChecker;
  const out: DestructureInstance[] = [];
  for (const stmt of file.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    // Cheap syntactic filter before asking the checker anything (full text:
    // the @impl tag is in the leading JSDoc).
    const text = stmt.getFullText(file);
    if (!text.includes("Destructure")) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue;
      let target: ts.Symbol | undefined;
      try {
        target = instanceTarget(checker, stmt, decl);
      } catch {
        target = undefined;
      }
      if (!target) continue;
      const tag = ts.getJSDocTags(stmt).find((t) => t.tagName.text === "destructure");
      out.push({
        target,
        exportName: decl.name.text,
        declaration: decl,
        descriptor: tag ? parseDestructureDescriptor(jsDocTagText(tag)) : undefined,
      });
    }
  }
  perProgram.set(file.fileName, out);
  return out;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

const resolvedCache = new WeakMap<ts.Node, { def?: ExtractorDef }>();

/**
 * The extractor `name` (the callee of `Name(...)`, or a bare `Name`) stands
 * for, from a `Destructure` instance in scope; undefined if there is none.
 * A descriptor error is reported once and treated as no instance.
 */
export function resolveExtractor(ctx: MacroContext, name: ts.Identifier): ExtractorDef | undefined {
  const cached = resolvedCache.get(name);
  if (cached) return cached.def;
  let def: ExtractorDef | undefined;
  try {
    def = resolveUncached(ctx, name);
  } catch {
    def = undefined;
  }
  resolvedCache.set(name, { def });
  return def;
}

function resolveUncached(ctx: MacroContext, name: ts.Identifier): ExtractorDef | undefined {
  // A macro-generated node is outside the checker's contract (CLAUDE.md).
  if (isSyntheticNode(name)) return undefined;
  const checker = ctx.typeChecker;
  const local = checker.getSymbolAtLocation(name);
  if (!local) return undefined;
  const target = resolveAlias(checker, local);

  // Scope: this file, the modules it imports, the module that declares Name.
  const files: ts.SourceFile[] = [ctx.sourceFile];
  for (const stmt of ctx.sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const mod = checker.getSymbolAtLocation(stmt.moduleSpecifier);
    for (const d of mod?.declarations ?? []) {
      if (ts.isSourceFile(d) && !files.includes(d)) files.push(d);
    }
  }
  for (const d of target.declarations ?? []) {
    const sf = d.getSourceFile();
    // lib.*.d.ts declares String, Date, ... (type-constructor patterns), never instances.
    if (!files.includes(sf) && !ctx.program.isSourceFileDefaultLibrary(sf)) files.push(sf);
  }

  const matches: DestructureInstance[] = [];
  for (const file of files) {
    for (const inst of instancesIn(ctx, file)) {
      if (inst.target === target && !matches.includes(inst)) matches.push(inst);
    }
  }
  if (matches.length === 0) return undefined;
  const inst = matches[0];
  if (matches.length > 1) {
    ctx.reportWarning(
      name,
      `match: ${matches.length} Destructure instances for ${name.text} are in scope ` +
        `(${matches.map((m) => m.exportName).join(", ")}); using ${inst.exportName}.`
    );
  }

  if (typeof inst.descriptor === "string") {
    ctx.reportError(
      name,
      `match: the @destructure descriptor of ${inst.exportName} is invalid: ${inst.descriptor}`
    );
    return undefined;
  }
  if (inst.descriptor) return inst.descriptor;
  return { kind: "custom", zeroArg: false, instance: (c) => instanceReference(c, name, inst) };
}

/** An expression for `inst` in the current file, importing it if needed. */
function instanceReference(
  ctx: MacroContext,
  name: ts.Identifier,
  inst: DestructureInstance
): ts.Expression {
  const f = ctx.factory;
  if (inst.declaration.getSourceFile() === ctx.sourceFile) {
    return f.createIdentifier(inst.exportName);
  }
  // Imported by name already?
  for (const stmt of ctx.sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const bindings = stmt.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings) || stmt.importClause?.isTypeOnly) continue;
    for (const el of bindings.elements) {
      if ((el.propertyName ?? el.name).text === inst.exportName && !el.isTypeOnly) {
        const sym = ctx.typeChecker.getSymbolAtLocation(el.name);
        const decl = sym && resolveAlias(ctx.typeChecker, sym).declarations?.[0];
        if (decl === inst.declaration) return f.createIdentifier(el.name.text);
      }
    }
  }
  // Otherwise import it from where the constructor came from.
  const local = ctx.typeChecker.getSymbolAtLocation(name);
  const importSpec = local?.declarations?.find(ts.isImportSpecifier);
  const importDecl = importSpec?.parent.parent.parent;
  if (importDecl && ts.isStringLiteral(importDecl.moduleSpecifier)) {
    return ctx.ensureImport(inst.exportName, importDecl.moduleSpecifier.text);
  }
  ctx.reportError(
    name,
    `match: the Destructure instance ${inst.exportName} for ${name.text} is not in scope here; import it.`
  );
  return f.createIdentifier(inst.exportName);
}

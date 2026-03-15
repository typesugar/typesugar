/**
 * PEP-007 Proof-of-Concept: Detect F<A> → Kind<F, A> rewrite targets
 *
 * This script parses a test source, walks the AST, and identifies which
 * TypeReferenceNodes should be rewritten from F<A> to Kind<F, A>.
 *
 * Detection rule: If the identifier in a TypeReferenceNode matches a type
 * parameter of an enclosing scope AND it has type arguments, it's an HKT
 * application and should be rewritten.
 *
 * Run: npx tsx sandbox/hkt-poc-detection.ts
 */

import * as ts from "typescript";

const TEST_SOURCE = `
// ============================================================================
// Case 1: Basic typeclass — F<A> in params and return types
// ============================================================================
/** @typeclass */
interface Functor<F> {
  map<A, B>(fa: F<A>, f: (a: A) => B): F<B>;
}

// ============================================================================
// Case 2: Nested F<F<A>> — Monad join/flatten
// ============================================================================
interface Monad<F> {
  flatten<A>(ffa: F<F<A>>): F<A>;
  pure<A>(a: A): F<A>;
}

// ============================================================================
// Case 3: Multiple type args — Applicative
// ============================================================================
interface Applicative<F> {
  pure<A>(a: A): F<A>;
  ap<A, B>(ff: F<(a: A) => B>, fa: F<A>): F<B>;
}

// ============================================================================
// Case 4: Concrete generics should NOT be rewritten
// ============================================================================
interface WithConcreteTypes<F> {
  liftArray<A>(fa: F<A>): Array<A>;       // Array<A> should NOT be rewritten
  liftPromise<A>(fa: F<A>): Promise<A>;   // Promise<A> should NOT be rewritten
  mapBoth<A, B>(fa: F<A>, f: (a: A) => B): F<B>;
}

// ============================================================================
// Case 5: Generic function — F<A> in function signature
// ============================================================================
declare function lift<F, A, B>(functor: Functor<F>, f: (a: A) => B): (fa: F<A>) => F<B>;

// ============================================================================
// Case 6: Type alias with F<A>
// ============================================================================
type Lifted<F, A, B> = (fa: F<A>) => F<B>;

// ============================================================================
// Case 7: Conditional type
// ============================================================================
type IsNullable<F, A> = F<A> extends null ? true : false;

// ============================================================================
// Case 8: Mapped type
// ============================================================================
type MapAll<F, T> = { [K in keyof T]: F<T[K]> };

// ============================================================================
// Case 9: Tuple, union, intersection positions
// ============================================================================
type Pair<F, A, B> = [F<A>, F<B>];
type OrNull<F, A> = F<A> | null;
type AndMeta<F, A> = F<A> & { __meta: true };

// ============================================================================
// Case 10: extends clause — Functor<F> is NOT an HKT application (no extra args)
// ============================================================================
interface FunctorFilter<F> extends Functor<F> {
  filter<A>(fa: F<A>, pred: (a: A) => boolean): F<A>;
}

// ============================================================================
// Case 11: @impl with bare type — Option used without type args
// ============================================================================
declare const optionFunctor: Functor<Option>;  // Option missing args → @impl resolves
declare const arrayFunctor: Functor<Array>;     // Array missing args → @impl resolves

// ============================================================================
// Case 12: Multi-arity type constructor F<A, B>
// ============================================================================
interface Bifunctor<F> {
  bimap<A, B, C, D>(fab: F<A, B>, f: (a: A) => C, g: (b: B) => D): F<C, D>;
}

// ============================================================================
// Case 13: Type parameter NOT used with args — should NOT be rewritten
// ============================================================================
interface Container<F, A> {
  value: A;      // A is a type param but NOT used with args — leave alone
  wrapped: F<A>; // F IS used with args — rewrite
}

// ============================================================================
// Helpers for Case 11
// ============================================================================
type Option<A> = A | null;
`;

const sourceFile = ts.createSourceFile(
  "hkt-test.ts",
  TEST_SOURCE,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS
);

interface RewriteTarget {
  line: number;
  col: number;
  text: string;
  rewriteTo: string;
  enclosingDecl: string;
  typeParam: string;
}

interface FalsePositiveCheck {
  line: number;
  text: string;
  reason: string;
}

const rewriteTargets: RewriteTarget[] = [];
const correctlyIgnored: FalsePositiveCheck[] = [];

function getTypeParamNames(node: ts.Node): Set<string> {
  const params = new Set<string>();
  if (
    ts.isInterfaceDeclaration(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isMethodSignature(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isCallSignatureDeclaration(node)
  ) {
    for (const tp of node.typeParameters ?? []) {
      params.add(tp.name.text);
    }
  }
  return params;
}

function collectTypeParams(node: ts.Node): Set<string> {
  const allParams = new Set<string>();
  let current: ts.Node | undefined = node;
  while (current) {
    for (const p of getTypeParamNames(current)) {
      allParams.add(p);
    }
    current = current.parent;
  }
  return allParams;
}

function visit(node: ts.Node): void {
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
    const name = node.typeName.text;
    const enclosingParams = collectTypeParams(node);
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());

    if (node.typeArguments && node.typeArguments.length > 0) {
      if (enclosingParams.has(name)) {
        const argTexts = node.typeArguments.map((a) => a.getText(sourceFile));
        const kindArgs = [name, ...argTexts].join(", ");

        let enclosing = node.parent;
        while (enclosing && !ts.isInterfaceDeclaration(enclosing) &&
               !ts.isFunctionDeclaration(enclosing) && !ts.isTypeAliasDeclaration(enclosing)) {
          enclosing = enclosing.parent;
        }
        const enclosingName = enclosing && "name" in enclosing && enclosing.name
          ? (enclosing.name as ts.Identifier).text
          : "<anonymous>";

        rewriteTargets.push({
          line: line + 1,
          col: character + 1,
          text: node.getText(sourceFile),
          rewriteTo: `Kind<${kindArgs}>`,
          enclosingDecl: enclosingName,
          typeParam: name,
        });
      } else {
        correctlyIgnored.push({
          line: line + 1,
          text: node.getText(sourceFile),
          reason: `${name} is not a type parameter (concrete generic)`,
        });
      }
    } else if (enclosingParams.has(name)) {
      // Type parameter used without args — no rewrite needed
    }
  }

  ts.forEachChild(node, visit);
}

visit(sourceFile);

console.log("=== REWRITE TARGETS (F<A> → Kind<F, A>) ===\n");
for (const t of rewriteTargets) {
  console.log(`  L${t.line}:${t.col}  ${t.text.padEnd(25)} → ${t.rewriteTo}`);
  console.log(`         in ${t.enclosingDecl}, type param: ${t.typeParam}`);
}
console.log(`\n  Total: ${rewriteTargets.length} rewrites\n`);

console.log("=== CORRECTLY IGNORED (not rewritten) ===\n");
for (const c of correctlyIgnored) {
  console.log(`  L${c.line}  ${c.text.padEnd(25)} — ${c.reason}`);
}
console.log(`\n  Total: ${correctlyIgnored.length} ignored\n`);

// Verify specific expectations
const checks: Array<{ desc: string; pass: boolean }> = [];

function check(desc: string, cond: boolean) {
  checks.push({ desc, pass: cond });
}

// Case 1: Basic F<A> rewrites
check("Case 1: F<A> in param is rewritten",
  rewriteTargets.some(t => t.enclosingDecl === "Functor" && t.text === "F<A>"));
check("Case 1: F<B> in return is rewritten",
  rewriteTargets.some(t => t.enclosingDecl === "Functor" && t.text === "F<B>"));

// Case 2: Nested F<F<A>>
check("Case 2: F<F<A>> outer is rewritten",
  rewriteTargets.some(t => t.enclosingDecl === "Monad" && t.text === "F<F<A>>"));
check("Case 2: F<A> inner is rewritten",
  rewriteTargets.some(t => t.enclosingDecl === "Monad" && t.text === "F<A>" && t.rewriteTo === "Kind<F, A>"));

// Case 4: Concrete generics NOT rewritten
check("Case 4: Array<A> is NOT rewritten",
  correctlyIgnored.some(c => c.text === "Array<A>"));
check("Case 4: Promise<A> is NOT rewritten",
  correctlyIgnored.some(c => c.text === "Promise<A>"));

// Case 5: Generic function
check("Case 5: F<A> in function sig is rewritten",
  rewriteTargets.some(t => t.enclosingDecl === "lift" && t.text === "F<A>"));

// Case 6: Type alias
check("Case 6: F<A> in type alias is rewritten",
  rewriteTargets.some(t => t.enclosingDecl === "Lifted" && t.text === "F<A>"));

// Case 7: Conditional type
check("Case 7: F<A> in conditional type is rewritten",
  rewriteTargets.some(t => t.enclosingDecl === "IsNullable" && t.text === "F<A>"));

// Case 8: Mapped type
check("Case 8: F<T[K]> in mapped type is rewritten",
  rewriteTargets.some(t => t.enclosingDecl === "MapAll" && t.text === "F<T[K]>"));

// Case 9: Tuple/union/intersection
check("Case 9: F<A> in tuple is rewritten",
  rewriteTargets.some(t => t.enclosingDecl === "Pair"));
check("Case 9: F<A> in union is rewritten",
  rewriteTargets.some(t => t.enclosingDecl === "OrNull"));
check("Case 9: F<A> in intersection is rewritten",
  rewriteTargets.some(t => t.enclosingDecl === "AndMeta"));

// Case 10: extends clause — Functor<F> has no type args to rewrite (F is bare)
check("Case 10: Functor<F> in extends is NOT rewritten (F is bare, not F<A>)",
  !rewriteTargets.some(t => t.text === "Functor<F>"));

// Case 11: Bare type usage — Option used without args (a different kind of issue)
check("Case 11: Functor<Option> is detected as concrete generic (not rewritten)",
  correctlyIgnored.some(c => c.text.includes("Functor<Option>")));

// Case 12: Multi-arity
check("Case 12: F<A, B> in Bifunctor is rewritten",
  rewriteTargets.some(t => t.enclosingDecl === "Bifunctor" && t.text === "F<A, B>"));

// Case 13: Non-applied type param is NOT rewritten
check("Case 13: F<A> in Container IS rewritten",
  rewriteTargets.some(t => t.enclosingDecl === "Container" && t.text === "F<A>"));

console.log("=== VERIFICATION ===\n");
let allPass = true;
for (const c of checks) {
  const status = c.pass ? "✅" : "❌";
  console.log(`  ${status} ${c.desc}`);
  if (!c.pass) allPass = false;
}
console.log(`\n  ${allPass ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED"}\n`);

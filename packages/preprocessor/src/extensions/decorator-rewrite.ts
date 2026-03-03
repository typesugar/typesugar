/**
 * Decorator rewrite syntax extension
 *
 * Rewrites decorator syntax to JSDoc comments so everything flows through
 * the single JSDoc macro path in the transformer (tryExpandJSDocMacros).
 *
 * Supported decorators:
 *
 * 1. @impl("Eq<Point>") or @instance("Eq<Point>") on const/let/var:
 *    @impl("Eq<Point>")
 *    export const pointEq: Eq<Point> = { ... };
 *    -->
 *    /** @impl Eq<Point> *\/
 *    export const pointEq: Eq<Point> = { ... };
 *
 * 2. @typeclass on interface:
 *    @typeclass
 *    export interface Eq<A> { ... }
 *    -->
 *    /** @typeclass *\/
 *    export interface Eq<A> { ... }
 */

import * as ts from "typescript";
import type { SyntaxExtension, Replacement, RewriteOptions } from "./types.js";
import type { TokenStream } from "../token-stream.js";
import type { Token } from "../scanner.js";

interface InstanceDecorator {
  atPos: number;
  endPos: number;
  arg: string;
}

interface ImplDeclaration {
  decorators: InstanceDecorator[];
  declStart: number;
}

interface TypeclassDecorator {
  atPos: number;
  endPos: number;
  args: string | null;
}

interface TypeclassDeclaration {
  decorator: TypeclassDecorator;
  interfaceName: string;
  interfaceEndPos: number;
}

export const decoratorRewriteExtension: SyntaxExtension = {
  name: "decorator-rewrite",

  rewrite(stream: TokenStream, source: string, _options?: RewriteOptions): Replacement[] {
    const tokens = stream.getTokens();
    const replacements: Replacement[] = [];

    const implDeclarations = findImplDeclarations(tokens, source);
    const typeclassDeclarations = findTypeclassDeclarations(tokens, source);

    for (const decl of implDeclarations) {
      for (const decorator of decl.decorators) {
        const implArg = stripStringQuotes(decorator.arg);
        replacements.push({
          start: decorator.atPos,
          end: decorator.endPos,
          text: `/** @impl ${implArg} */`,
        });
      }
    }

    for (const decl of typeclassDeclarations) {
      const jsdoc =
        decl.decorator.args !== null
          ? `/** @typeclass ${decl.decorator.args} */`
          : `/** @typeclass */`;

      replacements.push({
        start: decl.decorator.atPos,
        end: decl.decorator.endPos,
        text: jsdoc,
      });
    }

    return replacements;
  },
};

function findImplDeclarations(tokens: readonly Token[], source: string): ImplDeclaration[] {
  const declarations: ImplDeclaration[] = [];
  let i = 0;

  while (i < tokens.length) {
    const decorators = collectImplDecorators(tokens, i, source);
    if (decorators.length === 0) {
      i++;
      continue;
    }

    const lastDecoratorEndIndex = findTokenIndexAt(
      tokens,
      decorators[decorators.length - 1].endPos
    );
    if (lastDecoratorEndIndex === -1) {
      i++;
      continue;
    }

    let declStart = lastDecoratorEndIndex + 1;

    while (declStart < tokens.length) {
      const t = tokens[declStart];
      if (t.kind === ts.SyntaxKind.ExportKeyword) {
        declStart++;
        continue;
      }
      break;
    }

    if (declStart >= tokens.length) {
      i++;
      continue;
    }

    const declToken = tokens[declStart];
    if (
      declToken.kind !== ts.SyntaxKind.ConstKeyword &&
      declToken.kind !== ts.SyntaxKind.LetKeyword &&
      declToken.kind !== ts.SyntaxKind.VarKeyword
    ) {
      i++;
      continue;
    }

    declarations.push({
      decorators,
      declStart,
    });

    i = declStart + 1;
  }

  return declarations;
}

const IMPL_DECORATOR_NAMES = new Set(["impl", "instance"]);

function collectImplDecorators(
  tokens: readonly Token[],
  startIndex: number,
  source: string
): InstanceDecorator[] {
  const decorators: InstanceDecorator[] = [];
  let i = startIndex;

  while (i < tokens.length) {
    const decorator = tryParseImplDecorator(tokens, i, source);
    if (decorator === null) {
      break;
    }
    decorators.push(decorator);

    const nextIndex = findTokenIndexAfter(tokens, decorator.endPos);
    if (nextIndex === -1) break;
    i = nextIndex;
  }

  return decorators;
}

function tryParseImplDecorator(
  tokens: readonly Token[],
  index: number,
  source: string
): InstanceDecorator | null {
  if (index >= tokens.length) return null;

  const atToken = tokens[index];
  if (atToken.kind !== ts.SyntaxKind.AtToken) return null;

  const identIndex = index + 1;
  if (identIndex >= tokens.length) return null;

  const identToken = tokens[identIndex];
  if (identToken.kind !== ts.SyntaxKind.Identifier || !IMPL_DECORATOR_NAMES.has(identToken.text)) return null;

  const parenIndex = identIndex + 1;
  if (parenIndex >= tokens.length) return null;

  const parenToken = tokens[parenIndex];
  if (parenToken.kind !== ts.SyntaxKind.OpenParenToken) return null;

  const closeParenIndex = findMatchingParen(tokens, parenIndex);
  if (closeParenIndex === -1) return null;

  const argStart = parenToken.end;
  const argEnd = tokens[closeParenIndex].start;
  const arg = source.slice(argStart, argEnd).trim();

  return {
    atPos: atToken.start,
    endPos: tokens[closeParenIndex].end,
    arg,
  };
}

function stripStringQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function findTypeclassDeclarations(
  tokens: readonly Token[],
  source: string
): TypeclassDeclaration[] {
  const declarations: TypeclassDeclaration[] = [];
  let i = 0;

  while (i < tokens.length) {
    const decorator = tryParseTypeclassDecorator(tokens, i, source);
    if (decorator === null) {
      i++;
      continue;
    }

    const nextIndex = findTokenIndexAfter(tokens, decorator.endPos);
    if (nextIndex === -1) {
      i++;
      continue;
    }

    let declStart = nextIndex;

    while (declStart < tokens.length) {
      const t = tokens[declStart];
      if (t.kind === ts.SyntaxKind.ExportKeyword) {
        declStart++;
        continue;
      }
      break;
    }

    if (declStart >= tokens.length) {
      i++;
      continue;
    }

    const interfaceToken = tokens[declStart];
    if (interfaceToken.kind !== ts.SyntaxKind.InterfaceKeyword) {
      i++;
      continue;
    }

    const nameIndex = declStart + 1;
    if (nameIndex >= tokens.length || tokens[nameIndex].kind !== ts.SyntaxKind.Identifier) {
      i++;
      continue;
    }

    const interfaceName = tokens[nameIndex].text;

    let j = nameIndex + 1;

    if (j < tokens.length && tokens[j].kind === ts.SyntaxKind.LessThanToken) {
      const closeAngle = findMatchingAngleBracket(tokens, j);
      if (closeAngle === -1) {
        i++;
        continue;
      }
      j = closeAngle + 1;
    }

    if (j < tokens.length && tokens[j].kind === ts.SyntaxKind.ExtendsKeyword) {
      j++;
      while (j < tokens.length) {
        const t = tokens[j];
        if (t.kind === ts.SyntaxKind.OpenBraceToken) break;
        j++;
      }
    }

    if (j >= tokens.length || tokens[j].kind !== ts.SyntaxKind.OpenBraceToken) {
      i++;
      continue;
    }

    const closeBraceIndex = findMatchingBrace(tokens, j);
    if (closeBraceIndex === -1) {
      i++;
      continue;
    }

    declarations.push({
      decorator,
      interfaceName,
      interfaceEndPos: tokens[closeBraceIndex].end,
    });

    i = closeBraceIndex + 1;
  }

  return declarations;
}

function tryParseTypeclassDecorator(
  tokens: readonly Token[],
  index: number,
  source: string
): TypeclassDecorator | null {
  if (index >= tokens.length) return null;

  const atToken = tokens[index];
  if (atToken.kind !== ts.SyntaxKind.AtToken) return null;

  const identIndex = index + 1;
  if (identIndex >= tokens.length) return null;

  const identToken = tokens[identIndex];
  if (identToken.kind !== ts.SyntaxKind.Identifier || identToken.text !== "typeclass") return null;

  const parenIndex = identIndex + 1;

  if (parenIndex >= tokens.length || tokens[parenIndex].kind !== ts.SyntaxKind.OpenParenToken) {
    return {
      atPos: atToken.start,
      endPos: identToken.end,
      args: null,
    };
  }

  const closeParenIndex = findMatchingParen(tokens, parenIndex);
  if (closeParenIndex === -1) return null;

  const argStart = tokens[parenIndex].end;
  const argEnd = tokens[closeParenIndex].start;
  const args = source.slice(argStart, argEnd).trim();

  return {
    atPos: atToken.start,
    endPos: tokens[closeParenIndex].end,
    args: args.length > 0 ? args : null,
  };
}

function findMatchingParen(tokens: readonly Token[], openIndex: number): number {
  let depth = 1;
  let i = openIndex + 1;

  while (i < tokens.length && depth > 0) {
    const t = tokens[i];
    if (t.kind === ts.SyntaxKind.OpenParenToken) depth++;
    else if (t.kind === ts.SyntaxKind.CloseParenToken) depth--;
    i++;
  }

  return depth === 0 ? i - 1 : -1;
}

function findMatchingBrace(tokens: readonly Token[], openIndex: number): number {
  let depth = 1;
  let i = openIndex + 1;

  while (i < tokens.length && depth > 0) {
    const t = tokens[i];
    if (t.kind === ts.SyntaxKind.OpenBraceToken) depth++;
    else if (t.kind === ts.SyntaxKind.CloseBraceToken) depth--;
    i++;
  }

  return depth === 0 ? i - 1 : -1;
}

function findMatchingAngleBracket(tokens: readonly Token[], openIndex: number): number {
  let depth = 1;
  let i = openIndex + 1;

  while (i < tokens.length && depth > 0) {
    const t = tokens[i];
    if (t.kind === ts.SyntaxKind.LessThanToken) depth++;
    else if (t.kind === ts.SyntaxKind.GreaterThanToken) depth--;
    i++;
  }

  return depth === 0 ? i - 1 : -1;
}

function findTokenIndexAt(tokens: readonly Token[], pos: number): number {
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].end === pos) return i;
    if (tokens[i].start <= pos && tokens[i].end >= pos) return i;
  }
  return -1;
}

function findTokenIndexAfter(tokens: readonly Token[], pos: number): number {
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].start >= pos) return i;
  }
  return -1;
}

export default decoratorRewriteExtension;

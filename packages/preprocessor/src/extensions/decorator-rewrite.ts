/**
 * Decorator rewrite syntax extension
 *
 * Handles two decorator patterns that need preprocessing:
 *
 * 1. @instance on const/let/var:
 *    @instance("Eq<Point>")
 *    export const pointEq: Eq<Point> = { ... };
 *    -->
 *    export const pointEq: Eq<Point> = instance("Eq<Point>", { ... });
 *
 * 2. @typeclass on interface:
 *    @typeclass
 *    export interface Eq<A> { ... }
 *    -->
 *    export interface Eq<A> { ... }
 *    typeclass("Eq");
 *
 *    @typeclass({ ops: { "===": "equals" } })
 *    export interface Eq<A> { ... }
 *    -->
 *    export interface Eq<A> { ... }
 *    typeclass("Eq", { ops: { "===": "equals" } });
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

interface InstanceDeclaration {
  decorators: InstanceDecorator[];
  initializerStart: number;
  initializerEnd: number;
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

    const instanceDeclarations = findInstanceDeclarations(tokens, source);
    const typeclassDeclarations = findTypeclassDeclarations(tokens, source);

    for (const decl of instanceDeclarations) {
      const initializerText = source.slice(decl.initializerStart, decl.initializerEnd);

      // Decorators apply bottom-up (closest to declaration first), so reverse the order
      // @A @B const x = v  ->  const x = A(B(v))
      // decorators array is [A, B], we want to wrap B first (inner), then A (outer)
      let wrappedText = initializerText;
      const reversed = [...decl.decorators].reverse();
      for (const decorator of reversed) {
        wrappedText = `instance(${decorator.arg}, ${wrappedText})`;
      }

      for (const decorator of decl.decorators) {
        replacements.push({
          start: decorator.atPos,
          end: decorator.endPos,
          text: "",
        });
      }

      replacements.push({
        start: decl.initializerStart,
        end: decl.initializerEnd,
        text: wrappedText,
      });
    }

    for (const decl of typeclassDeclarations) {
      replacements.push({
        start: decl.decorator.atPos,
        end: decl.decorator.endPos,
        text: "",
      });

      const typeclassCall =
        decl.decorator.args !== null
          ? `\ntypeclass("${decl.interfaceName}", ${decl.decorator.args});`
          : `\ntypeclass("${decl.interfaceName}");`;

      replacements.push({
        start: decl.interfaceEndPos,
        end: decl.interfaceEndPos,
        text: typeclassCall,
      });
    }

    return replacements;
  },
};

function findInstanceDeclarations(tokens: readonly Token[], source: string): InstanceDeclaration[] {
  const declarations: InstanceDeclaration[] = [];
  let i = 0;

  while (i < tokens.length) {
    const decorators = collectInstanceDecorators(tokens, i, source);
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

    let j = declStart + 1;
    if (j >= tokens.length || tokens[j].kind !== ts.SyntaxKind.Identifier) {
      i++;
      continue;
    }
    j++;

    if (j < tokens.length && tokens[j].kind === ts.SyntaxKind.ColonToken) {
      j++;
      const typeEnd = skipTypeAnnotation(tokens, j);
      if (typeEnd === -1) {
        i++;
        continue;
      }
      j = typeEnd;
    }

    if (j >= tokens.length || tokens[j].kind !== ts.SyntaxKind.EqualsToken) {
      i++;
      continue;
    }
    j++;

    if (j >= tokens.length) {
      i++;
      continue;
    }

    const initializerStart = tokens[j].start;
    const initializerEnd = findInitializerEnd(tokens, j, source);
    if (initializerEnd === -1) {
      i++;
      continue;
    }

    declarations.push({
      decorators,
      initializerStart,
      initializerEnd,
    });

    const endTokenIndex = findTokenIndexAt(tokens, initializerEnd);
    i = endTokenIndex !== -1 ? endTokenIndex + 1 : tokens.length;
  }

  return declarations;
}

function collectInstanceDecorators(
  tokens: readonly Token[],
  startIndex: number,
  source: string
): InstanceDecorator[] {
  const decorators: InstanceDecorator[] = [];
  let i = startIndex;

  while (i < tokens.length) {
    const decorator = tryParseInstanceDecorator(tokens, i, source);
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

function tryParseInstanceDecorator(
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
  if (identToken.kind !== ts.SyntaxKind.Identifier || identToken.text !== "instance") return null;

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

function skipTypeAnnotation(tokens: readonly Token[], startIndex: number): number {
  let depth = 0;
  let i = startIndex;

  while (i < tokens.length) {
    const t = tokens[i];

    if (
      t.kind === ts.SyntaxKind.OpenParenToken ||
      t.kind === ts.SyntaxKind.OpenBracketToken ||
      t.kind === ts.SyntaxKind.OpenBraceToken ||
      t.kind === ts.SyntaxKind.LessThanToken
    ) {
      depth++;
      i++;
      continue;
    }

    if (
      t.kind === ts.SyntaxKind.CloseParenToken ||
      t.kind === ts.SyntaxKind.CloseBracketToken ||
      t.kind === ts.SyntaxKind.CloseBraceToken ||
      t.kind === ts.SyntaxKind.GreaterThanToken
    ) {
      if (depth > 0) {
        depth--;
        i++;
        continue;
      }
    }

    if (depth === 0 && t.kind === ts.SyntaxKind.EqualsToken) {
      return i;
    }

    if (
      depth === 0 &&
      (t.kind === ts.SyntaxKind.SemicolonToken || t.kind === ts.SyntaxKind.CommaToken)
    ) {
      return i;
    }

    i++;
  }

  return -1;
}

function findInitializerEnd(tokens: readonly Token[], startIndex: number, _source: string): number {
  let depth = 0;
  let i = startIndex;
  let lastEnd = -1;

  while (i < tokens.length) {
    const t = tokens[i];

    if (
      t.kind === ts.SyntaxKind.OpenParenToken ||
      t.kind === ts.SyntaxKind.OpenBracketToken ||
      t.kind === ts.SyntaxKind.OpenBraceToken
    ) {
      depth++;
      lastEnd = t.end;
      i++;
      continue;
    }

    if (
      t.kind === ts.SyntaxKind.CloseParenToken ||
      t.kind === ts.SyntaxKind.CloseBracketToken ||
      t.kind === ts.SyntaxKind.CloseBraceToken
    ) {
      if (depth > 0) {
        depth--;
        lastEnd = t.end;
        i++;
        continue;
      }
      return lastEnd !== -1 ? lastEnd : t.start;
    }

    if (depth === 0 && t.kind === ts.SyntaxKind.SemicolonToken) {
      return lastEnd !== -1 ? lastEnd : t.start;
    }

    if (depth === 0 && t.kind === ts.SyntaxKind.CommaToken) {
      return lastEnd !== -1 ? lastEnd : t.start;
    }

    lastEnd = t.end;
    i++;
  }

  return lastEnd;
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

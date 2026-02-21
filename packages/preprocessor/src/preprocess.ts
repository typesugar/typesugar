/**
 * Main preprocessor entry point
 *
 * Composes all syntax extensions to transform source code with custom syntax
 * into valid TypeScript that the macro transformer can process.
 */

import * as ts from "typescript";
import MagicString from "magic-string";
import { tokenize, isBoundaryToken, type Token, type CustomOperatorDef } from "./scanner.js";
import { TokenStream } from "./token-stream.js";
import type {
  SyntaxExtension,
  CustomOperatorExtension,
  PreprocessResult,
  Replacement,
  RawSourceMap,
} from "./extensions/types.js";
import { hktExtension } from "./extensions/hkt.js";
import { pipelineExtension } from "./extensions/pipeline.js";
import { consExtension } from "./extensions/cons.js";

/**
 * Union type for any preprocessor extension
 */
type AnyExtension = SyntaxExtension | CustomOperatorExtension;

const BUILT_IN_EXTENSIONS: Record<string, AnyExtension> = {
  hkt: hktExtension,
  pipeline: pipelineExtension,
  cons: consExtension,
};

const BUILT_IN_OPERATORS: CustomOperatorExtension[] = [pipelineExtension, consExtension];

export interface PreprocessOptions {
  extensions?: string[];
  customExtensions?: AnyExtension[];
  /**
   * File name used to determine JSX vs Standard language variant.
   * Files ending in .tsx or .jsx use JSX mode.
   */
  fileName?: string;
  /**
   * "macro" (default) for compilation -- produces valid TS for macro processing
   * "format" for prettier round-tripping -- produces markers that can be reversed
   */
  mode?: "macro" | "format";
}

/**
 * Preprocess source code, applying enabled syntax extensions.
 *
 * Extensions are applied in stages:
 * 1. HKT extension (type-level syntax)
 * 2. Operator extensions (expression-level syntax)
 *
 * @param source - The source code to preprocess
 * @param options - Configuration options
 * @returns The preprocessed result with source map
 */
export function preprocess(source: string, options: PreprocessOptions = {}): PreprocessResult {
  const enabledExtensions = getEnabledExtensions(options);

  if (enabledExtensions.length === 0) {
    return { code: source, changed: false, map: null };
  }

  const nonOperatorExtensions = enabledExtensions.filter(
    (ext): ext is SyntaxExtension => !("symbol" in ext && "precedence" in ext) && "rewrite" in ext
  );

  const operatorExtensions = enabledExtensions.filter(
    (ext): ext is CustomOperatorExtension =>
      "symbol" in ext && "precedence" in ext && "transform" in ext
  );

  // Use MagicString to track all changes and generate source maps
  const s = new MagicString(source);
  let changed = false;

  // Phase 1: Apply non-operator extensions (HKT, etc.)
  if (nonOperatorExtensions.length > 0) {
    const customOperatorDefs: CustomOperatorDef[] = operatorExtensions.map((op) => ({
      symbol: op.symbol,
      chars: op.symbol.split(""),
    }));

    const tokens = tokenize(source, {
      customOperators: customOperatorDefs,
      fileName: options.fileName,
    });
    const stream = new TokenStream(tokens, source);

    const replacements: Replacement[] = [];
    for (const ext of nonOperatorExtensions) {
      const extReplacements = ext.rewrite(stream, source, { mode: options.mode });
      replacements.push(...extReplacements);
    }

    if (replacements.length > 0) {
      applyReplacementsToMagicString(s, replacements);
      changed = true;
    }
  }

  // Phase 2: Apply operator extensions iteratively
  if (operatorExtensions.length > 0) {
    const customOperatorDefs: CustomOperatorDef[] = operatorExtensions.map((op) => ({
      symbol: op.symbol,
      chars: op.symbol.split(""),
    }));

    // After phase 1, get the current code state for operator processing
    // We need to work on the transformed code, but MagicString tracks original positions
    const currentSource = s.toString();
    const tokens = tokenize(currentSource, {
      customOperators: customOperatorDefs,
      fileName: options.fileName,
    });

    const hasOperators = tokens.some((t) => t.isCustomOperator);

    if (hasOperators) {
      // Operator rewriting needs to work iteratively on its own MagicString
      // because positions change after each replacement
      const operatorResult = rewriteOperatorsIteratively(
        currentSource,
        operatorExtensions,
        customOperatorDefs,
        options.fileName
      );

      if (operatorResult.changed) {
        // Overwrite the entire content with the operator-rewritten result.
        // NOTE (Finding #9): This loses fine-grained source mapping because operator
        // rewriting is iterative - each replacement changes positions of subsequent operators.
        // A proper fix would require tracking cumulative position offsets or using MagicString
        // throughout the iterative process. Since operators are typically simple transforms
        // and source maps still work for HKT and other non-operator extensions, this is
        // acceptable for now.
        s.overwrite(0, source.length, operatorResult.code);
        changed = true;
      }
    }
  }

  if (!changed) {
    return { code: source, changed: false, map: null };
  }

  const map = s.generateMap({
    hires: true,
    includeContent: true,
  }) as RawSourceMap;

  return { code: s.toString(), changed: true, map };
}

/**
 * Iteratively rewrite operators until no more remain.
 *
 * Operators are processed one at a time because each replacement can change
 * the positions of subsequent operators. This function returns the final
 * transformed code.
 */
function rewriteOperatorsIteratively(
  source: string,
  operators: CustomOperatorExtension[],
  operatorDefs: CustomOperatorDef[],
  fileName?: string
): { code: string; changed: boolean } {
  let currentSource = source;
  let changed = false;

  let iterations = 0;
  const maxIterations = 1000;

  while (iterations < maxIterations) {
    iterations++;

    const tokens = tokenize(currentSource, {
      customOperators: operatorDefs,
      fileName,
    });

    const operatorOccurrences = findOperatorOccurrences(tokens, operators);

    if (operatorOccurrences.length === 0) {
      break;
    }

    const selected = selectNextOperator(operatorOccurrences);

    if (!selected) {
      break;
    }

    const { tokenIndex, operator, token } = selected;

    const leftBoundary = findLeftOperandBoundary(
      tokens,
      tokenIndex,
      operators,
      operator.precedence,
      operator.associativity
    );

    const rightBoundary = findRightOperandBoundary(
      tokens,
      tokenIndex,
      operators,
      operator.precedence,
      operator.associativity
    );

    if (leftBoundary >= tokenIndex || rightBoundary <= tokenIndex) {
      break;
    }

    const leftStart = tokens[leftBoundary].start;
    const rightEnd = tokens[rightBoundary].end;
    const opStart = token.start;
    const opEnd = token.end;

    const leftText = currentSource.slice(leftStart, opStart).trim();
    const rightText = currentSource.slice(opEnd, rightEnd).trim();

    const transformed = operator.transform(leftText, rightText);

    currentSource = currentSource.slice(0, leftStart) + transformed + currentSource.slice(rightEnd);
    changed = true;
  }

  return { code: currentSource, changed };
}

interface OperatorOccurrence {
  tokenIndex: number;
  operator: CustomOperatorExtension;
  token: Token;
}

function findOperatorOccurrences(
  tokens: readonly Token[],
  operators: CustomOperatorExtension[]
): OperatorOccurrence[] {
  const operatorMap = new Map(operators.map((op) => [op.symbol, op]));
  const occurrences: OperatorOccurrence[] = [];

  // Track type context state
  let typeAnnotationDepth = 0; // Depth of type annotation context (e.g., `: Type`)
  let inTypeAlias = false; // Whether we're in a `type X = ...` declaration
  let inInterface = false; // Whether we're in an `interface X { ... }` body
  let angleBracketDepth = 0;
  let lastSignificantKind: ts.SyntaxKind | null = null;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const kind = token.kind;

    // Track angle brackets for generics (which are always type context)
    if (kind === ts.SyntaxKind.LessThanToken && !token.isCustomOperator) {
      // Heuristic: < following an identifier is likely a generic
      if (
        lastSignificantKind === ts.SyntaxKind.Identifier ||
        lastSignificantKind === ts.SyntaxKind.TypeKeyword ||
        lastSignificantKind === ts.SyntaxKind.InterfaceKeyword ||
        lastSignificantKind === ts.SyntaxKind.ClassKeyword ||
        lastSignificantKind === ts.SyntaxKind.FunctionKeyword
      ) {
        angleBracketDepth++;
      }
    } else if (kind === ts.SyntaxKind.GreaterThanToken) {
      if (angleBracketDepth > 0) {
        angleBracketDepth--;
      }
    }

    // Enter type alias context after `type` keyword
    if (kind === ts.SyntaxKind.TypeKeyword) {
      inTypeAlias = true;
    }

    // Enter interface context after `interface` keyword
    if (kind === ts.SyntaxKind.InterfaceKeyword) {
      inInterface = true;
    }

    // Exit type alias at semicolon (end of statement)
    if (kind === ts.SyntaxKind.SemicolonToken) {
      inTypeAlias = false;
      typeAnnotationDepth = 0;
    }

    // Exit interface at closing brace (end of interface body)
    if (kind === ts.SyntaxKind.CloseBraceToken && inInterface) {
      inInterface = false;
    }

    // After colon, we're in type annotation until =, ), }, or statement end
    // But only if we're not already in a type alias
    if (kind === ts.SyntaxKind.ColonToken) {
      typeAnnotationDepth++;
    }

    // Exit type annotation at assignment, closing brackets, or statement boundaries
    // But NOT if we're in a type alias (type X = Y should keep the whole Y in type context)
    if (
      typeAnnotationDepth > 0 &&
      !inTypeAlias &&
      (kind === ts.SyntaxKind.EqualsToken ||
        kind === ts.SyntaxKind.CloseParenToken ||
        kind === ts.SyntaxKind.CloseBraceToken ||
        kind === ts.SyntaxKind.CommaToken ||
        kind === ts.SyntaxKind.OpenBraceToken)
    ) {
      typeAnnotationDepth = Math.max(0, typeAnnotationDepth - 1);
    }

    // Track last significant token for heuristics
    if (kind !== ts.SyntaxKind.WhitespaceTrivia && kind !== ts.SyntaxKind.NewLineTrivia) {
      lastSignificantKind = kind;
    }

    // Skip operators in type contexts
    if (token.isCustomOperator) {
      const inTypeContext =
        typeAnnotationDepth > 0 || angleBracketDepth > 0 || inTypeAlias || inInterface;

      if (!inTypeContext) {
        const op = operatorMap.get(token.text);
        if (op) {
          occurrences.push({
            tokenIndex: i,
            operator: op,
            token,
          });
        }
      }
    }
  }

  return occurrences;
}

function selectNextOperator(occurrences: OperatorOccurrence[]): OperatorOccurrence | null {
  if (occurrences.length === 0) {
    return null;
  }

  const byPrecedence = new Map<number, OperatorOccurrence[]>();
  for (const occ of occurrences) {
    const prec = occ.operator.precedence;
    const list = byPrecedence.get(prec) ?? [];
    list.push(occ);
    byPrecedence.set(prec, list);
  }

  const highestPrecedence = Math.max(...byPrecedence.keys());
  const atHighest = byPrecedence.get(highestPrecedence)!;

  const associativity = atHighest[0].operator.associativity;

  if (associativity === "left") {
    return atHighest.reduce((a, b) => (a.token.start < b.token.start ? a : b));
  } else {
    return atHighest.reduce((a, b) => (a.token.start > b.token.start ? a : b));
  }
}

function findLeftOperandBoundary(
  tokens: readonly Token[],
  operatorIndex: number,
  operators: CustomOperatorExtension[],
  currentPrecedence: number,
  associativity: "left" | "right"
): number {
  const operatorPrecedences = new Map(operators.map((op) => [op.symbol, op.precedence]));
  let bracketDepth = 0;
  let i = operatorIndex - 1;

  while (i >= 0) {
    const token = tokens[i];

    if (isCloseBracket(token)) {
      bracketDepth++;
      i--;
      continue;
    }

    if (isOpenBracket(token)) {
      if (bracketDepth > 0) {
        bracketDepth--;
        i--;
        continue;
      }
      return i + 1;
    }

    if (bracketDepth === 0) {
      if (isBoundaryToken(token)) {
        return i + 1;
      }

      if (token.isCustomOperator) {
        const prec = operatorPrecedences.get(token.text);
        if (prec !== undefined) {
          if (associativity === "right") {
            if (prec <= currentPrecedence) {
              return i + 1;
            }
          } else {
            if (prec < currentPrecedence) {
              return i + 1;
            }
          }
        }
      }
    }

    i--;
  }

  return 0;
}

function findRightOperandBoundary(
  tokens: readonly Token[],
  operatorIndex: number,
  operators: CustomOperatorExtension[],
  currentPrecedence: number,
  associativity: "left" | "right"
): number {
  const operatorPrecedences = new Map(operators.map((op) => [op.symbol, op.precedence]));
  let bracketDepth = 0;
  let i = operatorIndex + 1;
  let lastValidIndex = operatorIndex;

  while (i < tokens.length) {
    const token = tokens[i];

    if (isOpenBracket(token)) {
      bracketDepth++;
      lastValidIndex = i;
      i++;
      continue;
    }

    if (isCloseBracket(token)) {
      if (bracketDepth > 0) {
        bracketDepth--;
        lastValidIndex = i;
        i++;
        continue;
      }
      return lastValidIndex;
    }

    if (bracketDepth === 0) {
      if (isBoundaryToken(token)) {
        return lastValidIndex;
      }

      if (token.isCustomOperator) {
        const prec = operatorPrecedences.get(token.text);
        if (prec !== undefined) {
          if (associativity === "left") {
            if (prec <= currentPrecedence) {
              return lastValidIndex;
            }
          } else {
            if (prec < currentPrecedence) {
              return lastValidIndex;
            }
          }
        }
      }
    }

    lastValidIndex = i;
    i++;
  }

  return lastValidIndex;
}

function isOpenBracket(token: Token): boolean {
  return (
    token.kind === ts.SyntaxKind.OpenBraceToken ||
    token.kind === ts.SyntaxKind.OpenParenToken ||
    token.kind === ts.SyntaxKind.OpenBracketToken
  );
}

function isCloseBracket(token: Token): boolean {
  return (
    token.kind === ts.SyntaxKind.CloseBraceToken ||
    token.kind === ts.SyntaxKind.CloseParenToken ||
    token.kind === ts.SyntaxKind.CloseBracketToken
  );
}

/**
 * Get the list of enabled extensions based on options.
 */
function getEnabledExtensions(options: PreprocessOptions): AnyExtension[] {
  const extensions: AnyExtension[] = [];

  if (options.extensions) {
    for (const name of options.extensions) {
      const ext = BUILT_IN_EXTENSIONS[name];
      if (ext) {
        extensions.push(ext);
      }
    }
  } else {
    extensions.push(...Object.values(BUILT_IN_EXTENSIONS));
  }

  if (options.customExtensions) {
    extensions.push(...options.customExtensions);
  }

  return extensions;
}

/**
 * Apply replacements to a MagicString instance.
 *
 * Replacements must be sorted by start position (ascending) to avoid issues
 * with overlapping or out-of-order modifications.
 */
function applyReplacementsToMagicString(s: MagicString, replacements: Replacement[]): void {
  // Sort by start position ascending - MagicString handles position tracking
  const sorted = [...replacements].sort((a, b) => a.start - b.start);

  for (const rep of sorted) {
    if (rep.start === rep.end) {
      // Insert at position
      s.appendLeft(rep.start, rep.text);
    } else {
      // Replace range
      s.overwrite(rep.start, rep.end, rep.text);
    }
  }
}

export default preprocess;

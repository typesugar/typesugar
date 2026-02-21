/**
 * Token stream with cursor and lookahead for syntax extension processing
 */

import { Token, isOpenBracket, getMatchingClose } from "./scanner.js";

export class TokenStream {
  private tokens: Token[];
  private pos: number = 0;
  private source: string;

  constructor(tokens: Token[], source: string) {
    this.tokens = tokens;
    this.source = source;
  }

  get position(): number {
    return this.pos;
  }

  get length(): number {
    return this.tokens.length;
  }

  atEnd(): boolean {
    return this.pos >= this.tokens.length;
  }

  current(): Token | null {
    return this.tokens[this.pos] ?? null;
  }

  peek(offset: number = 0): Token | null {
    return this.tokens[this.pos + offset] ?? null;
  }

  /**
   * Get the source text between two token positions (inclusive of start, exclusive of end)
   */
  getSourceBetween(startToken: Token, endToken: Token): string {
    return this.source.slice(startToken.start, endToken.start);
  }

  /**
   * Get the source text for a range of tokens (inclusive)
   */
  getSourceRange(startIndex: number, endIndex: number): string {
    if (startIndex > endIndex || startIndex < 0 || endIndex >= this.tokens.length) {
      return "";
    }
    const start = this.tokens[startIndex].start;
    const end = this.tokens[endIndex].end;
    return this.source.slice(start, end);
  }

  /**
   * Skip over a balanced bracket group from current position.
   * Assumes current token is an open bracket.
   *
   * @returns Index after the matching close bracket, or -1 if unbalanced
   */
  skipBracketGroup(): number {
    const openToken = this.current();
    if (!openToken || !isOpenBracket(openToken)) {
      return -1;
    }

    const closeKind = getMatchingClose(openToken.kind);
    if (closeKind === null) {
      return -1;
    }

    let depth = 1;
    let i = this.pos + 1;

    while (i < this.tokens.length && depth > 0) {
      const token = this.tokens[i];
      if (token.kind === openToken.kind) {
        depth++;
      } else if (token.kind === closeKind) {
        depth--;
      }
      i++;
    }

    if (depth !== 0) {
      return -1;
    }

    return i;
  }

  /**
   * Find all occurrences of a custom operator in the token stream
   */
  findCustomOperators(symbol: string): number[] {
    const positions: number[] = [];
    for (let i = 0; i < this.tokens.length; i++) {
      const token = this.tokens[i];
      if (token.isCustomOperator && token.text === symbol) {
        positions.push(i);
      }
    }
    return positions;
  }

  /**
   * Get all tokens
   */
  getTokens(): readonly Token[] {
    return this.tokens;
  }

  /**
   * Clone the stream at its current position
   */
  clone(): TokenStream {
    const cloned = new TokenStream([...this.tokens], this.source);
    cloned.pos = this.pos;
    return cloned;
  }
}

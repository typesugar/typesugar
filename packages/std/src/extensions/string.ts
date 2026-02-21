/**
 * String Extension Methods
 *
 * The best from:
 * - Ruby (capitalize, downcase, upcase, strip, squeeze, chars, lines, scan, gsub, tr)
 * - Kotlin (isBlank, isNotBlank, trimIndent, removeSurrounding, substringBefore/After, lines)
 * - Swift (hasPrefix, hasSuffix, lowercased, uppercased, trimmingCharacters, components)
 * - Python (str methods: title, swapcase, center, ljust, rjust, zfill, isalpha, isdigit, isalnum)
 * - Scala (stripMargin, stripPrefix, stripSuffix, r (regex), split, mkString)
 * - Rust (chars, contains, starts_with, ends_with, trim, to_lowercase, to_uppercase, repeat)
 * - Lodash/Ramda (camelCase, snakeCase, kebabCase, startCase, words, truncate, pad, escape, unescape)
 * - Most-requested JS/TS: slugify, truncate, template, reverse, isEmail, isURL, toNumber
 */

// ============================================================================
// Case Transformations (Lodash-tier + Ruby + Python)
// ============================================================================

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function uncapitalize(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

export function titleCase(s: string): string {
  return words(s)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export function swapCase(s: string): string {
  return [...s].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join("");
}

export function camelCase(s: string): string {
  const w = words(s);
  return w
    .map((word, i) =>
      i === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    )
    .join("");
}

export function pascalCase(s: string): string {
  return words(s)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}

export function snakeCase(s: string): string {
  return words(s)
    .map((w) => w.toLowerCase())
    .join("_");
}

export function kebabCase(s: string): string {
  return words(s)
    .map((w) => w.toLowerCase())
    .join("-");
}

export function constantCase(s: string): string {
  return words(s)
    .map((w) => w.toUpperCase())
    .join("_");
}

export function dotCase(s: string): string {
  return words(s)
    .map((w) => w.toLowerCase())
    .join(".");
}

export function pathCase(s: string): string {
  return words(s)
    .map((w) => w.toLowerCase())
    .join("/");
}

export function sentenceCase(s: string): string {
  const w = words(s);
  return w
    .map((word, i) => (i === 0 ? capitalize(word.toLowerCase()) : word.toLowerCase()))
    .join(" ");
}

// ============================================================================
// Word/Line Splitting
// ============================================================================

export function words(s: string): string[] {
  return s.match(/[A-Z]?[a-z]+|[A-Z]+(?=[A-Z][a-z]|\d|\b)|[A-Z]|[0-9]+/g) || [];
}

export function lines(s: string): string[] {
  return s.split(/\r?\n/);
}

export function chars(s: string): string[] {
  return [...s];
}

export function graphemes(s: string): string[] {
  return [...new Intl.Segmenter().segment(s)].map((seg) => seg.segment);
}

// ============================================================================
// Trimming & Stripping (Kotlin + Scala + Python)
// ============================================================================

export function trimIndent(s: string): string {
  const ls = lines(s);
  const nonEmpty = ls.filter((l) => l.trim().length > 0);
  if (nonEmpty.length === 0) return s;
  const minIndent = Math.min(...nonEmpty.map((l) => l.match(/^\s*/)?.[0].length ?? 0));
  return ls.map((l) => l.slice(minIndent)).join("\n");
}

export function stripMargin(s: string, marginChar: string = "|"): string {
  const re = new RegExp(`^\\s*\\${marginChar}`, "gm");
  return s.replace(re, "");
}

export function stripPrefix(s: string, prefix: string): string {
  return s.startsWith(prefix) ? s.slice(prefix.length) : s;
}

export function stripSuffix(s: string, suffix: string): string {
  return s.endsWith(suffix) ? s.slice(0, -suffix.length) : s;
}

export function removeSurrounding(s: string, prefix: string, suffix?: string): string {
  const suf = suffix ?? prefix;
  if (s.startsWith(prefix) && s.endsWith(suf)) {
    return s.slice(prefix.length, s.length - suf.length);
  }
  return s;
}

export function squeeze(s: string, char?: string): string {
  if (char) {
    const escaped = char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return s.replace(new RegExp(`(${escaped})+`, "g"), char);
  }
  return s.replace(/(.)\1+/g, "$1");
}

export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// ============================================================================
// Padding & Alignment (Python ljust/rjust/center/zfill)
// ============================================================================

export function center(s: string, width: number, fill: string = " "): string {
  if (s.length >= width) return s;
  const totalPad = width - s.length;
  const left = Math.floor(totalPad / 2);
  const right = totalPad - left;
  return fill.repeat(left).slice(0, left) + s + fill.repeat(right).slice(0, right);
}

export function padLeft(s: string, width: number, fill: string = " "): string {
  return s.padStart(width, fill);
}

export function padRight(s: string, width: number, fill: string = " "): string {
  return s.padEnd(width, fill);
}

export function zfill(s: string, width: number): string {
  const neg = s.startsWith("-");
  const abs = neg ? s.slice(1) : s;
  return (neg ? "-" : "") + abs.padStart(width - (neg ? 1 : 0), "0");
}

// ============================================================================
// Truncation & Ellipsis
// ============================================================================

export function truncate(s: string, maxLength: number, suffix: string = "..."): string {
  if (s.length <= maxLength) return s;
  return s.slice(0, maxLength - suffix.length) + suffix;
}

export function truncateWords(s: string, maxWords: number, suffix: string = "..."): string {
  const w = s.split(/\s+/);
  if (w.length <= maxWords) return s;
  return w.slice(0, maxWords).join(" ") + suffix;
}

export function ellipsis(s: string, maxLength: number): string {
  return truncate(s, maxLength, "\u2026");
}

// ============================================================================
// Search & Extract (Kotlin substringBefore/After, Ruby scan)
// ============================================================================

export function substringBefore(s: string, delimiter: string): string {
  const idx = s.indexOf(delimiter);
  return idx === -1 ? s : s.slice(0, idx);
}

export function substringAfter(s: string, delimiter: string): string {
  const idx = s.indexOf(delimiter);
  return idx === -1 ? s : s.slice(idx + delimiter.length);
}

export function substringBeforeLast(s: string, delimiter: string): string {
  const idx = s.lastIndexOf(delimiter);
  return idx === -1 ? s : s.slice(0, idx);
}

export function substringAfterLast(s: string, delimiter: string): string {
  const idx = s.lastIndexOf(delimiter);
  return idx === -1 ? s : s.slice(idx + delimiter.length);
}

export function between(s: string, start: string, end: string): string {
  const startIdx = s.indexOf(start);
  if (startIdx === -1) return "";
  const endIdx = s.indexOf(end, startIdx + start.length);
  if (endIdx === -1) return "";
  return s.slice(startIdx + start.length, endIdx);
}

export function scan(s: string, pattern: RegExp): string[] {
  const flags = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g";
  const re = new RegExp(pattern.source, flags);
  return [...s.matchAll(re)].map((m) => m[0]);
}

export function count(s: string, sub: string): number {
  if (sub.length === 0) return 0;
  let n = 0;
  let pos = 0;
  while ((pos = s.indexOf(sub, pos)) !== -1) {
    n++;
    pos += sub.length;
  }
  return n;
}

// ============================================================================
// Transformation
// ============================================================================

export function reverse(s: string): string {
  return [...s].reverse().join("");
}

export function replaceAll(s: string, search: string, replacement: string): string {
  return s.split(search).join(replacement);
}

export function insert(s: string, index: number, value: string): string {
  return s.slice(0, index) + value + s.slice(index);
}

export function remove(s: string, pattern: string | RegExp): string {
  if (typeof pattern === "string") return replaceAll(s, pattern, "");
  return s.replace(pattern, "");
}

export function wrap(s: string, wrapper: string): string {
  return wrapper + s + wrapper;
}

export function unwrap(s: string, wrapper: string): string {
  return removeSurrounding(s, wrapper);
}

export function indent(s: string, spaces: number = 2, char: string = " "): string {
  const prefix = char.repeat(spaces);
  return lines(s)
    .map((l) => prefix + l)
    .join("\n");
}

export function dedent(s: string): string {
  return trimIndent(s);
}

export function mask(s: string, start: number = 0, end?: number, maskChar: string = "*"): string {
  const e = end ?? s.length;
  return s.slice(0, start) + maskChar.repeat(e - start) + s.slice(e);
}

// ============================================================================
// Predicates (Kotlin + Python)
// ============================================================================

export function isBlank(s: string): boolean {
  return s.trim().length === 0;
}

export function isNotBlank(s: string): boolean {
  return s.trim().length > 0;
}

export function isAlpha(s: string): boolean {
  return s.length > 0 && /^[a-zA-Z]+$/.test(s);
}

export function isAlphaNumeric(s: string): boolean {
  return s.length > 0 && /^[a-zA-Z0-9]+$/.test(s);
}

export function isDigit(s: string): boolean {
  return s.length > 0 && /^[0-9]+$/.test(s);
}

export function isLowerCase(s: string): boolean {
  return s === s.toLowerCase() && s !== s.toUpperCase();
}

export function isUpperCase(s: string): boolean {
  return s === s.toUpperCase() && s !== s.toLowerCase();
}

export function isAscii(s: string): boolean {
  return /^[\x00-\x7F]*$/.test(s);
}

export function isPalindrome(s: string): boolean {
  const clean = s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return clean === [...clean].reverse().join("");
}

export function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export function isUrl(s: string): boolean {
  try {
    new URL(s);
    return true;
  } catch {
    return false;
  }
}

export function isJson(s: string): boolean {
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}

export function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

export function isHex(s: string): boolean {
  return /^(0x)?[0-9a-fA-F]+$/.test(s);
}

// ============================================================================
// Conversion
// ============================================================================

export function toSlug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function toNumber(s: string): number | undefined {
  const n = Number(s);
  return isNaN(n) ? undefined : n;
}

export function toInt(s: string, radix: number = 10): number | undefined {
  const n = parseInt(s, radix);
  return isNaN(n) ? undefined : n;
}

export function toFloat(s: string): number | undefined {
  const n = parseFloat(s);
  return isNaN(n) ? undefined : n;
}

export function toBoolean(s: string): boolean | undefined {
  const lower = s.trim().toLowerCase();
  if (lower === "true" || lower === "1" || lower === "yes") return true;
  if (lower === "false" || lower === "0" || lower === "no") return false;
  return undefined;
}

export function toCharCodes(s: string): number[] {
  return [...s].map((c) => c.codePointAt(0)!);
}

export function fromCharCodes(codes: number[]): string {
  return String.fromCodePoint(...codes);
}

// ============================================================================
// Encoding & Escaping
// ============================================================================

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function unescapeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function toBase64(s: string): string {
  if (typeof btoa !== "undefined") return btoa(s);
  return Buffer.from(s).toString("base64");
}

export function fromBase64(s: string): string {
  if (typeof atob !== "undefined") return atob(s);
  return Buffer.from(s, "base64").toString();
}

// ============================================================================
// Aggregate
// ============================================================================

export const StringExt = {
  capitalize,
  uncapitalize,
  titleCase,
  swapCase,
  camelCase,
  pascalCase,
  snakeCase,
  kebabCase,
  constantCase,
  dotCase,
  pathCase,
  sentenceCase,
  words,
  lines,
  chars,
  graphemes,
  trimIndent,
  stripMargin,
  stripPrefix,
  stripSuffix,
  removeSurrounding,
  squeeze,
  collapseWhitespace,
  center,
  padLeft,
  padRight,
  zfill,
  truncate,
  truncateWords,
  ellipsis,
  substringBefore,
  substringAfter,
  substringBeforeLast,
  substringAfterLast,
  between,
  scan,
  count,
  reverse,
  replaceAll,
  insert,
  remove,
  wrap,
  unwrap,
  indent,
  dedent,
  mask,
  isBlank,
  isNotBlank,
  isAlpha,
  isAlphaNumeric,
  isDigit,
  isLowerCase,
  isUpperCase,
  isAscii,
  isPalindrome,
  isEmail,
  isUrl,
  isJson,
  isUuid,
  isHex,
  toSlug,
  toNumber,
  toInt,
  toFloat,
  toBoolean,
  toCharCodes,
  fromCharCodes,
  escapeHtml,
  unescapeHtml,
  escapeRegex,
  toBase64,
  fromBase64,
} as const;

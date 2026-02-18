/**
 * Date Extension Methods
 *
 * The best from:
 * - date-fns (addDays, subDays, differenceInDays, format, isAfter, isBefore, startOfDay, etc.)
 * - Moment/Luxon (add, subtract, diff, startOf, endOf, isSame, isBetween)
 * - Kotlin (java.time: plusDays, minusDays, atStartOfDay, until, isAfter, isBefore)
 * - Scala (java.time wrappers)
 * - Ruby (beginning_of_day, end_of_day, ago, since, strftime)
 * - Most-requested JS/TS: relative time, format, add/subtract, diff, start/end of period
 */

// ============================================================================
// Arithmetic
// ============================================================================

export function addMilliseconds(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}

export function addSeconds(date: Date, seconds: number): Date {
  return addMilliseconds(date, seconds * 1000);
}

export function addMinutes(date: Date, minutes: number): Date {
  return addMilliseconds(date, minutes * 60_000);
}

export function addHours(date: Date, hours: number): Date {
  return addMilliseconds(date, hours * 3_600_000);
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function addWeeks(date: Date, weeks: number): Date {
  return addDays(date, weeks * 7);
}

export function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const day = result.getDate();
  result.setMonth(result.getMonth() + months);
  if (result.getDate() !== day) result.setDate(0);
  return result;
}

export function addYears(date: Date, years: number): Date {
  return addMonths(date, years * 12);
}

// ============================================================================
// Difference
// ============================================================================

export function diffInMilliseconds(a: Date, b: Date): number {
  return a.getTime() - b.getTime();
}

export function diffInSeconds(a: Date, b: Date): number {
  return diffInMilliseconds(a, b) / 1000;
}

export function diffInMinutes(a: Date, b: Date): number {
  return diffInMilliseconds(a, b) / 60_000;
}

export function diffInHours(a: Date, b: Date): number {
  return diffInMilliseconds(a, b) / 3_600_000;
}

export function diffInDays(a: Date, b: Date): number {
  return diffInMilliseconds(a, b) / 86_400_000;
}

export function diffInWeeks(a: Date, b: Date): number {
  return diffInDays(a, b) / 7;
}

export function diffInMonths(a: Date, b: Date): number {
  return (a.getFullYear() - b.getFullYear()) * 12 + (a.getMonth() - b.getMonth());
}

export function diffInYears(a: Date, b: Date): number {
  return a.getFullYear() - b.getFullYear();
}

// ============================================================================
// Start/End of Period (date-fns/Moment startOf/endOf)
// ============================================================================

export function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function endOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

export function startOfWeek(date: Date, weekStartsOn: number = 0): Date {
  const result = new Date(date);
  const day = result.getDay();
  const diff = (day < weekStartsOn ? 7 : 0) + day - weekStartsOn;
  result.setDate(result.getDate() - diff);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

export function startOfYear(date: Date): Date {
  return new Date(date.getFullYear(), 0, 1);
}

export function endOfYear(date: Date): Date {
  return new Date(date.getFullYear(), 11, 31, 23, 59, 59, 999);
}

// ============================================================================
// Comparison & Predicates
// ============================================================================

export function isAfter(date: Date, other: Date): boolean {
  return date.getTime() > other.getTime();
}

export function isBefore(date: Date, other: Date): boolean {
  return date.getTime() < other.getTime();
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export function isSameYear(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear();
}

export function isBetweenDates(date: Date, start: Date, end: Date): boolean {
  const t = date.getTime();
  return t >= start.getTime() && t <= end.getTime();
}

export function isToday(date: Date): boolean {
  return isSameDay(date, new Date());
}

export function isYesterday(date: Date): boolean {
  return isSameDay(date, addDays(new Date(), -1));
}

export function isTomorrow(date: Date): boolean {
  return isSameDay(date, addDays(new Date(), 1));
}

export function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

export function isWeekday(date: Date): boolean {
  return !isWeekend(date);
}

export function isLeapYear(date: Date): boolean {
  const year = date.getFullYear();
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

// ============================================================================
// Formatting
// ============================================================================

export function formatRelative(date: Date, now: Date = new Date()): string {
  const diffMs = now.getTime() - date.getTime();
  const absDiff = Math.abs(diffMs);
  const future = diffMs < 0;
  const suffix = future ? "from now" : "ago";

  if (absDiff < 1000) return "just now";
  if (absDiff < 60_000) return `${Math.floor(absDiff / 1000)} seconds ${suffix}`;
  if (absDiff < 3_600_000) return `${Math.floor(absDiff / 60_000)} minutes ${suffix}`;
  if (absDiff < 86_400_000) return `${Math.floor(absDiff / 3_600_000)} hours ${suffix}`;
  if (absDiff < 2_592_000_000) return `${Math.floor(absDiff / 86_400_000)} days ${suffix}`;
  if (absDiff < 31_536_000_000) return `${Math.floor(absDiff / 2_592_000_000)} months ${suffix}`;
  return `${Math.floor(absDiff / 31_536_000_000)} years ${suffix}`;
}

export function formatISO(date: Date): string {
  return date.toISOString();
}

export function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

export function formatTime(date: Date): string {
  return date.toTimeString().split(" ")[0];
}

export function formatDateTime(date: Date): string {
  return `${formatDate(date)} ${formatTime(date)}`;
}

export function dayOfYear(date: Date): number {
  const start = startOfYear(date);
  return Math.floor(diffInDays(date, start)) + 1;
}

export function weekOfYear(date: Date): number {
  const start = startOfYear(date);
  return Math.ceil((diffInDays(date, start) + start.getDay() + 1) / 7);
}

export function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

export function daysInYear(date: Date): number {
  return isLeapYear(date) ? 366 : 365;
}

export function quarter(date: Date): number {
  return Math.floor(date.getMonth() / 3) + 1;
}

// ============================================================================
// Clamp & Range
// ============================================================================

export function clampDate(date: Date, min: Date, max: Date): Date {
  const t = date.getTime();
  if (t < min.getTime()) return new Date(min);
  if (t > max.getTime()) return new Date(max);
  return new Date(date);
}

export function minDate(...dates: Date[]): Date {
  return new Date(Math.min(...dates.map((d) => d.getTime())));
}

export function maxDate(...dates: Date[]): Date {
  return new Date(Math.max(...dates.map((d) => d.getTime())));
}

export function eachDay(start: Date, end: Date): Date[] {
  const result: Date[] = [];
  let current = startOfDay(start);
  const last = startOfDay(end);
  while (current <= last) {
    result.push(new Date(current));
    current = addDays(current, 1);
  }
  return result;
}

// ============================================================================
// Aggregate
// ============================================================================

export const DateExt = {
  addMilliseconds,
  addSeconds,
  addMinutes,
  addHours,
  addDays,
  addWeeks,
  addMonths,
  addYears,
  diffInMilliseconds,
  diffInSeconds,
  diffInMinutes,
  diffInHours,
  diffInDays,
  diffInWeeks,
  diffInMonths,
  diffInYears,
  startOfDay,
  endOfDay,
  startOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  isAfter,
  isBefore,
  isSameDay,
  isSameMonth,
  isSameYear,
  isBetween: isBetweenDates,
  isToday,
  isYesterday,
  isTomorrow,
  isWeekend,
  isWeekday,
  isLeapYear,
  formatRelative,
  formatISO,
  formatDate,
  formatTime,
  formatDateTime,
  dayOfYear,
  weekOfYear,
  daysInMonth,
  daysInYear,
  quarter,
  clamp: clampDate,
  min: minDate,
  max: maxDate,
  eachDay,
} as const;

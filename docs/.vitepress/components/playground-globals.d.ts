// Global type declarations for the playground TypeScript language service worker.
// These provide the worker with enough type information to avoid false "Cannot find name"
// errors for standard JavaScript globals (console, Math, JSON, etc.)

declare var console: {
  log(...args: any[]): void;
  error(...args: any[]): void;
  warn(...args: any[]): void;
  info(...args: any[]): void;
};

declare var Math: {
  random(): number;
  floor(x: number): number;
  ceil(x: number): number;
  round(x: number): number;
  abs(x: number): number;
  min(...values: number[]): number;
  max(...values: number[]): number;
  pow(base: number, exponent: number): number;
  sqrt(x: number): number;
  PI: number;
  E: number;
  log(x: number): number;
  imul(a: number, b: number): number;
};

declare var JSON: {
  parse(text: string, reviver?: (key: string, value: any) => any): any;
  stringify(value: any, replacer?: any, space?: string | number): string;
};

declare var parseInt: (string: string, radix?: number) => number;
declare var parseFloat: (string: string) => number;
declare var isNaN: (number: number) => boolean;
declare var isFinite: (number: number) => boolean;
declare var setTimeout: (callback: (...args: any[]) => void, ms?: number) => number;
declare var clearTimeout: (id: number) => void;
declare var Infinity: number;
declare var NaN: number;
declare var undefined: undefined;

interface Array<T> {
  length: number;
  push(...items: T[]): number;
  pop(): T | undefined;
  map<U>(callbackfn: (value: T, index: number) => U): U[];
  filter(predicate: (value: T) => boolean): T[];
  reduce<U>(callbackfn: (prev: U, curr: T) => U, initialValue: U): U;
  forEach(callbackfn: (value: T) => void): void;
  join(separator?: string): string;
  indexOf(searchElement: T): number;
  includes(searchElement: T): boolean;
  slice(start?: number, end?: number): T[];
  find(predicate: (value: T) => boolean): T | undefined;
  some(predicate: (value: T) => boolean): boolean;
  every(predicate: (value: T) => boolean): boolean;
  flatMap<U>(callback: (value: T) => U | U[]): U[];
  splice(start: number, deleteCount?: number, ...items: T[]): T[];
  sort(compareFn?: (a: T, b: T) => number): this;
  [n: number]: T;
  [Symbol.iterator](): IterableIterator<T>;
}

interface String {
  length: number;
  charAt(pos: number): string;
  indexOf(searchString: string): number;
  includes(searchString: string): boolean;
  slice(start?: number, end?: number): string;
  substring(start: number, end?: number): string;
  trim(): string;
  split(separator: string | RegExp, limit?: number): string[];
  replace(searchValue: string | RegExp, replaceValue: string): string;
  startsWith(searchString: string): boolean;
  endsWith(searchString: string): boolean;
  toUpperCase(): string;
  toLowerCase(): string;
  match(regexp: string | RegExp): RegExpMatchArray | null;
  padStart(maxLength: number, fillString?: string): string;
  padEnd(maxLength: number, fillString?: string): string;
}

interface Number {
  toFixed(fractionDigits?: number): string;
  toString(radix?: number): string;
}
interface Boolean {}
interface Function {
  bind(thisArg: any, ...argArray: any[]): any;
  call(thisArg: any, ...argArray: any[]): any;
}
interface Object {
  toString(): string;
  hasOwnProperty(v: string): boolean;
}

interface RegExp {
  test(string: string): boolean;
  exec(string: string): RegExpExecArray | null;
}
interface RegExpMatchArray extends Array<string> {
  index?: number;
}
interface RegExpExecArray extends Array<string> {
  index: number;
}

interface Error {
  message: string;
  name: string;
  stack?: string;
}
interface ErrorConstructor {
  new (message?: string): Error;
}
declare var Error: ErrorConstructor;

interface Date {
  toISOString(): string;
  getTime(): number;
}
interface DateConstructor {
  new (): Date;
  new (value: number | string): Date;
  now(): number;
}
declare var Date: DateConstructor;

interface Map<K, V> {
  get(key: K): V | undefined;
  set(key: K, value: V): this;
  has(key: K): boolean;
  delete(key: K): boolean;
  size: number;
}
interface MapConstructor {
  new <K, V>(entries?: readonly (readonly [K, V])[]): Map<K, V>;
}
declare var Map: MapConstructor;

interface Set<T> {
  add(value: T): this;
  has(value: T): boolean;
  delete(value: T): boolean;
  size: number;
}
interface SetConstructor {
  new <T>(values?: readonly T[]): Set<T>;
}
declare var Set: SetConstructor;

interface Promise<T> {
  then<R1 = T, R2 = never>(
    onfulfilled?: ((value: T) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: any) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2>;
  catch<R = never>(
    onrejected?: ((reason: any) => R | PromiseLike<R>) | null,
  ): Promise<T | R>;
}
interface PromiseLike<T> {
  then<R1 = T, R2 = never>(
    onfulfilled?: ((value: T) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: any) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2>;
}
interface PromiseConstructor {
  new <T>(
    executor: (resolve: (value: T) => void, reject: (reason?: any) => void) => void,
  ): Promise<T>;
  resolve<T>(value: T): Promise<T>;
  reject<T = never>(reason?: any): Promise<T>;
  all<T>(values: readonly (T | PromiseLike<T>)[]): Promise<T[]>;
}
declare var Promise: PromiseConstructor;

interface StringConstructor {
  (value?: any): string;
  fromCharCode(...codes: number[]): string;
}
declare var String: StringConstructor;

interface NumberConstructor {
  (value?: any): number;
  isNaN(value: unknown): boolean;
  isFinite(value: unknown): boolean;
  parseInt(string: string, radix?: number): number;
  parseFloat(string: string): number;
}
declare var Number: NumberConstructor;

interface BooleanConstructor {
  (value?: any): boolean;
}
declare var Boolean: BooleanConstructor;

interface ArrayConstructor {
  isArray(arg: any): arg is any[];
  from<T>(arrayLike: ArrayLike<T>): T[];
}
declare var Array: ArrayConstructor;

interface Symbol {
  readonly description: string | undefined;
}
interface SymbolConstructor {
  readonly iterator: unique symbol;
  readonly hasInstance: unique symbol;
  readonly toPrimitive: unique symbol;
}
declare var Symbol: SymbolConstructor;

interface IterableIterator<T> {
  next(): IteratorResult<T>;
  [Symbol.iterator](): IterableIterator<T>;
}
interface IteratorResult<T> {
  done?: boolean;
  value: T;
}
interface Iterable<T> {
  [Symbol.iterator](): Iterator<T>;
}
interface Iterator<T> {
  next(): IteratorResult<T>;
}

type Partial<T> = { [P in keyof T]?: T[P] };
type Required<T> = { [P in keyof T]-?: T[P] };
type Readonly<T> = { readonly [P in keyof T]: T[P] };
type Pick<T, K extends keyof T> = { [P in K]: T[P] };
type Record<K extends keyof any, T> = { [P in K]: T };
type Exclude<T, U> = T extends U ? never : T;
type Extract<T, U> = T extends U ? T : never;
type NonNullable<T> = T extends null | undefined ? never : T;
type ReturnType<T extends (...args: any) => any> = T extends (...args: any) => infer R
  ? R
  : any;
type Omit<T, K extends keyof any> = Pick<T, Exclude<keyof T, K>>;

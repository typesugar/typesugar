import { is, assert } from "@typesugar/validate";
interface Named { name: string; greet(): string }
export const isSN = is<string | number>();
export const isUnionObj = is<{ kind: "a"; x: number } | { kind: "b"; y: string }>();
export const isNullable = is<{ v: string | null }>();
export const isLit = is<"admin">();
export const isNumLit = is<1 | 2 | 3>();
export const isBig = is<bigint>();
export const isDate = is<Date>();
export const isNamed = is<Named>();
export const isAnonArr = is<{ tags: string[] }>();
export const isObj = is<{ name: string }>();
export const isTuple = is<[string, number]>();
export const isDash = is<{ "first-name": string }>();

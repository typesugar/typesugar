function Some(x: number) { return { tag: "some", x }; }
export const v = Some(1);
export enum Flags { None = 0, A = 1 }
export const f = Flags.None;
export const obj = { None: 1 };
const None = 5;
export const n = None + 1;
export const sh = { None };

interface Money { amount: number }
declare const m: Money;
export const a = m + 1;
export const b = m > 5;
export const c = [1, 2] + 3;
export const d = m === "x";
export const e = { n: 1 } + { n: 2 };

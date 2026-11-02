import { registerExtension } from "typesugar";
function capitalize(s: string): string { return s[0].toUpperCase() + s.slice(1); }
registerExtension("string", capitalize);
export const s = ("hello" as any as string & { capitalize(): string }).capitalize();
export const t = (("hello") as string).capitalize();

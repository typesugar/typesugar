import { fieldNames } from "typesugar";
interface Pt { x: number; y: number }
export const names = fieldNames<Pt>();

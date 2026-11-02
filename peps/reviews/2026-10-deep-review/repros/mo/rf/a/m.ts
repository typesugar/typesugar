import { fieldNames } from "typesugar";
interface User { id: number; name: string; role: string }
export const s = fieldNames<User>();

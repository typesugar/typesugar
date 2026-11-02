import { fieldNames } from "typesugar";
interface User { id: number; name: string }
export const fa = fieldNames<User>();

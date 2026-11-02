import { fieldNames } from "typesugar";
interface User { email: string; age: number; admin: boolean }
export const fb = fieldNames<User>();

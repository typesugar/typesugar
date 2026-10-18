import { fieldNames, typeInfo, validator } from "typesugar";
interface User { email: string }
export const s = fieldNames<User>();
export const s2 = validator<User>();

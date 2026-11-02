import { is } from "@typesugar/validate";
interface Tree { v: number; kids: Tree[] }
export const isTree = is<Tree>();

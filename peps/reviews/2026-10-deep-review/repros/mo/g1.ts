import { derive, Generic } from "typesugar";
@derive(Generic)
export class Point { constructor(public x: number, public y: number) {} }

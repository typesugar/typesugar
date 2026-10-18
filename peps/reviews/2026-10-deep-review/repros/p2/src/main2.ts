import { names } from "./lib";
import { fieldNames } from "typesugar";
interface Q { a: number }
console.log("lib:", names, "local:", fieldNames<Q>());

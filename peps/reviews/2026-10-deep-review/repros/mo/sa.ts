import { staticAssert, comptime } from "typesugar";
const MAX_SIZE = 4096;
staticAssert(comptime(() => MAX_SIZE <= 1024), "MAX_SIZE must be <= 1024");
staticAssert(MAX_SIZE <= 1024, "direct");
staticAssert(0/0, "nan");

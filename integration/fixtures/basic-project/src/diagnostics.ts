// Integration test fixture: diagnostic positions
import { staticAssert } from "typesugar";

// ERROR: type error BEFORE @derive expansion (line 4, 0-indexed = 3)
const x: number = "wrong";

/** @derive(Eq) */
interface Point { x: number; y: number; }

// ERROR: type error AFTER @derive expansion — must not drift (line 10, 0-indexed = 9)
const y: string = 42;

// ERROR: macro error — staticAssert (line 13, 0-indexed = 12)
staticAssert(false, "intentional failure");

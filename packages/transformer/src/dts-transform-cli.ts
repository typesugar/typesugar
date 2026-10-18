#!/usr/bin/env node

/**
 * `typesugar-dts-transform` executable: rewrites `@opaque` interfaces in
 * emitted .d.ts files into their runtime type aliases. See dts-transform.ts.
 *
 * Usage: typesugar-dts-transform [--verbose] <path> [<path> ...]
 */

import { cli } from "./dts-transform.js";

cli(process.argv.slice(2));

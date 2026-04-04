#!/usr/bin/env node
/**
 * Vercel build script — sets TYPESUGAR_SKIP_DTS=1 so tsup configs skip DTS.
 */

import { execSync } from "child_process";

const env = { ...process.env, TYPESUGAR_SKIP_DTS: "1" };

function run(cmd) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", env });
}

run("pnpm -r --filter '!typesugar-example-*' build");
run("pnpm docs:build");

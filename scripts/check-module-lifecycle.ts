#!/usr/bin/env npx tsx
/**
 * Module Lifecycle Audit Script
 *
 * Checks all packages against the module-lifecycle rule requirements:
 * 1. Naming conventions
 * 2. Standard files present
 * 3. Documentation (README, guide, reference)
 * 4. Central linkage (README.md, guides/index.md, packages.md, AGENTS.md)
 * 5. Showcase exists with proper structure
 * 6. Red team tests exist
 *
 * Run: npx tsx scripts/check-module-lifecycle.ts
 */

import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PACKAGES_DIR = path.join(ROOT, "packages");

// Files to check for central linkage
const ROOT_README = path.join(ROOT, "README.md");
const GUIDES_INDEX = path.join(ROOT, "docs/guides/index.md");
const PACKAGES_REF = path.join(ROOT, "docs/reference/packages.md");
const AGENTS_MD = path.join(ROOT, "AGENTS.md");

// Valid categories from the rule
const VALID_CATEGORIES = [
  "Build Infrastructure",
  "Standard Library",
  "Typeclasses & Derivation",
  "Syntax Sugar",
  "Type Safety & Contracts",
  "Data Structures & Algorithms",
  "Ecosystem Integrations",
  "Developer Experience",
];

// Packages that don't need individual feature guides (Build Infrastructure + Developer Experience)
const SKIP_GUIDE_CHECK = new Set([
  "core",
  "macros",
  "transformer",
  "preprocessor",
  "unplugin-typesugar",
  "ts-plugin",
  "vscode",
  "eslint-plugin",
  "prettier-plugin",
  "typesugar",
]);

// Guide name aliases for packages whose guides have different names
const GUIDE_ALIASES: Record<string, string[]> = {
  std: ["std-typeclasses", "extension-methods", "match", "do-notation"],
  typeclass: ["typeclasses"],
};

interface PackageAudit {
  name: string;
  dirName: string;
  issues: string[];
  warnings: string[];
}

interface AuditResult {
  packages: PackageAudit[];
  summary: {
    total: number;
    withIssues: number;
    withWarnings: number;
    clean: number;
  };
}

function readFileIfExists(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function checkNamingConventions(
  dirName: string,
  packageJson: any
): { issues: string[]; warnings: string[] } {
  const issues: string[] = [];
  const warnings: string[] = [];

  const name = packageJson.name;

  // Check package name format
  const isException = name === "typesugar" || name === "unplugin-typesugar" || name === "typesugar";
  if (!isException && !name?.startsWith("@typesugar/")) {
    issues.push(`Package name "${name}" should start with @typesugar/`);
  }

  // Check kebab-case
  if (!isException && name?.startsWith("@typesugar/")) {
    const suffix = name.replace("@typesugar/", "");
    if (suffix !== suffix.toLowerCase() || suffix.includes("_")) {
      issues.push(`Package suffix "${suffix}" should be kebab-case`);
    }
  }

  // Check description has emoji
  if (packageJson.description && !packageJson.description.match(/[\u{1F300}-\u{1F9FF}]/u)) {
    warnings.push("Description should include an emoji prefix (convention)");
  }

  return { issues, warnings };
}

function checkStandardFiles(
  pkgDir: string,
  packageJson: any
): { issues: string[]; warnings: string[] } {
  const issues: string[] = [];
  const warnings: string[] = [];

  // VS Code extensions don't have src/index.ts - they use extension.ts
  const isVscodeExtension = !!packageJson.engines?.vscode;
  const requiredFiles = isVscodeExtension
    ? ["package.json", "tsconfig.json", "README.md"]
    : ["package.json", "tsconfig.json", "README.md", "src/index.ts"];

  const recommendedFiles = ["tsup.config.ts", "vitest.config.ts"];

  for (const file of requiredFiles) {
    if (!fs.existsSync(path.join(pkgDir, file))) {
      issues.push(`Missing required file: ${file}`);
    }
  }

  for (const file of recommendedFiles) {
    if (!fs.existsSync(path.join(pkgDir, file))) {
      warnings.push(`Missing recommended file: ${file}`);
    }
  }

  // Check for tests directory
  const testsDir = path.join(pkgDir, "tests");
  const srcTestsDir = path.join(pkgDir, "src/__tests__");
  if (!fs.existsSync(testsDir) && !fs.existsSync(srcTestsDir)) {
    warnings.push("No tests/ or src/__tests__/ directory found");
  }

  return { issues, warnings };
}

function checkShowcase(
  pkgDir: string,
  packageName: string
): { issues: string[]; warnings: string[] } {
  const issues: string[] = [];
  const warnings: string[] = [];

  const showcasePath = path.join(pkgDir, "examples/showcase.ts");

  if (!fs.existsSync(showcasePath)) {
    issues.push("Missing examples/showcase.ts");
    return { issues, warnings };
  }

  const content = readFileIfExists(showcasePath);
  if (!content) {
    issues.push("Could not read examples/showcase.ts");
    return { issues, warnings };
  }

  // Config-guide showcases (vscode, eslint-plugin, etc.) don't need run instructions or assertions
  const isConfigGuide =
    content.includes("Configuration guide") || content.includes("Configuration");

  if (!isConfigGuide) {
    // Check for header comment with run instructions
    if (!content.includes("typesugar run") && !content.includes("npx tsx")) {
      warnings.push("Showcase missing run instructions in header comment");
    }

    // Check for assertions
    if (!content.includes("assert(") && !content.includes("typeAssert<")) {
      warnings.push("Showcase missing assert() or typeAssert<> verification");
    }
  }

  // Check for section separators (applies to all showcases)
  if (!content.includes("============")) {
    warnings.push("Showcase missing section separators (// ====...)");
  }

  return { issues, warnings };
}

function checkCentralLinkage(
  packageName: string,
  dirName: string
): { issues: string[]; warnings: string[] } {
  const issues: string[] = [];
  const warnings: string[] = [];

  // Read all central docs
  const rootReadme = readFileIfExists(ROOT_README) || "";
  const guidesIndex = readFileIfExists(GUIDES_INDEX) || "";
  const packagesRef = readFileIfExists(PACKAGES_REF) || "";
  const agentsMd = readFileIfExists(AGENTS_MD) || "";

  // Check README.md linkage
  const readmePatterns = [packageName, `packages/${dirName}`, `[${packageName}]`];
  const inReadme = readmePatterns.some((p) => rootReadme.includes(p));
  if (!inReadme) {
    issues.push("Not linked in root README.md");
  }

  // Check docs/reference/packages.md linkage
  const refPatterns = [packageName, `{#${dirName}}`, `### ${packageName}`];
  const inPackagesRef = refPatterns.some((p) => packagesRef.includes(p));
  if (!inPackagesRef) {
    issues.push("Not in docs/reference/packages.md");
  }

  // Check AGENTS.md linkage
  const agentsPatterns = [packageName, `├── ${dirName}/`, `@typesugar/${dirName}`];
  const inAgents = agentsPatterns.some((p) => agentsMd.includes(p));
  if (!inAgents) {
    warnings.push("Not listed in AGENTS.md architecture tree");
  }

  // Check docs/guides/index.md linkage (less strict - guide might not exist yet)
  // Skip for Build Infrastructure and Developer Experience packages
  if (!SKIP_GUIDE_CHECK.has(dirName)) {
    const guidePatterns = [`${dirName}.md`, `(./guides/${dirName}`, `/${dirName})`];

    // Add alias patterns for packages with differently-named guides
    const aliases = GUIDE_ALIASES[dirName] || [];
    for (const alias of aliases) {
      guidePatterns.push(`${alias}.md`, `(./guides/${alias}`, `/${alias})`);
    }

    const inGuidesIndex = guidePatterns.some((p) => guidesIndex.includes(p));
    if (!inGuidesIndex) {
      warnings.push("No guide linked in docs/guides/index.md");
    }
  }

  return { issues, warnings };
}

function checkRedTeamTests(dirName: string): { issues: string[]; warnings: string[] } {
  const issues: string[] = [];
  const warnings: string[] = [];

  const redTeamPath = path.join(ROOT, `tests/red-team-${dirName}.test.ts`);

  if (!fs.existsSync(redTeamPath)) {
    warnings.push(`No red team test at tests/red-team-${dirName}.test.ts`);
  } else {
    const content = readFileIfExists(redTeamPath);
    if (content) {
      if (!content.includes("Attack surfaces:") && !content.includes("attack")) {
        warnings.push("Red team test missing attack surfaces documentation");
      }
    }
  }

  return { issues, warnings };
}

function checkVitestConfig(
  pkgDir: string,
  packageName: string
): { issues: string[]; warnings: string[] } {
  const issues: string[] = [];
  const warnings: string[] = [];

  const vitestPath = path.join(pkgDir, "vitest.config.ts");
  const content = readFileIfExists(vitestPath);

  if (content) {
    // Check if project name matches package name
    if (!content.includes(packageName) && !content.includes(`name:`)) {
      warnings.push("vitest.config.ts may not have matching project name");
    }
  }

  return { issues, warnings };
}

function auditPackage(dirName: string): PackageAudit {
  const pkgDir = path.join(PACKAGES_DIR, dirName);
  const packageJsonPath = path.join(pkgDir, "package.json");

  const audit: PackageAudit = {
    name: "",
    dirName,
    issues: [],
    warnings: [],
  };

  // Read package.json
  const packageJsonContent = readFileIfExists(packageJsonPath);
  if (!packageJsonContent) {
    audit.issues.push("Missing or unreadable package.json");
    return audit;
  }

  let packageJson: any;
  try {
    packageJson = JSON.parse(packageJsonContent);
    audit.name = packageJson.name || dirName;
  } catch {
    audit.issues.push("Invalid package.json");
    return audit;
  }

  // Run all checks
  const checks = [
    checkNamingConventions(dirName, packageJson),
    checkStandardFiles(pkgDir, packageJson),
    checkShowcase(pkgDir, audit.name),
    checkCentralLinkage(audit.name, dirName),
    checkRedTeamTests(dirName),
    checkVitestConfig(pkgDir, audit.name),
  ];

  for (const check of checks) {
    audit.issues.push(...check.issues);
    audit.warnings.push(...check.warnings);
  }

  return audit;
}

function runAudit(): AuditResult {
  const packages = fs.readdirSync(PACKAGES_DIR).filter((dir) => {
    const pkgDir = path.join(PACKAGES_DIR, dir);
    return fs.statSync(pkgDir).isDirectory() && fs.existsSync(path.join(pkgDir, "package.json"));
  });

  const audits = packages.map(auditPackage);

  const withIssues = audits.filter((a) => a.issues.length > 0).length;
  const withWarnings = audits.filter((a) => a.warnings.length > 0 && a.issues.length === 0).length;
  const clean = audits.filter((a) => a.issues.length === 0 && a.warnings.length === 0).length;

  return {
    packages: audits,
    summary: {
      total: packages.length,
      withIssues,
      withWarnings,
      clean,
    },
  };
}

function printReport(result: AuditResult): void {
  console.log("\n" + "=".repeat(80));
  console.log("MODULE LIFECYCLE AUDIT REPORT");
  console.log("=".repeat(80) + "\n");

  console.log(`Total packages: ${result.summary.total}`);
  console.log(`  ❌ With issues: ${result.summary.withIssues}`);
  console.log(`  ⚠️  Warnings only: ${result.summary.withWarnings}`);
  console.log(`  ✅ Clean: ${result.summary.clean}`);
  console.log("");

  // Group by status
  const withIssues = result.packages.filter((p) => p.issues.length > 0);
  const withWarnings = result.packages.filter(
    (p) => p.warnings.length > 0 && p.issues.length === 0
  );
  const clean = result.packages.filter((p) => p.issues.length === 0 && p.warnings.length === 0);

  if (withIssues.length > 0) {
    console.log("\n" + "-".repeat(80));
    console.log("❌ PACKAGES WITH ISSUES (require attention)");
    console.log("-".repeat(80));
    for (const pkg of withIssues) {
      console.log(`\n📦 ${pkg.name} (${pkg.dirName}/)`);
      for (const issue of pkg.issues) {
        console.log(`   ❌ ${issue}`);
      }
      for (const warning of pkg.warnings) {
        console.log(`   ⚠️  ${warning}`);
      }
    }
  }

  if (withWarnings.length > 0) {
    console.log("\n" + "-".repeat(80));
    console.log("⚠️  PACKAGES WITH WARNINGS (recommended fixes)");
    console.log("-".repeat(80));
    for (const pkg of withWarnings) {
      console.log(`\n📦 ${pkg.name} (${pkg.dirName}/)`);
      for (const warning of pkg.warnings) {
        console.log(`   ⚠️  ${warning}`);
      }
    }
  }

  if (clean.length > 0) {
    console.log("\n" + "-".repeat(80));
    console.log("✅ CLEAN PACKAGES");
    console.log("-".repeat(80));
    console.log(clean.map((p) => p.name).join(", "));
  }

  // Summary tables
  console.log("\n" + "=".repeat(80));
  console.log("ISSUE FREQUENCY");
  console.log("=".repeat(80));

  const issueCounts = new Map<string, number>();
  const warningCounts = new Map<string, number>();

  for (const pkg of result.packages) {
    for (const issue of pkg.issues) {
      issueCounts.set(issue, (issueCounts.get(issue) || 0) + 1);
    }
    for (const warning of pkg.warnings) {
      warningCounts.set(warning, (warningCounts.get(warning) || 0) + 1);
    }
  }

  const sortedIssues = [...issueCounts.entries()].sort((a, b) => b[1] - a[1]);
  const sortedWarnings = [...warningCounts.entries()].sort((a, b) => b[1] - a[1]);

  if (sortedIssues.length > 0) {
    console.log("\nTop Issues:");
    for (const [issue, count] of sortedIssues.slice(0, 10)) {
      console.log(`  ${count.toString().padStart(3)} × ${issue}`);
    }
  }

  if (sortedWarnings.length > 0) {
    console.log("\nTop Warnings:");
    for (const [warning, count] of sortedWarnings.slice(0, 10)) {
      console.log(`  ${count.toString().padStart(3)} × ${warning}`);
    }
  }

  console.log("\n" + "=".repeat(80));
}

// Run the audit
const result = runAudit();
printReport(result);

// Exit with error code if there are issues
process.exit(result.summary.withIssues > 0 ? 1 : 0);

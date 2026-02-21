/**
 * typesugar create <template> [name]
 *
 * Scaffolds a new project from the templates/ directory.
 */

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

const AVAILABLE_TEMPLATES = ["app", "library", "macro-plugin"] as const;
type TemplateName = (typeof AVAILABLE_TEMPLATES)[number];

interface CreateOptions {
  template: TemplateName;
  projectName: string;
  targetDir: string;
  verbose: boolean;
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function findTemplatesDir(): string | null {
  // Check common locations for templates
  const candidates = [
    // When running from installed package
    path.join(__dirname, "..", "..", "..", "templates"),
    // When running from monorepo root
    path.join(__dirname, "..", "..", "..", "..", "templates"),
    // When running from packages/transformer
    path.join(__dirname, "..", "templates"),
    // Relative to cwd (for development)
    path.join(process.cwd(), "templates"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }

  return null;
}

function copyDir(src: string, dest: string, verbose: boolean): void {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules") {
        continue; // Skip node_modules
      }
      copyDir(srcPath, destPath, verbose);
    } else {
      fs.copyFileSync(srcPath, destPath);
      if (verbose) {
        console.log(`  copied: ${entry.name}`);
      }
    }
  }
}

function updatePackageJson(projectDir: string, projectName: string): void {
  const packageJsonPath = path.join(projectDir, "package.json");

  if (!fs.existsSync(packageJsonPath)) {
    return;
  }

  const content = fs.readFileSync(packageJsonPath, "utf-8");
  const pkg = JSON.parse(content);

  pkg.name = projectName;
  pkg.version = "1.0.0";

  fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + "\n");
}

function printNextSteps(options: CreateOptions): void {
  console.log("\nNext steps:");
  console.log(`  cd ${options.projectName}`);
  console.log("  npm install");
  console.log("  npx ts-patch install");

  if (options.template === "app") {
    console.log("  npm run dev");
  } else {
    console.log("  npm run build");
    console.log("  npm test");
  }

  console.log("\nFor more info:");
  console.log("  https://typesugar.dev/getting-started");
}

function parseCreateArgs(args: string[]): {
  template?: string;
  name?: string;
  verbose: boolean;
} {
  let template: string | undefined;
  let name: string | undefined;
  let verbose = false;

  for (const arg of args) {
    if (arg === "--verbose" || arg === "-v") {
      verbose = true;
    } else if (arg.startsWith("-")) {
      // Skip other flags
    } else if (!template) {
      template = arg;
    } else if (!name) {
      name = arg;
    }
  }

  return { template, name, verbose };
}

export async function runCreate(args: string[]): Promise<void> {
  const { template, name, verbose } = parseCreateArgs(args);

  // Find templates directory
  const templatesDir = findTemplatesDir();
  if (!templatesDir) {
    console.error("Error: Could not find templates directory.");
    console.error("Make sure you're running from a typesugar installation or repository.");
    process.exit(1);
  }

  if (verbose) {
    console.log(`Templates directory: ${templatesDir}`);
  }

  // Validate or prompt for template
  let selectedTemplate: TemplateName;

  if (template) {
    if (!AVAILABLE_TEMPLATES.includes(template as TemplateName)) {
      console.error(`Unknown template: ${template}`);
      console.error(`Available templates: ${AVAILABLE_TEMPLATES.join(", ")}`);
      process.exit(1);
    }
    selectedTemplate = template as TemplateName;
  } else {
    console.log("\nAvailable templates:");
    console.log("  app          - Application with Vite (comptime, derive, sql)");
    console.log("  library      - Publishable library with typeclasses");
    console.log("  macro-plugin - Custom macros package");
    console.log();

    const answer = await prompt("Which template? [app/library/macro-plugin]: ");
    if (!answer || !AVAILABLE_TEMPLATES.includes(answer as TemplateName)) {
      console.error("Invalid template selection.");
      process.exit(1);
    }
    selectedTemplate = answer as TemplateName;
  }

  // Validate or prompt for project name
  let projectName: string;

  if (name) {
    projectName = name;
  } else {
    const defaultName = `my-${selectedTemplate === "macro-plugin" ? "macros" : selectedTemplate}`;
    const answer = await prompt(`Project name [${defaultName}]: `);
    projectName = answer || defaultName;
  }

  // Validate project name
  if (!/^[a-z0-9-_.@/]+$/i.test(projectName)) {
    console.error(
      "Invalid project name. Use only letters, numbers, hyphens, underscores, dots, @ and /."
    );
    process.exit(1);
  }

  // Determine target directory
  const targetDir = path.resolve(projectName);

  if (fs.existsSync(targetDir)) {
    const contents = fs.readdirSync(targetDir);
    if (contents.length > 0) {
      console.error(`Error: Directory "${projectName}" already exists and is not empty.`);
      process.exit(1);
    }
  }

  const options: CreateOptions = {
    template: selectedTemplate,
    projectName,
    targetDir,
    verbose,
  };

  // Copy template
  const templateDir = path.join(templatesDir, selectedTemplate);

  if (!fs.existsSync(templateDir)) {
    console.error(`Template not found: ${templateDir}`);
    process.exit(1);
  }

  console.log(`\nCreating ${selectedTemplate} project in ${targetDir}...`);

  copyDir(templateDir, targetDir, verbose);

  // Update package.json with project name
  updatePackageJson(targetDir, projectName);

  console.log("\nProject created successfully!");
  printNextSteps(options);
}

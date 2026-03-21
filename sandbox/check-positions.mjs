import { createRequire } from "module";
import * as path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const { TransformationPipeline } = require(
  path.join(rootDir, "packages/transformer/dist/index.cjs")
);
const ts = require("typescript");

const targetFile = path.join(rootDir, "sandbox/error-showcase.ts");
const tsconfigPath = path.join(rootDir, "sandbox/tsconfig.json");

const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(tsconfigPath));

const pipeline = new TransformationPipeline(parsed.options, [targetFile], {
  verbose: false,
  readFile: (f) => ts.sys.readFile(f),
  fileExists: (f) => ts.sys.fileExists(f),
});

const result = pipeline.transform(targetFile);
const sourceText = ts.sys.readFile(targetFile);

console.log(`\nDiagnostics: ${result.diagnostics.length}\n`);
for (const d of result.diagnostics) {
  const startLine = sourceText ? sourceText.substring(0, d.start).split("\n").length : "?";
  const snippet = sourceText
    ? sourceText.substring(d.start, d.start + Math.min(d.length || 40, 80)).replace(/\n/g, "\\n")
    : "";
  console.log(`  [${d.severity}] start=${d.start}, length=${d.length}, line=${startLine}`);
  console.log(`    code: ${d.code ?? "none"}`);
  console.log(`    snippet: "${snippet}"`);
  console.log(`    msg: ${d.message.substring(0, 80)}...`);
  console.log();
}

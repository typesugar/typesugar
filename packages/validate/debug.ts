import ts from "typescript";
import fs from "fs";
import macroTransformerFactory from "../../src/transforms/macro-transformer.js";
import { register } from "./src/macros.js";
import { globalRegistry } from "../../src/core/registry.js";

register(globalRegistry);

const filename = "src/__tests__/macros.test.ts";
const code = fs.readFileSync(filename, "utf-8");

const configPath = ts.findConfigFile("./", ts.sys.fileExists, "tsconfig.json");
const configFile = ts.readConfigFile(configPath!, ts.sys.readFile);
const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, "./");

// Create a proper program with correct options for module resolution
const program = ts.createProgram([filename], config.options);
const sourceFile = program.getSourceFile(filename)!;

const result = ts.transform(sourceFile, [macroTransformerFactory(program, { verbose: true })]);

const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
const transformed = printer.printFile(result.transformed[0]);
console.log(transformed);

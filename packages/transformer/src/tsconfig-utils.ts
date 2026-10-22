/**
 * Small tsconfig-reading helper shared between `cli.ts` (an executable
 * entrypoint with a top-level `main()` side effect — do NOT import it as a
 * library) and other CLI subcommand modules like `approve-macros.ts`.
 */

import * as ts from "typescript";
import * as path from "path";

export function readTsConfig(configPath: string): ts.ParsedCommandLine {
  const absolutePath = path.resolve(configPath);
  const configFile = ts.readConfigFile(absolutePath, ts.sys.readFile);

  if (configFile.error) {
    const message = ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n");
    console.error(`Error reading ${configPath}: ${message}`);
    process.exit(1);
  }

  // Passing the file name sets `compilerOptions.configFilePath`, as tsc -p
  // does: it is how the macro loader knows which directory is the project
  // (macro packages resolve from the project's own directories only) and the
  // comptime/include project root (createPipeline does the same).
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(absolutePath),
    undefined,
    absolutePath
  );

  if (parsed.errors.length > 0) {
    const messages = parsed.errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
    console.error(`Config errors:\n${messages.join("\n")}`);
    process.exit(1);
  }

  return parsed;
}

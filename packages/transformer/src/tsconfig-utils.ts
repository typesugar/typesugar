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

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(absolutePath)
  );

  if (parsed.errors.length > 0) {
    const messages = parsed.errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
    console.error(`Config errors:\n${messages.join("\n")}`);
    process.exit(1);
  }

  return parsed;
}

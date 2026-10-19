/**
 * @typesugar/lsp-server is not supported in 1.0 (PEP-060 D5). The TypeScript
 * language-service plugin is the single editor engine; it runs inside the
 * editor's own TypeScript server (VS Code, and typescript-language-server /
 * vtsls in Neovim, Zed, Sublime, Helix and Emacs). This package and its code
 * stay in the repository, but it is no longer developed or tested as an
 * editor integration.
 */

export const DEPRECATION_MESSAGE =
  "@typesugar/lsp-server is not supported in 1.0; use the TypeScript language-service plugin " +
  '(tsconfig.json "compilerOptions.plugins": [{ "name": "@typesugar/transformer/language-service" }]) ' +
  "with your editor's TypeScript server instead — see https://typesugar.org/getting-started/editor-setup";

let announced = false;

/**
 * Say once per process, on stderr (which editors keep in the server's log)
 * and as an editor warning, that this server is unsupported.
 */
export function announceDeprecation(connection: {
  window: { showWarningMessage(message: string): unknown };
}): void {
  if (announced) return;
  announced = true;
  process.stderr.write(`[typesugar] ${DEPRECATION_MESSAGE}\n`);
  try {
    void connection.window.showWarningMessage(DEPRECATION_MESSAGE);
  } catch {
    // The stderr line above is the one that must survive.
  }
}

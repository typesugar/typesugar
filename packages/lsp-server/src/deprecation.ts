/**
 * @typesugar/lsp-server is not supported in 1.0 (PEP-060 D5). The TypeScript
 * language-service plugin is the single editor engine; it runs inside the
 * editor's own TypeScript server (VS Code, and typescript-language-server /
 * vtsls in Neovim, Zed, Sublime, Helix and Emacs). This package and its code
 * stay in the repository, but it is no longer developed or tested as an
 * editor integration.
 */

import {
  MessageType,
  ShowMessageNotification,
  type ShowMessageParams,
} from "vscode-languageserver/node.js";

export const DEPRECATION_MESSAGE =
  "@typesugar/lsp-server is not supported in 1.0; use the TypeScript language-service plugin " +
  '(tsconfig.json "compilerOptions.plugins": [{ "name": "@typesugar/transformer/language-service" }]) ' +
  "with your editor's TypeScript server instead — see https://typesugar.org/getting-started/editor-setup";

let announced = false;

/**
 * Say once per process, on stderr (which editors keep in the server's log)
 * and as an editor warning, that this server is unsupported.
 *
 * The editor warning is a `window/showMessage` NOTIFICATION, not the
 * `window/showMessageRequest` that `connection.window.showWarningMessage`
 * sends: the warning offers no actions, so there is nothing for the client to
 * answer. Nothing is written to stdout, which carries the JSON-RPC stream
 * under `--stdio`.
 */
export function announceDeprecation(connection: {
  sendNotification(type: typeof ShowMessageNotification.type, params: ShowMessageParams): unknown;
}): void {
  if (announced) return;
  announced = true;
  process.stderr.write(`[typesugar] ${DEPRECATION_MESSAGE}\n`);
  try {
    void connection.sendNotification(ShowMessageNotification.type, {
      type: MessageType.Warning,
      message: DEPRECATION_MESSAGE,
    });
  } catch {
    // The stderr line above is the one that must survive.
  }
}

use zed_extension_api::{self as zed, LanguageServerId, Result};

struct TypesugarExtension;

impl zed::Extension for TypesugarExtension {
    fn new() -> Self {
        TypesugarExtension
    }

    fn language_server_command(
        &mut self,
        _language_server_id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        // Find node binary
        let node = worktree.which("node").ok_or_else(|| {
            "node not found in PATH. Install Node.js to use typesugar.".to_string()
        })?;

        // Find the LSP server script in node_modules
        let root = worktree.root_path();
        let server_script = format!(
            "{}/node_modules/@typesugar/lsp-server/dist/server.js",
            root
        );

        Ok(zed::Command {
            command: node,
            args: vec![server_script, "--stdio".to_string()],
            env: worktree.shell_env(),
        })
    }

    fn language_server_initialization_options(
        &mut self,
        _language_server_id: &LanguageServerId,
        _worktree: &zed::Worktree,
    ) -> Result<Option<zed_extension_api::serde_json::Value>> {
        Ok(None)
    }
}

zed::register_extension!(TypesugarExtension);

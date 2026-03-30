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
        // Try to find typesugar-lsp in the project's node_modules
        let node_modules_bin = worktree
            .which("typesugar-lsp")
            .or_else(|| {
                // Fallback: look in node_modules/.bin directly
                let path = format!(
                    "{}/node_modules/.bin/typesugar-lsp",
                    worktree.root_path()
                );
                if std::path::Path::new(&path).exists() {
                    Some(path)
                } else {
                    None
                }
            });

        let binary_path = node_modules_bin.ok_or_else(|| {
            "typesugar-lsp not found. Install @typesugar/lsp-server in your project: \
             npm install --save-dev @typesugar/lsp-server"
                .to_string()
        })?;

        Ok(zed::Command {
            command: binary_path,
            args: vec!["--stdio".to_string()],
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

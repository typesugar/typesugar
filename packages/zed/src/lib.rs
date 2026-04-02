use zed_extension_api::{self as zed, LanguageServerId, Result};

struct TypesugarExtension;

const SERVER_PACKAGE: &str = "@typesugar/lsp-server";

impl zed::Extension for TypesugarExtension {
    fn new() -> Self {
        TypesugarExtension
    }

    fn language_server_command(
        &mut self,
        language_server_id: &LanguageServerId,
        _worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        // Use Zed's built-in npm package management to install the LSP server.
        // This checks if already installed and downloads from npm if needed.
        let version = zed::npm_package_latest_version(SERVER_PACKAGE)?;

        if zed::npm_package_installed_version(SERVER_PACKAGE)?.as_deref() != Some(version.as_str())
        {
            zed::set_language_server_installation_status(
                language_server_id,
                &zed::LanguageServerInstallationStatus::Downloading,
            );
            zed::npm_install_package(SERVER_PACKAGE, &version)?;
        }

        let node = zed::node_binary_path()?;
        let server_path = format!("node_modules/{}/bin/typesugar-lsp", SERVER_PACKAGE);

        Ok(zed::Command {
            command: node,
            args: vec![server_path, "--stdio".to_string()],
            env: Default::default(),
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

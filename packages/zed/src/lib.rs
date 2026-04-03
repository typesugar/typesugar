use std::env;
use zed_extension_api::{self as zed, LanguageServerId, Result};

struct TypesugarExtension {
    did_find_server: bool,
}

const SERVER_PACKAGE: &str = "@typesugar/lsp-server";
const SERVER_PATH: &str = "node_modules/@typesugar/lsp-server/bin/typesugar-lsp";

impl TypesugarExtension {
    fn server_script_path(
        &mut self,
        language_server_id: &LanguageServerId,
    ) -> Result<String> {
        let version = zed::npm_package_latest_version(SERVER_PACKAGE)?;

        if !self.did_find_server
            || zed::npm_package_installed_version(SERVER_PACKAGE)?.as_deref()
                != Some(version.as_str())
        {
            zed::set_language_server_installation_status(
                language_server_id,
                &zed::LanguageServerInstallationStatus::Downloading,
            );
            zed::npm_install_package(SERVER_PACKAGE, &version)?;
            self.did_find_server = true;
        }

        Ok(SERVER_PATH.to_string())
    }
}

impl zed::Extension for TypesugarExtension {
    fn new() -> Self {
        TypesugarExtension {
            did_find_server: false,
        }
    }

    fn language_server_command(
        &mut self,
        language_server_id: &LanguageServerId,
        _worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        let server_path = self.server_script_path(language_server_id)?;

        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args: vec![
                env::current_dir()
                    .unwrap()
                    .join(&server_path)
                    .to_string_lossy()
                    .to_string(),
                "--stdio".to_string(),
            ],
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

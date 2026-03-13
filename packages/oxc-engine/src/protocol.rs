//! MacroCallInfo / MacroExpansion protocol types
//!
//! These types define the JSON protocol for communicating between
//! the Rust traverser and JS macro expansion functions.

use serde::{Deserialize, Serialize};

/// Information about a macro call site, sent to JS
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MacroCallInfo {
    /// Name of the macro being invoked
    pub macro_name: String,
    /// Arguments to the macro as source text strings
    pub call_site_args: Vec<String>,
    /// JSDoc tag if this is a JSDoc-triggered macro
    pub js_doc_tag: Option<String>,
    /// Source filename
    pub filename: String,
    /// Line number (1-indexed)
    pub line: u32,
    /// Column number (0-indexed)
    pub column: u32,
}

/// Result of macro expansion, returned from JS
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MacroExpansion {
    /// The expanded code
    pub code: String,
    /// What kind of AST node the expansion represents
    pub kind: ExpansionKind,
    /// Any diagnostics from the expansion
    pub diagnostics: Vec<ExpansionDiagnostic>,
}

/// What kind of AST node the expansion represents
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExpansionKind {
    Expression,
    Statements,
    Declaration,
}

/// A diagnostic from macro expansion
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExpansionDiagnostic {
    pub severity: String,
    pub message: String,
    pub line: Option<u32>,
    pub column: Option<u32>,
}

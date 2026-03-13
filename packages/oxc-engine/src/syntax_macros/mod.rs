//! Syntax-only macros implemented in pure Rust
//!
//! These macros don't require type information and can be expanded
//! entirely in the Rust-based engine without calling back to TypeScript.

pub mod cfg;
pub mod comptime;
pub mod static_assert;

pub use cfg::{evaluate_cfg, CfgConfig, CfgRemovalPlan, CfgResult};
pub use static_assert::{
    evaluate_constant_expr, process_static_assert, result_to_diagnostic, StaticAssertResult,
};

//! oxc-engine: Rust-native macro engine for typesugar
//!
//! This crate provides a high-performance macro transformer using oxc for
//! parsing, AST manipulation, and code generation.

#![allow(clippy::new_without_default)]

use std::collections::HashSet;
use std::path::PathBuf;

use napi::bindgen_prelude::*;
use napi_derive::napi;
use oxc_allocator::Allocator;
use oxc_ast::visit::Visit;
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_parser::Parser;
use oxc_span::{GetSpan, SourceType};
use serde::{Deserialize, Serialize};

mod engine;
mod jsdoc;
mod jsdoc_spike;
mod protocol;
mod source_map;
mod splice;
mod traverse;

pub mod syntax_macros;

use jsdoc::{extract_jsdoc_annotations, JsDocAnnotations};
use splice::Splicer;
use syntax_macros::{cfg::CfgConfig, evaluate_cfg, process_static_assert, CfgResult, StaticAssertResult};

/// Result of transforming a source file
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransformResult {
    /// The transformed code
    pub code: String,
    /// Source map (JSON string)
    pub map: Option<String>,
    /// Whether the code was changed
    pub changed: bool,
    /// Any diagnostics/errors
    pub diagnostics: Vec<Diagnostic>,
}

/// A diagnostic message from the transformer
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Diagnostic {
    pub severity: String,
    pub message: String,
    pub line: Option<u32>,
    pub column: Option<u32>,
}

/// Transform options
#[napi(object)]
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TransformOptions {
    /// Enable source map generation
    #[napi(ts_type = "boolean")]
    pub source_map: Option<bool>,
    /// Configuration for conditional compilation (cfg macro)
    #[napi(ts_type = "Record<string, unknown>")]
    pub cfg_config: Option<serde_json::Value>,
}

/// Transform TypeScript source code using oxc.
///
/// This is the main entry point for the macro engine.
/// Processes syntax-only macros (cfg, staticAssert) in pure Rust.
#[napi]
pub fn transform(
    source: String,
    filename: String,
    options: Option<TransformOptions>,
) -> Result<TransformResult> {
    let opts = options.unwrap_or_default();
    let enable_source_map = opts.source_map.unwrap_or(false);

    // Build cfg config from options
    let cfg_config = build_cfg_config(&opts);

    // Determine source type from filename
    let source_type = SourceType::from_path(&filename).unwrap_or_default();

    // Allocate arena for oxc
    let allocator = Allocator::default();

    // Parse
    let parser_ret = Parser::new(&allocator, &source, source_type).parse();

    // Collect parse errors as diagnostics
    let mut diagnostics: Vec<Diagnostic> = parser_ret
        .errors
        .iter()
        .map(|e| Diagnostic {
            severity: "error".to_string(),
            message: e.to_string(),
            line: None,
            column: None,
        })
        .collect();

    if !parser_ret.errors.is_empty() {
        return Ok(TransformResult {
            code: source.clone(),
            map: None,
            changed: false,
            diagnostics,
        });
    }

    // Process macros using text-based splicing
    let mut splicer = Splicer::new();
    let mut changed = false;

    // Extract JSDoc annotations
    let declaration_starts = collect_declaration_starts(&parser_ret.program);
    let annotations = extract_jsdoc_annotations(&parser_ret.program.comments, &source, &declaration_starts);

    // Process @cfg annotations
    process_cfg_macros(
        &source,
        &parser_ret.program,
        &annotations,
        &cfg_config,
        &mut splicer,
        &mut changed,
    );

    // Process staticAssert calls
    process_static_assert_macros(
        &source,
        &parser_ret.program,
        &mut splicer,
        &mut diagnostics,
        &mut changed,
    );

    // Apply splices to get transformed source
    let transformed_source = if changed {
        splicer.apply(&source)
    } else {
        source.clone()
    };

    // Re-parse transformed source for codegen (if changed)
    let final_code = if changed {
        let allocator2 = Allocator::default();
        let parser_ret2 = Parser::new(&allocator2, &transformed_source, source_type).parse();

        if !parser_ret2.errors.is_empty() {
            // If re-parse fails, return original with error
            diagnostics.push(Diagnostic {
                severity: "error".to_string(),
                message: "Internal error: transformed code failed to parse".to_string(),
                line: None,
                column: None,
            });
            return Ok(TransformResult {
                code: source,
                map: None,
                changed: false,
                diagnostics,
            });
        }

        let codegen_options = CodegenOptions {
            source_map_path: if enable_source_map {
                Some(PathBuf::from(&filename))
            } else {
                None
            },
            ..Default::default()
        };

        let codegen_ret = Codegen::new()
            .with_options(codegen_options)
            .build(&parser_ret2.program);

        let map_json = if enable_source_map {
            codegen_ret.map.map(|m| m.to_json_string())
        } else {
            None
        };

        return Ok(TransformResult {
            code: codegen_ret.code,
            map: map_json,
            changed,
            diagnostics,
        });
    } else {
        // No changes, codegen from original
        let codegen_options = CodegenOptions {
            source_map_path: if enable_source_map {
                Some(PathBuf::from(&filename))
            } else {
                None
            },
            ..Default::default()
        };

        Codegen::new()
            .with_options(codegen_options)
            .build(&parser_ret.program)
    };

    // Convert source map to JSON string
    let map_json = if enable_source_map {
        final_code.map.map(|m| m.to_json_string())
    } else {
        None
    };

    Ok(TransformResult {
        code: final_code.code,
        map: map_json,
        changed,
        diagnostics,
    })
}

/// Build CfgConfig from transform options
fn build_cfg_config(opts: &TransformOptions) -> CfgConfig {
    let mut flags = HashSet::new();

    if let Some(cfg_json) = &opts.cfg_config {
        if let Some(obj) = cfg_json.as_object() {
            for (key, value) in obj {
                // A flag is enabled if its value is truthy
                let enabled = match value {
                    serde_json::Value::Bool(b) => *b,
                    serde_json::Value::Number(n) => n.as_f64().map(|f| f != 0.0).unwrap_or(false),
                    serde_json::Value::String(s) => !s.is_empty(),
                    serde_json::Value::Null => false,
                    _ => true,
                };
                if enabled {
                    flags.insert(key.clone());
                }
            }
        }
    }

    CfgConfig { flags }
}

/// Collect the start positions of all declarations
fn collect_declaration_starts(program: &oxc_ast::ast::Program) -> Vec<u32> {
    struct DeclCollector {
        starts: Vec<u32>,
    }

    impl<'a> Visit<'a> for DeclCollector {
        fn visit_statement(&mut self, stmt: &oxc_ast::ast::Statement<'a>) {
            use oxc_ast::ast::Statement;
            match stmt {
                Statement::VariableDeclaration(decl) => {
                    self.starts.push(decl.span.start);
                }
                Statement::FunctionDeclaration(decl) => {
                    self.starts.push(decl.span.start);
                }
                Statement::ClassDeclaration(decl) => {
                    self.starts.push(decl.span.start);
                }
                Statement::ExportNamedDeclaration(decl) => {
                    self.starts.push(decl.span.start);
                }
                Statement::ExportDefaultDeclaration(decl) => {
                    self.starts.push(decl.span.start);
                }
                Statement::TSInterfaceDeclaration(decl) => {
                    self.starts.push(decl.span.start);
                }
                Statement::TSTypeAliasDeclaration(decl) => {
                    self.starts.push(decl.span.start);
                }
                Statement::TSEnumDeclaration(decl) => {
                    self.starts.push(decl.span.start);
                }
                _ => {}
            }
            // Continue visiting
            oxc_ast::visit::walk::walk_statement(self, stmt);
        }
    }

    let mut collector = DeclCollector { starts: vec![] };
    collector.visit_program(program);
    collector.starts
}

/// Process @cfg macro annotations
fn process_cfg_macros(
    source: &str,
    program: &oxc_ast::ast::Program,
    annotations: &JsDocAnnotations,
    cfg_config: &CfgConfig,
    splicer: &mut Splicer,
    changed: &mut bool,
) {
    // Find declarations with @cfg tags and evaluate them
    struct CfgProcessor<'a, 'b> {
        source: &'a str,
        annotations: &'b JsDocAnnotations,
        cfg_config: &'b CfgConfig,
        splicer: &'b mut Splicer,
        changed: &'b mut bool,
    }

    impl<'a, 'b> CfgProcessor<'a, 'b> {
        fn check_and_remove(&mut self, span_start: u32, span_end: u32) {
            if let Some(info) = self.annotations.get(span_start) {
                // Look for @cfg tag
                for tag in &info.tags {
                    if tag.name == "cfg" {
                        if let Some(condition) = &tag.value {
                            match evaluate_cfg(condition, self.cfg_config) {
                                CfgResult::Keep => {
                                    // Keep the declaration, but remove the JSDoc comment
                                    // For now, we'll keep the JSDoc to avoid complexity
                                }
                                CfgResult::Remove => {
                                    // Remove the entire declaration including JSDoc
                                    // Find the JSDoc comment start
                                    let removal_start = find_jsdoc_start(self.source, span_start);
                                    self.splicer.remove(removal_start, span_end);
                                    *self.changed = true;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    impl<'c> Visit<'c> for CfgProcessor<'_, '_> {
        fn visit_statement(&mut self, stmt: &oxc_ast::ast::Statement<'c>) {
            let span = stmt.span();
            self.check_and_remove(span.start, span.end);
            oxc_ast::visit::walk::walk_statement(self, stmt);
        }
    }

    let mut processor = CfgProcessor {
        source,
        annotations,
        cfg_config,
        splicer,
        changed,
    };
    processor.visit_program(program);
}

/// Find the start of the JSDoc comment preceding a declaration
fn find_jsdoc_start(source: &str, decl_start: u32) -> u32 {
    let prefix = &source[..decl_start as usize];
    // Look backwards for /**
    if let Some(idx) = prefix.rfind("/**") {
        // Verify there's only whitespace between /** and declaration
        let between = &prefix[idx + 3..];
        // Find the end of the comment
        if let Some(end_idx) = between.find("*/") {
            let after_comment = &between[end_idx + 2..];
            if after_comment.trim().is_empty() {
                return idx as u32;
            }
        }
    }
    decl_start
}

/// Process staticAssert macro calls
fn process_static_assert_macros(
    source: &str,
    program: &oxc_ast::ast::Program,
    splicer: &mut Splicer,
    diagnostics: &mut Vec<Diagnostic>,
    changed: &mut bool,
) {
    struct StaticAssertProcessor<'a, 'b> {
        source: &'a str,
        splicer: &'b mut Splicer,
        diagnostics: &'b mut Vec<Diagnostic>,
        changed: &'b mut bool,
    }

    impl<'a> Visit<'a> for StaticAssertProcessor<'_, '_> {
        fn visit_call_expression(&mut self, call: &oxc_ast::ast::CallExpression<'a>) {
            // Check if this is a staticAssert call
            if let oxc_ast::ast::Expression::Identifier(ident) = &call.callee {
                if ident.name == "staticAssert" {
                    let span = call.span;

                    // Extract arguments as source text
                    let args: Vec<&str> = call
                        .arguments
                        .iter()
                        .map(|arg| {
                            let arg_span = arg.span();
                            &self.source[arg_span.start as usize..arg_span.end as usize]
                        })
                        .collect();

                    if !args.is_empty() {
                        let condition = args[0];
                        let message = args.get(1).map(|s| *s);

                        let result =
                            process_static_assert(condition, message, span.start, span.end);

                        match result {
                            StaticAssertResult::Pass { .. } => {
                                // Remove the call (including trailing semicolon if present)
                                let end = find_statement_end(self.source, span.end);
                                self.splicer.remove(span.start, end);
                                *self.changed = true;
                            }
                            StaticAssertResult::Fail {
                                message,
                                ..
                            } => {
                                // Keep the call but emit diagnostic
                                self.diagnostics.push(Diagnostic {
                                    severity: "error".to_string(),
                                    message: format!(
                                        "staticAssert failed: {} (condition: {})",
                                        message, condition
                                    ),
                                    line: None,
                                    column: None,
                                });
                            }
                            StaticAssertResult::Unevaluable { reason, .. } => {
                                // Keep the call, it will be evaluated at runtime or by TS
                                // Could optionally add a warning
                                self.diagnostics.push(Diagnostic {
                                    severity: "warning".to_string(),
                                    message: format!(
                                        "staticAssert cannot be evaluated at compile time: {}",
                                        reason
                                    ),
                                    line: None,
                                    column: None,
                                });
                            }
                        }
                    }
                }
            }

            // Continue visiting
            oxc_ast::visit::walk::walk_call_expression(self, call);
        }
    }

    let mut processor = StaticAssertProcessor {
        source,
        splicer,
        diagnostics,
        changed,
    };
    processor.visit_program(program);
}

/// Find the end of a statement (including semicolon and trailing newline)
fn find_statement_end(source: &str, expr_end: u32) -> u32 {
    let rest = &source[expr_end as usize..];
    let mut end = expr_end;

    for c in rest.chars() {
        match c {
            ';' => {
                end += 1;
                // Also consume trailing newline
                if source.get(end as usize..end as usize + 1) == Some("\n") {
                    end += 1;
                }
                break;
            }
            ' ' | '\t' => end += 1,
            '\n' => {
                end += 1;
                break;
            }
            _ => break,
        }
    }

    end
}

/// Parse TypeScript source and return timing information (for benchmarking)
#[napi]
pub fn benchmark_parse(source: String, filename: String) -> Result<BenchmarkResult> {
    let source_type = SourceType::from_path(&filename).unwrap_or_default();
    let allocator = Allocator::default();

    let start = std::time::Instant::now();
    let parser_ret = Parser::new(&allocator, &source, source_type).parse();
    let parse_ms = start.elapsed().as_secs_f64() * 1000.0;

    Ok(BenchmarkResult {
        parse_ms,
        error_count: parser_ret.errors.len() as u32,
    })
}

/// Benchmark result for parse timing
#[napi(object)]
#[derive(Debug, Clone)]
pub struct BenchmarkResult {
    pub parse_ms: f64,
    pub error_count: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_passthrough_simple() {
        let source = "const x: number = 42;".to_string();
        let result = transform(source.clone(), "test.ts".to_string(), None).unwrap();
        assert!(result.diagnostics.is_empty());
        assert!(result.code.contains("42"));
    }

    #[test]
    fn test_source_map_generation() {
        let source = "const x = 42;".to_string();
        let opts = TransformOptions {
            source_map: Some(true),
            cfg_config: None,
        };
        let result = transform(source, "test.ts".to_string(), Some(opts)).unwrap();
        assert!(result.diagnostics.is_empty());
        // Check that map is generated
        assert!(
            result.map.is_some(),
            "Source map should be generated when enabled"
        );
        let map_json = result.map.unwrap();
        assert!(
            map_json.contains("\"version\":3"),
            "Source map should have version 3"
        );
    }

    #[test]
    fn test_passthrough_function() {
        let source = r#"
function greet(name: string): string {
    return `Hello, ${name}!`;
}
"#
        .to_string();
        let result = transform(source, "test.ts".to_string(), None).unwrap();
        assert!(result.diagnostics.is_empty());
        assert!(result.code.contains("greet"));
        assert!(result.code.contains("Hello"));
    }

    #[test]
    fn test_passthrough_with_binop_placeholder() {
        // Test that preprocessed .sts content (with __binop__) parses correctly
        let source = r#"
const result = __binop__(__binop__(1, "|>", double), "|>", square);
"#
        .to_string();
        let result = transform(source, "test.ts".to_string(), None).unwrap();
        assert!(result.diagnostics.is_empty());
        assert!(result.code.contains("__binop__"));
    }

    #[test]
    fn test_parse_error() {
        let source = "const x: = ;".to_string(); // Invalid syntax
        let result = transform(source, "test.ts".to_string(), None).unwrap();
        assert!(!result.diagnostics.is_empty());
    }
}

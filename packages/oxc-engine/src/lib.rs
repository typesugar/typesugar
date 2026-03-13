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
use protocol::{ExpansionKind, MacroCallInfo, MacroExpansion};
use splice::Splicer;
use syntax_macros::{cfg::CfgConfig, evaluate_cfg, process_static_assert, CfgResult, StaticAssertResult};

/// Determine the source type from a filename.
///
/// This handles typesugar's custom extensions:
/// - `.sts` and `.stsx` are "sugared TypeScript" files (preprocessed before reaching this engine)
/// - They should be parsed as TypeScript, not JavaScript
///
/// For standard extensions (.ts, .tsx, .js, .jsx), defers to oxc's built-in detection.
fn determine_source_type(filename: &str) -> SourceType {
    // Check for typesugar's custom extensions first
    if filename.ends_with(".sts") {
        return SourceType::ts();
    }
    if filename.ends_with(".stsx") {
        return SourceType::tsx();
    }
    // Fallback to oxc's built-in path detection
    SourceType::from_path(filename).unwrap_or_default()
}

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
    /// If true, at least one macro requested fallback to the TypeScript transformer.
    /// The pipeline should discard this result and re-transform using the TS backend.
    pub needs_fallback: bool,
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
    // Note: .sts and .stsx are typesugar's "sugared TypeScript" extensions
    // They should be parsed as TypeScript (not JavaScript)
    let source_type = determine_source_type(&filename);

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
            needs_fallback: false,
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
                needs_fallback: false,
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
            needs_fallback: false,
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
        needs_fallback: false,
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

/// Transform TypeScript source code with JS macro callbacks.
///
/// This variant allows type-aware macros to be handled by JS callback functions
/// that can access the TypeChecker.
///
/// The callback receives a JSON-serialized MacroCallInfo and returns a
/// JSON-serialized MacroExpansion.
///
/// For nested expression macros (like chained `__binop__`), this function
/// iterates until all macros are expanded, since each pass may expose new
/// macro calls that were previously nested inside other macro arguments.
#[napi]
pub fn transform_with_macros(
    source: String,
    filename: String,
    options: Option<TransformOptions>,
    macro_callback: Function<String, String>,
) -> Result<TransformResult> {
    let opts = options.unwrap_or_default();
    let enable_source_map = opts.source_map.unwrap_or(false);
    let cfg_config = build_cfg_config(&opts);

    // Use custom source type detection for .sts/.stsx files
    let source_type = determine_source_type(&filename);

    let mut diagnostics: Vec<Diagnostic> = Vec::new();
    let mut current_source = source.clone();
    let mut changed = false;
    let mut needs_fallback = false;

    // Initial parse
    let allocator = Allocator::default();
    let parser_ret = Parser::new(&allocator, &current_source, source_type).parse();

    // Collect parse errors
    diagnostics.extend(parser_ret.errors.iter().map(|e| Diagnostic {
        severity: "error".to_string(),
        message: e.to_string(),
        line: None,
        column: None,
    }));

    if !parser_ret.errors.is_empty() {
        return Ok(TransformResult {
            code: source,
            map: None,
            changed: false,
            diagnostics,
            needs_fallback: false,
        });
    }

    // Extract JSDoc annotations (only needed once, at statement level)
    let declaration_starts = collect_declaration_starts(&parser_ret.program);
    let annotations =
        extract_jsdoc_annotations(&parser_ret.program.comments, &current_source, &declaration_starts);

    // Process syntax-only macros (cfg, staticAssert) in Rust - single pass
    let mut splicer = Splicer::new();
    process_cfg_macros(
        &current_source,
        &parser_ret.program,
        &annotations,
        &cfg_config,
        &mut splicer,
        &mut changed,
    );

    process_static_assert_macros(
        &current_source,
        &parser_ret.program,
        &mut splicer,
        &mut diagnostics,
        &mut changed,
    );

    // Process JSDoc macros (single pass, they're at statement level, not nested)
    let jsdoc_sites: Vec<MacroSite> = collect_type_aware_macro_sites(&current_source, &parser_ret.program, &annotations)
        .into_iter()
        .filter(|site| matches!(site.kind, MacroSiteKind::JsDoc { .. }))
        .collect();

    if !jsdoc_sites.is_empty() {
        let fb = process_type_aware_macros(
            &current_source,
            &filename,
            &jsdoc_sites,
            &macro_callback,
            &mut splicer,
            &mut diagnostics,
            &mut changed,
        )?;
        needs_fallback = needs_fallback || fb;
    }

    // Apply initial splices (cfg, staticAssert, JSDoc macros)
    if !splicer.is_empty() {
        current_source = splicer.apply(&current_source);
    }

    // Iterative expansion for expression macros (like nested __binop__)
    // In each pass, we only expand "leaf" macros - those whose arguments don't
    // contain other macro calls. This ensures we expand from innermost to outermost.
    const MAX_ITERATIONS: usize = 20; // Safety limit for deeply nested macros

    for iteration in 0..MAX_ITERATIONS {
        // Re-parse current source
        let iter_allocator = Allocator::default();
        let iter_parser = Parser::new(&iter_allocator, &current_source, source_type).parse();

        if !iter_parser.errors.is_empty() {
            // Parse failed - this shouldn't happen if our expansions are valid
            diagnostics.push(Diagnostic {
                severity: "error".to_string(),
                message: format!(
                    "Internal error: transformed code failed to parse after {} iteration(s)",
                    iteration
                ),
                line: None,
                column: None,
            });
            return Ok(TransformResult {
                code: source,
                map: None,
                changed: false,
                diagnostics,
                needs_fallback,
            });
        }

        // Collect only expression macro sites (like __binop__)
        // We don't need annotations for expression macros
        let empty_annotations = JsDocAnnotations::new();
        let all_expr_sites: Vec<MacroSite> = collect_type_aware_macro_sites(
            &current_source,
            &iter_parser.program,
            &empty_annotations,
        )
        .into_iter()
        .filter(|site| matches!(site.kind, MacroSiteKind::CallExpr { .. }))
        .collect();

        // No more expression macros - we're done
        if all_expr_sites.is_empty() {
            break;
        }

        // Filter to only "leaf" macros - those whose arguments don't contain
        // other macro calls. This ensures we expand from innermost to outermost.
        let leaf_sites: Vec<MacroSite> = all_expr_sites
            .into_iter()
            .filter(|site| {
                if let MacroSiteKind::CallExpr { args, .. } = &site.kind {
                    // A macro is a leaf if none of its arguments contain macro calls
                    !args.iter().any(|arg| {
                        EXPRESSION_MACROS.iter().any(|m| arg.contains(m))
                    })
                } else {
                    true
                }
            })
            .collect();

        // If no leaf macros found but there are expression macros, we might have
        // a circular dependency or the filtering is too aggressive
        if leaf_sites.is_empty() {
            diagnostics.push(Diagnostic {
                severity: "warning".to_string(),
                message: format!(
                    "No expandable macros found in iteration {} (possible circular dependency)",
                    iteration
                ),
                line: None,
                column: None,
            });
            break;
        }

        // Process this iteration's leaf expression macros
        let mut iter_splicer = Splicer::new();
        let mut iter_changed = false;

        let fb = process_type_aware_macros(
            &current_source,
            &filename,
            &leaf_sites,
            &macro_callback,
            &mut iter_splicer,
            &mut diagnostics,
            &mut iter_changed,
        )?;
        needs_fallback = needs_fallback || fb;

        if !iter_changed {
            // No changes made - macros returned empty expansions, we're done
            break;
        }

        // Apply this iteration's splices
        current_source = iter_splicer.apply(&current_source);
        changed = true;
    }

    // Final codegen
    let final_allocator = Allocator::default();
    let final_parser = Parser::new(&final_allocator, &current_source, source_type).parse();

    if !final_parser.errors.is_empty() {
        diagnostics.push(Diagnostic {
            severity: "error".to_string(),
            message: "Internal error: final transformed code failed to parse".to_string(),
            line: None,
            column: None,
        });
        return Ok(TransformResult {
            code: source,
            map: None,
            changed: false,
            diagnostics,
            needs_fallback,
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
        .build(&final_parser.program);

    let map_json = if enable_source_map {
        codegen_ret.map.map(|m| m.to_json_string())
    } else {
        None
    };

    Ok(TransformResult {
        code: codegen_ret.code,
        map: map_json,
        changed,
        diagnostics,
        needs_fallback,
    })
}

/// Macro site for type-aware macro processing
#[derive(Debug, Clone)]
enum MacroSiteKind {
    /// JSDoc-annotated declaration (@typeclass, @impl, etc.)
    JsDoc {
        tag_name: String,
        tag_value: Option<String>,
    },
    /// Expression macro call (__binop__, ops, etc.)
    CallExpr {
        macro_name: String,
        args: Vec<String>,
    },
}

#[derive(Debug, Clone)]
struct MacroSite {
    kind: MacroSiteKind,
    span_start: u32,
    span_end: u32,
    line: u32,
    column: u32,
}

/// Expression macros that should be handled by JS callback
const EXPRESSION_MACROS: &[&str] = &["__binop__", "ops"];

/// Collect type-aware macro sites from the AST
fn collect_type_aware_macro_sites(
    source: &str,
    program: &oxc_ast::ast::Program,
    annotations: &JsDocAnnotations,
) -> Vec<MacroSite> {
    // Type-aware macro tags that require JS callback
    const TYPE_AWARE_TAGS: &[&str] = &[
        "typeclass",
        "impl",
        "deriving",
        "extension",
        "specialize",
        "reflect",
        "generic",
        "implicits",
    ];

    struct MacroSiteCollector<'a, 'b> {
        source: &'a str,
        annotations: &'b JsDocAnnotations,
        sites: Vec<MacroSite>,
    }

    impl<'c> Visit<'c> for MacroSiteCollector<'_, '_> {
        fn visit_statement(&mut self, stmt: &oxc_ast::ast::Statement<'c>) {
            let span = stmt.span();

            if let Some(info) = self.annotations.get(span.start) {
                for tag in &info.tags {
                    if TYPE_AWARE_TAGS.contains(&tag.name.as_str()) {
                        let (line, column) = calculate_line_column(self.source, span.start);
                        self.sites.push(MacroSite {
                            kind: MacroSiteKind::JsDoc {
                                tag_name: tag.name.clone(),
                                tag_value: tag.value.clone(),
                            },
                            span_start: span.start,
                            span_end: span.end,
                            line,
                            column,
                        });
                        break; // Only one macro per statement
                    }
                }
            }

            oxc_ast::visit::walk::walk_statement(self, stmt);
        }

        fn visit_call_expression(&mut self, call_expr: &oxc_ast::ast::CallExpression<'c>) {
            // Check if this is an expression macro call
            if let oxc_ast::ast::Expression::Identifier(ident) = &call_expr.callee {
                let name = ident.name.as_str();
                if EXPRESSION_MACROS.contains(&name) {
                    let span = call_expr.span();
                    let (line, column) = calculate_line_column(self.source, span.start);

                    // Extract argument source text
                    let args: Vec<String> = call_expr
                        .arguments
                        .iter()
                        .map(|arg| {
                            let arg_span = arg.span();
                            self.source[arg_span.start as usize..arg_span.end as usize].to_string()
                        })
                        .collect();

                    self.sites.push(MacroSite {
                        kind: MacroSiteKind::CallExpr {
                            macro_name: name.to_string(),
                            args,
                        },
                        span_start: span.start,
                        span_end: span.end,
                        line,
                        column,
                    });
                }
            }

            oxc_ast::visit::walk::walk_call_expression(self, call_expr);
        }
    }

    let mut collector = MacroSiteCollector {
        source,
        annotations,
        sites: vec![],
    };
    collector.visit_program(program);
    collector.sites
}

/// Process type-aware macros by calling JS callback.
/// Returns `true` if any macro requested fallback to the TypeScript transformer.
fn process_type_aware_macros(
    source: &str,
    filename: &str,
    sites: &[MacroSite],
    macro_callback: &Function<String, String>,
    splicer: &mut Splicer,
    diagnostics: &mut Vec<Diagnostic>,
    changed: &mut bool,
) -> Result<bool> {
    let mut needs_fallback = false;

    for site in sites {
        // Build MacroCallInfo based on the kind of macro site
        let call_info = match &site.kind {
            MacroSiteKind::JsDoc { tag_name, tag_value } => MacroCallInfo {
                macro_name: tag_name.clone(),
                call_site_args: vec![],
                js_doc_tag: tag_value.clone(),
                filename: filename.to_string(),
                line: site.line,
                column: site.column,
            },
            MacroSiteKind::CallExpr { macro_name, args } => MacroCallInfo {
                macro_name: macro_name.clone(),
                call_site_args: args.clone(),
                js_doc_tag: None,
                filename: filename.to_string(),
                line: site.line,
                column: site.column,
            },
        };

        // Serialize and call JS callback
        let call_info_json = match serde_json::to_string(&call_info) {
            Ok(json) => json,
            Err(e) => {
                diagnostics.push(Diagnostic {
                    severity: "error".to_string(),
                    message: format!("Failed to serialize MacroCallInfo: {}", e),
                    line: Some(site.line),
                    column: Some(site.column),
                });
                continue;
            }
        };

        // Call JS callback
        let expansion_json = match macro_callback.call(call_info_json) {
            Ok(json) => json,
            Err(e) => {
                diagnostics.push(Diagnostic {
                    severity: "error".to_string(),
                    message: format!("Macro callback failed: {}", e),
                    line: Some(site.line),
                    column: Some(site.column),
                });
                continue;
            }
        };

        // Deserialize expansion result
        let expansion: MacroExpansion = match serde_json::from_str(&expansion_json) {
            Ok(exp) => exp,
            Err(e) => {
                diagnostics.push(Diagnostic {
                    severity: "error".to_string(),
                    message: format!("Failed to parse MacroExpansion: {}", e),
                    line: Some(site.line),
                    column: Some(site.column),
                });
                continue;
            }
        };

        // Forward diagnostics from expansion
        for diag in &expansion.diagnostics {
            diagnostics.push(Diagnostic {
                severity: diag.severity.clone(),
                message: diag.message.clone(),
                line: diag.line,
                column: diag.column,
            });
        }

        // Check if this macro requested fallback
        if expansion.needs_fallback {
            needs_fallback = true;
            // Don't apply this expansion - the pipeline will retry with TS transformer
            continue;
        }

        // Apply expansion based on site kind and expansion kind
        match (&site.kind, &expansion.kind) {
            // JSDoc macro: replace the entire annotated declaration (including JSDoc comment)
            (MacroSiteKind::JsDoc { .. }, _) => {
                let jsdoc_start = find_jsdoc_start(source, site.span_start);
                splicer.add(jsdoc_start, site.span_end, expansion.code);
                *changed = true;
            }
            // Expression macro: just replace the call expression
            (MacroSiteKind::CallExpr { .. }, ExpansionKind::Expression) => {
                splicer.add(site.span_start, site.span_end, expansion.code);
                *changed = true;
            }
            // Other combinations
            (MacroSiteKind::CallExpr { .. }, _) => {
                splicer.add(site.span_start, site.span_end, expansion.code);
                *changed = true;
            }
        }
    }

    Ok(needs_fallback)
}

/// Calculate line and column from byte offset
fn calculate_line_column(source: &str, offset: u32) -> (u32, u32) {
    let mut line = 1u32;
    let mut column = 0u32;

    for (i, c) in source.char_indices() {
        if i >= offset as usize {
            break;
        }
        if c == '\n' {
            line += 1;
            column = 0;
        } else {
            column += 1;
        }
    }

    (line, column)
}

/// Parse TypeScript source and return timing information (for benchmarking)
#[napi]
pub fn benchmark_parse(source: String, filename: String) -> Result<BenchmarkResult> {
    let source_type = determine_source_type(&filename);
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

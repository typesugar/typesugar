//! AST traversal for macro detection and expansion
//!
//! This module traverses oxc's AST to detect macro sites:
//! - JSDoc annotations (@typeclass, @impl, @cfg, etc.)
//! - Call expressions (staticAssert(), compileError(), summon())
//! - Label statements (let:, par:, seq:)
//! - Binary expressions (for operator overloading)

#![allow(dead_code)]

use crate::jsdoc::{extract_jsdoc_annotations, JsDocAnnotations};
use oxc_ast::ast::*;
use oxc_ast::visit::walk;
use oxc_ast::Visit;
use oxc_span::GetSpan;

/// Known macro call expressions
pub const MACRO_CALLS: &[(&str, &str)] = &[
    ("staticAssert", "static-assert"),
    ("compileError", "compile-error"),
    ("compileWarning", "compile-warning"),
    ("summon", "summon"),
    ("cfg", "cfg"),
    ("comptime", "comptime"),
];

/// Detected macro site in the AST
#[derive(Debug, Clone)]
pub enum MacroSite {
    /// JSDoc-annotated declaration (interface, class, const, function)
    JsDocDeclaration {
        tag: String,
        value: Option<String>,
        span_start: u32,
        span_end: u32,
    },
    /// Call expression like staticAssert(), compileError()
    CallExpression {
        macro_name: String,
        args: Vec<String>,
        span_start: u32,
        span_end: u32,
    },
    /// Label statement like `let: { ... }`
    LabeledStatement {
        label: String,
        span_start: u32,
        span_end: u32,
    },
}

/// Visitor for detecting macro sites in the AST
pub struct MacroDetector<'a> {
    source: &'a str,
    filename: &'a str,
    jsdoc: JsDocAnnotations,
    pub sites: Vec<MacroSite>,
}

impl<'a> MacroDetector<'a> {
    pub fn new(source: &'a str, filename: &'a str, _comments: &[oxc_ast::Comment]) -> Self {
        // First pass: collect all declaration starts
        // For now, we'll populate jsdoc lazily during traversal
        Self {
            source,
            filename,
            jsdoc: JsDocAnnotations::new(),
            sites: Vec::new(),
        }
    }

    /// Detect macro sites by traversing the program
    pub fn detect(&mut self, program: &Program<'a>, comments: &[oxc_ast::Comment]) {
        // Collect declaration start positions
        let mut decl_starts = Vec::new();
        for stmt in &program.body {
            decl_starts.push(stmt.span().start);
        }

        // Extract JSDoc annotations
        self.jsdoc = extract_jsdoc_annotations(comments, self.source, &decl_starts);

        // Visit all nodes
        self.visit_program(program);
    }

    /// Check if a call expression is a known macro call
    fn is_macro_call(&self, callee: &Expression) -> Option<&'static str> {
        if let Expression::Identifier(ident) = callee {
            for (name, macro_name) in MACRO_CALLS {
                if ident.name.as_str() == *name {
                    return Some(macro_name);
                }
            }
        }
        None
    }

    /// Extract argument source text from a call expression
    fn extract_args(&self, args: &[Argument]) -> Vec<String> {
        args.iter()
            .map(|arg| {
                let span = arg.span();
                self.source[span.start as usize..span.end as usize].to_string()
            })
            .collect()
    }
}

impl<'a> Visit<'a> for MacroDetector<'a> {
    fn visit_call_expression(&mut self, expr: &CallExpression<'a>) {
        if let Some(macro_name) = self.is_macro_call(&expr.callee) {
            self.sites.push(MacroSite::CallExpression {
                macro_name: macro_name.to_string(),
                args: self.extract_args(&expr.arguments),
                span_start: expr.span.start,
                span_end: expr.span.end,
            });
        }

        // Continue traversing
        walk::walk_call_expression(self, expr);
    }

    fn visit_labeled_statement(&mut self, stmt: &LabeledStatement<'a>) {
        let label = stmt.label.name.as_str();
        // Check for macro labels: let, par, seq
        if matches!(label, "let" | "par" | "seq") {
            self.sites.push(MacroSite::LabeledStatement {
                label: label.to_string(),
                span_start: stmt.span.start,
                span_end: stmt.span.end,
            });
        }

        // Continue traversing
        walk::walk_labeled_statement(self, stmt);
    }

    fn visit_ts_interface_declaration(&mut self, decl: &TSInterfaceDeclaration<'a>) {
        if let Some(info) = self.jsdoc.get(decl.span.start) {
            for tag in &info.tags {
                self.sites.push(MacroSite::JsDocDeclaration {
                    tag: tag.name.clone(),
                    value: tag.value.clone(),
                    span_start: decl.span.start,
                    span_end: decl.span.end,
                });
            }
        }

        walk::walk_ts_interface_declaration(self, decl);
    }

    fn visit_class(&mut self, class: &Class<'a>) {
        if let Some(info) = self.jsdoc.get(class.span.start) {
            for tag in &info.tags {
                self.sites.push(MacroSite::JsDocDeclaration {
                    tag: tag.name.clone(),
                    value: tag.value.clone(),
                    span_start: class.span.start,
                    span_end: class.span.end,
                });
            }
        }

        walk::walk_class(self, class);
    }

    fn visit_variable_declaration(&mut self, decl: &VariableDeclaration<'a>) {
        if let Some(info) = self.jsdoc.get(decl.span.start) {
            for tag in &info.tags {
                self.sites.push(MacroSite::JsDocDeclaration {
                    tag: tag.name.clone(),
                    value: tag.value.clone(),
                    span_start: decl.span.start,
                    span_end: decl.span.end,
                });
            }
        }

        walk::walk_variable_declaration(self, decl);
    }

    fn visit_function(&mut self, func: &Function<'a>, flags: oxc_semantic::ScopeFlags) {
        if let Some(info) = self.jsdoc.get(func.span.start) {
            for tag in &info.tags {
                self.sites.push(MacroSite::JsDocDeclaration {
                    tag: tag.name.clone(),
                    value: tag.value.clone(),
                    span_start: func.span.start,
                    span_end: func.span.end,
                });
            }
        }

        walk::walk_function(self, func, flags);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use oxc_allocator::Allocator;
    use oxc_parser::Parser;
    use oxc_span::SourceType;

    fn detect_macros(source: &str) -> Vec<MacroSite> {
        let allocator = Allocator::default();
        let source_type = SourceType::default().with_typescript(true);
        let result = Parser::new(&allocator, source, source_type).parse();

        let mut detector = MacroDetector::new(source, "test.ts", &result.program.comments);
        detector.detect(&result.program, &result.program.comments);
        detector.sites
    }

    #[test]
    fn test_detect_static_assert() {
        let source = r#"staticAssert(true, "Should be true");"#;
        let sites = detect_macros(source);

        assert_eq!(sites.len(), 1);
        match &sites[0] {
            MacroSite::CallExpression {
                macro_name, args, ..
            } => {
                assert_eq!(macro_name, "static-assert");
                assert_eq!(args.len(), 2);
                assert_eq!(args[0], "true");
            }
            _ => panic!("Expected CallExpression"),
        }
    }

    #[test]
    fn test_detect_compile_error() {
        let source = r#"compileError("This should not compile");"#;
        let sites = detect_macros(source);

        assert_eq!(sites.len(), 1);
        match &sites[0] {
            MacroSite::CallExpression { macro_name, .. } => {
                assert_eq!(macro_name, "compile-error");
            }
            _ => panic!("Expected CallExpression"),
        }
    }

    #[test]
    fn test_detect_jsdoc_typeclass() {
        let source = r#"/** @typeclass */
interface Eq<A> {
  equals(other: A): boolean;
}"#;
        let sites = detect_macros(source);

        assert_eq!(sites.len(), 1);
        match &sites[0] {
            MacroSite::JsDocDeclaration { tag, .. } => {
                assert_eq!(tag, "typeclass");
            }
            _ => panic!("Expected JsDocDeclaration"),
        }
    }

    #[test]
    fn test_detect_jsdoc_cfg() {
        let source = r#"/** @cfg debug */
const debugLog = () => console.log("debug");"#;
        let sites = detect_macros(source);

        assert_eq!(sites.len(), 1);
        match &sites[0] {
            MacroSite::JsDocDeclaration { tag, value, .. } => {
                assert_eq!(tag, "cfg");
                assert_eq!(value.as_deref(), Some("debug"));
            }
            _ => panic!("Expected JsDocDeclaration"),
        }
    }

    #[test]
    fn test_detect_labeled_par() {
        // Note: `let` as a label is not valid JS/TS syntax
        // The preprocessor would rewrite `let:` before it reaches the macro engine
        // We test with `par` which is a valid label
        let source = r#"par: {
  const x = 1;
  const y = 2;
}"#;
        let sites = detect_macros(source);

        assert_eq!(sites.len(), 1);
        match &sites[0] {
            MacroSite::LabeledStatement { label, .. } => {
                assert_eq!(label, "par");
            }
            _ => panic!("Expected LabeledStatement"),
        }
    }

    #[test]
    fn test_detect_multiple_sites() {
        let source = r#"/** @typeclass */
interface Eq<A> {}

staticAssert(true);

/** @cfg debug */
const x = 1;
"#;
        let sites = detect_macros(source);

        assert_eq!(sites.len(), 3);
    }
}

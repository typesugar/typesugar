//! JSDoc comment handling spike
//!
//! This module explores how oxc handles JSDoc comments and how to
//! associate them with AST nodes.

#![allow(dead_code)]

use oxc_allocator::Allocator;
use oxc_ast::Comment;
use oxc_parser::Parser;
use oxc_span::SourceType;

/// Spike result showing comment association
#[derive(Debug)]
pub struct CommentInfo {
    pub text: String,
    pub start: u32,
    pub end: u32,
    pub is_jsdoc: bool,
}

/// Parse source and extract comment information
pub fn analyze_comments(source: &str) -> Vec<CommentInfo> {
    let allocator = Allocator::default();
    let source_type = SourceType::default().with_typescript(true);
    let result = Parser::new(&allocator, source, source_type).parse();

    result
        .program
        .comments
        .iter()
        .map(|c| {
            let text = &source[c.span.start as usize..c.span.end as usize];
            CommentInfo {
                text: text.to_string(),
                start: c.span.start,
                end: c.span.end,
                is_jsdoc: text.starts_with("/**") && text.ends_with("*/"),
            }
        })
        .collect()
}

/// Get the leading JSDoc comment for a declaration at the given position
pub fn get_leading_jsdoc(source: &str, decl_start: u32) -> Option<String> {
    let allocator = Allocator::default();
    let source_type = SourceType::default().with_typescript(true);
    let result = Parser::new(&allocator, source, source_type).parse();

    // Find the closest JSDoc comment that ends before the declaration
    let mut best: Option<&Comment> = None;

    for comment in result.program.comments.iter() {
        let text = &source[comment.span.start as usize..comment.span.end as usize];
        if !text.starts_with("/**") {
            continue;
        }

        // Comment must end before declaration starts
        if comment.span.end >= decl_start {
            continue;
        }

        // Check if there's only whitespace between comment and declaration
        let between = &source[comment.span.end as usize..decl_start as usize];
        if !between.trim().is_empty() {
            continue;
        }

        // This comment is a candidate - keep the closest one
        match best {
            None => best = Some(comment),
            Some(prev) if comment.span.end > prev.span.end => best = Some(comment),
            _ => {}
        }
    }

    best.map(|c| source[c.span.start as usize..c.span.end as usize].to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_jsdoc_detection() {
        let source = r#"
/** @typeclass */
interface Eq<A> {
  equals(other: A): boolean;
}

// Regular comment
const x = 1;

/**
 * @impl Eq<number>
 */
const eqNumber = {
  equals: (other: number) => this === other
};
"#;

        let comments = analyze_comments(source);
        println!("Found {} comments:", comments.len());
        for c in &comments {
            println!(
                "  [{}-{}] jsdoc={} {:?}",
                c.start,
                c.end,
                c.is_jsdoc,
                &c.text[..c.text.len().min(50)]
            );
        }

        // Should find at least 2 JSDoc comments
        let jsdoc_count = comments.iter().filter(|c| c.is_jsdoc).count();
        assert!(jsdoc_count >= 2, "Expected at least 2 JSDoc comments");
    }

    #[test]
    fn test_leading_jsdoc_association() {
        let source = r#"/** @typeclass */
interface Eq<A> {
  equals(other: A): boolean;
}"#;

        // Find the start of "interface" keyword
        let interface_start = source.find("interface").unwrap() as u32;

        let jsdoc = get_leading_jsdoc(source, interface_start);
        assert!(jsdoc.is_some());
        assert!(jsdoc.unwrap().contains("@typeclass"));
    }

    #[test]
    fn test_no_jsdoc_for_regular_comment() {
        let source = r#"// Regular comment
const x = 1;"#;

        let const_start = source.find("const").unwrap() as u32;
        let jsdoc = get_leading_jsdoc(source, const_start);
        assert!(jsdoc.is_none());
    }

    #[test]
    fn test_multiline_jsdoc() {
        let source = r#"/**
 * @impl Eq<string>
 * @pure
 */
const eqString = {};"#;

        let const_start = source.find("const").unwrap() as u32;
        let jsdoc = get_leading_jsdoc(source, const_start);
        assert!(jsdoc.is_some());
        let jsdoc = jsdoc.unwrap();
        assert!(jsdoc.contains("@impl"));
        assert!(jsdoc.contains("@pure"));
    }

    #[test]
    fn test_jsdoc_with_gap_not_associated() {
        let source = r#"/** @typeclass */

const unrelated = 1;

interface Eq<A> {}"#;

        // The JSDoc should NOT be associated with Eq because there's code in between
        let interface_start = source.find("interface").unwrap() as u32;
        let jsdoc = get_leading_jsdoc(source, interface_start);
        assert!(jsdoc.is_none(), "JSDoc with code gap should not associate");
    }
}

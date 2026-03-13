//! JSDoc comment parsing and association with AST nodes
//!
//! This module handles extracting macro-relevant JSDoc annotations
//! (@typeclass, @impl, @deriving, @cfg, @op) and associating them
//! with the AST nodes they precede.

use oxc_ast::Comment;
use oxc_span::Span;
use std::collections::HashMap;

/// Known macro tags that we care about
pub const MACRO_TAGS: &[&str] = &[
    "typeclass",
    "impl",
    "deriving",
    "derive",
    "cfg",
    "op",
    "extension",
    "specialize",
    "reflect",
    "generic",
    "pure",
    "memo",
    "tailrec",
    "comptime",
];

/// A parsed JSDoc tag relevant to macro expansion
#[derive(Debug, Clone)]
pub struct JsDocTag {
    /// Tag name without @ (e.g., "typeclass", "impl")
    pub name: String,
    /// Tag value/argument if present (e.g., "Eq<number>" for @impl)
    pub value: Option<String>,
    /// Span of the tag within the comment
    pub span: Span,
}

/// JSDoc annotations for a single declaration
#[derive(Debug, Clone, Default)]
pub struct JsDocInfo {
    /// The full JSDoc comment text
    pub raw: String,
    /// Parsed tags
    pub tags: Vec<JsDocTag>,
    /// Span of the comment
    pub span: Span,
}

impl JsDocInfo {
    /// Check if this JSDoc has a specific tag
    pub fn has_tag(&self, name: &str) -> bool {
        self.tags.iter().any(|t| t.name == name)
    }

    /// Get the first tag with the given name
    pub fn get_tag(&self, name: &str) -> Option<&JsDocTag> {
        self.tags.iter().find(|t| t.name == name)
    }

    /// Get all tags with the given name
    pub fn get_tags(&self, name: &str) -> Vec<&JsDocTag> {
        self.tags.iter().filter(|t| t.name == name).collect()
    }
}

/// JSDoc annotations associated with their target declarations
#[derive(Debug, Default)]
pub struct JsDocAnnotations {
    /// Map from declaration span start to its JSDoc info
    annotations: HashMap<u32, JsDocInfo>,
}

impl JsDocAnnotations {
    pub fn new() -> Self {
        Self::default()
    }

    /// Get JSDoc info for a declaration at the given span start
    pub fn get(&self, span_start: u32) -> Option<&JsDocInfo> {
        self.annotations.get(&span_start)
    }

    /// Insert JSDoc info for a declaration
    pub fn insert(&mut self, span_start: u32, info: JsDocInfo) {
        self.annotations.insert(span_start, info);
    }

    /// Check if a declaration has a specific tag
    pub fn has_tag(&self, span_start: u32, tag_name: &str) -> bool {
        self.annotations
            .get(&span_start)
            .map(|info| info.has_tag(tag_name))
            .unwrap_or(false)
    }

    /// Iterate over all annotations
    pub fn iter(&self) -> impl Iterator<Item = (&u32, &JsDocInfo)> {
        self.annotations.iter()
    }
}

/// Parse a JSDoc comment and extract tags
pub fn parse_jsdoc(comment_text: &str) -> Vec<JsDocTag> {
    let mut tags = Vec::new();

    // Remove the /** and */ delimiters
    let content = comment_text
        .strip_prefix("/**")
        .and_then(|s| s.strip_suffix("*/"))
        .unwrap_or(comment_text);

    // Split by lines and look for @tags
    for line in content.lines() {
        // Remove leading * and whitespace
        let line = line.trim_start();
        let line = line.strip_prefix('*').unwrap_or(line).trim();

        // Find @tag patterns
        if let Some(rest) = line.strip_prefix('@') {
            // Parse tag name (alphanumeric until whitespace or end)
            let tag_end = rest
                .find(|c: char| !c.is_alphanumeric() && c != '-' && c != '_')
                .unwrap_or(rest.len());
            let tag_name = &rest[..tag_end];

            if !tag_name.is_empty() {
                // Get the value (everything after the tag name)
                let value = rest[tag_end..].trim();
                let value = if value.is_empty() {
                    None
                } else {
                    Some(value.to_string())
                };

                tags.push(JsDocTag {
                    name: tag_name.to_string(),
                    value,
                    span: Span::default(), // We don't track exact position within comment
                });
            }
        }
    }

    tags
}

/// Extract JSDoc annotations from source and associate with declaration positions
pub fn extract_jsdoc_annotations(
    comments: &[Comment],
    source: &str,
    declaration_starts: &[u32],
) -> JsDocAnnotations {
    let mut annotations = JsDocAnnotations::new();

    for &decl_start in declaration_starts {
        // Find the best JSDoc comment for this declaration
        let mut best_comment: Option<&Comment> = None;

        for comment in comments {
            let text = &source[comment.span.start as usize..comment.span.end as usize];

            // Must be a JSDoc comment
            if !text.starts_with("/**") || !text.ends_with("*/") {
                continue;
            }

            // Must end before the declaration
            if comment.span.end >= decl_start {
                continue;
            }

            // Check if there's only whitespace between comment and declaration
            let between = &source[comment.span.end as usize..decl_start as usize];
            if !between.trim().is_empty() {
                continue;
            }

            // Keep the closest comment
            match best_comment {
                None => best_comment = Some(comment),
                Some(prev) if comment.span.end > prev.span.end => best_comment = Some(comment),
                _ => {}
            }
        }

        if let Some(comment) = best_comment {
            let text = &source[comment.span.start as usize..comment.span.end as usize];
            let tags = parse_jsdoc(text);

            // Only include if there are macro-relevant tags
            let has_macro_tag = tags.iter().any(|t| MACRO_TAGS.contains(&t.name.as_str()));
            if has_macro_tag {
                annotations.insert(
                    decl_start,
                    JsDocInfo {
                        raw: text.to_string(),
                        tags,
                        span: comment.span,
                    },
                );
            }
        }
    }

    annotations
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_simple_tag() {
        let comment = "/** @typeclass */";
        let tags = parse_jsdoc(comment);

        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].name, "typeclass");
        assert!(tags[0].value.is_none());
    }

    #[test]
    fn test_parse_tag_with_value() {
        let comment = "/** @impl Eq<number> */";
        let tags = parse_jsdoc(comment);

        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].name, "impl");
        assert_eq!(tags[0].value.as_deref(), Some("Eq<number>"));
    }

    #[test]
    fn test_parse_multiline_tags() {
        let comment = r#"/**
 * @typeclass
 * @deriving Eq, Ord
 */"#;
        let tags = parse_jsdoc(comment);

        assert_eq!(tags.len(), 2);
        assert_eq!(tags[0].name, "typeclass");
        assert_eq!(tags[1].name, "deriving");
        assert_eq!(tags[1].value.as_deref(), Some("Eq, Ord"));
    }

    #[test]
    fn test_parse_cfg_tag() {
        let comment = "/** @cfg debug */";
        let tags = parse_jsdoc(comment);

        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].name, "cfg");
        assert_eq!(tags[0].value.as_deref(), Some("debug"));
    }

    #[test]
    fn test_jsdoc_info_has_tag() {
        let info = JsDocInfo {
            raw: "/** @typeclass @pure */".to_string(),
            tags: vec![
                JsDocTag {
                    name: "typeclass".to_string(),
                    value: None,
                    span: Span::default(),
                },
                JsDocTag {
                    name: "pure".to_string(),
                    value: None,
                    span: Span::default(),
                },
            ],
            span: Span::default(),
        };

        assert!(info.has_tag("typeclass"));
        assert!(info.has_tag("pure"));
        assert!(!info.has_tag("impl"));
    }

    #[test]
    fn test_extract_annotations() {
        use oxc_allocator::Allocator;
        use oxc_parser::Parser;
        use oxc_span::SourceType;

        let source = r#"/** @typeclass */
interface Eq<A> {
  equals(other: A): boolean;
}

/** @cfg debug */
const debugLog = () => {};

const normalConst = 1;
"#;

        let allocator = Allocator::default();
        let source_type = SourceType::default().with_typescript(true);
        let result = Parser::new(&allocator, source, source_type).parse();

        // Get declaration starts from the AST
        let interface_start = source.find("interface").unwrap() as u32;
        let debug_const_start = source.find("const debugLog").unwrap() as u32;
        let normal_const_start = source.find("const normalConst").unwrap() as u32;

        let annotations = extract_jsdoc_annotations(
            &result.program.comments,
            source,
            &[interface_start, debug_const_start, normal_const_start],
        );

        // Interface should have @typeclass
        assert!(annotations.has_tag(interface_start, "typeclass"));

        // debugLog should have @cfg
        assert!(annotations.has_tag(debug_const_start, "cfg"));
        let cfg_info = annotations.get(debug_const_start).unwrap();
        assert_eq!(cfg_info.get_tag("cfg").unwrap().value.as_deref(), Some("debug"));

        // normalConst should have no annotation
        assert!(annotations.get(normal_const_start).is_none());
    }
}

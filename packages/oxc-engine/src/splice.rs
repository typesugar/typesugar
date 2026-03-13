//! Splice logic for inserting macro expansions into the AST
//!
//! This module handles parsing expansion code strings and replacing
//! nodes in the source. Since oxc's AST is arena-allocated and not
//! easily mutated in place, we use a text-based splicing approach
//! for Wave 2 and will migrate to proper AST mutation in later waves.

#![allow(dead_code)]

use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_span::SourceType;

/// Parse a code string as an expression to validate it
pub fn validate_as_expression(code: &str) -> Result<(), Vec<String>> {
    let allocator = Allocator::default();
    let source_type = SourceType::default().with_typescript(true);

    // Wrap in parentheses to parse as expression
    let wrapped = format!("({code})");
    let result = Parser::new(&allocator, &wrapped, source_type).parse();

    if result.errors.is_empty() {
        Ok(())
    } else {
        Err(result.errors.iter().map(|e| e.to_string()).collect())
    }
}

/// Parse a code string as statements to validate it
pub fn validate_as_statements(code: &str) -> Result<(), Vec<String>> {
    let allocator = Allocator::default();
    let source_type = SourceType::default().with_typescript(true);

    let result = Parser::new(&allocator, code, source_type).parse();

    if result.errors.is_empty() {
        Ok(())
    } else {
        Err(result.errors.iter().map(|e| e.to_string()).collect())
    }
}

/// A splice operation to apply to source code
#[derive(Debug, Clone)]
pub struct SpliceOp {
    /// Start position to replace (inclusive)
    pub start: u32,
    /// End position to replace (exclusive)
    pub end: u32,
    /// Replacement text
    pub replacement: String,
}

/// Splicing engine for applying multiple replacements to source
#[derive(Debug, Default)]
pub struct Splicer {
    /// List of splice operations to apply
    ops: Vec<SpliceOp>,
}

impl Splicer {
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a splice operation
    pub fn add(&mut self, start: u32, end: u32, replacement: String) {
        self.ops.push(SpliceOp {
            start,
            end,
            replacement,
        });
    }

    /// Add a removal (replace with empty string)
    pub fn remove(&mut self, start: u32, end: u32) {
        self.add(start, end, String::new());
    }

    /// Apply all splice operations to source
    ///
    /// Operations are applied in reverse order (end to start) to maintain
    /// position validity as we modify the string.
    pub fn apply(&self, source: &str) -> String {
        if self.ops.is_empty() {
            return source.to_string();
        }

        let mut result = source.to_string();

        // Sort operations by start position (descending) so we apply from end
        let mut sorted_ops = self.ops.clone();
        sorted_ops.sort_by(|a, b| b.start.cmp(&a.start));

        for op in sorted_ops {
            let start = op.start as usize;
            let end = op.end as usize;
            if start <= result.len() && end <= result.len() && start <= end {
                result.replace_range(start..end, &op.replacement);
            }
        }

        result
    }

    /// Check if there are any splice operations
    pub fn is_empty(&self) -> bool {
        self.ops.is_empty()
    }

    /// Get the number of operations
    pub fn len(&self) -> usize {
        self.ops.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_expression_valid() {
        assert!(validate_as_expression("1 + 2").is_ok());
        assert!(validate_as_expression("foo()").is_ok());
        assert!(validate_as_expression("x.map(y => y * 2)").is_ok());
    }

    #[test]
    fn test_validate_expression_invalid() {
        assert!(validate_as_expression("const x = 1;").is_err());
        assert!(validate_as_expression("if (true) {}").is_err());
    }

    #[test]
    fn test_validate_statements_valid() {
        assert!(validate_as_statements("const x = 1;").is_ok());
        assert!(validate_as_statements("function foo() {}").is_ok());
        assert!(validate_as_statements("if (true) { console.log(1); }").is_ok());
    }

    #[test]
    fn test_validate_statements_invalid() {
        assert!(validate_as_statements("const x =").is_err());
    }

    #[test]
    fn test_splicer_single_replacement() {
        let mut splicer = Splicer::new();
        splicer.add(0, 5, "world".to_string());

        let result = splicer.apply("hello there");
        assert_eq!(result, "world there");
    }

    #[test]
    fn test_splicer_removal() {
        let mut splicer = Splicer::new();
        splicer.remove(5, 11); // Remove " there"

        let result = splicer.apply("hello there");
        assert_eq!(result, "hello");
    }

    #[test]
    fn test_splicer_multiple_operations() {
        let mut splicer = Splicer::new();
        // Replace "a" with "X" and "c" with "Z"
        splicer.add(0, 1, "X".to_string());
        splicer.add(2, 3, "Z".to_string());

        let result = splicer.apply("a;c;e");
        assert_eq!(result, "X;Z;e");
    }

    #[test]
    fn test_splicer_overlapping_positions() {
        // Later operations don't affect earlier positions because we apply in reverse
        let mut splicer = Splicer::new();
        splicer.add(0, 3, "ABC".to_string());
        splicer.add(6, 9, "XYZ".to_string());

        let result = splicer.apply("123456789");
        assert_eq!(result, "ABC456XYZ");
    }

    #[test]
    fn test_splicer_empty() {
        let splicer = Splicer::new();
        let result = splicer.apply("hello");
        assert_eq!(result, "hello");
        assert!(splicer.is_empty());
    }

    #[test]
    fn test_splicer_insert() {
        let mut splicer = Splicer::new();
        // Insert at position 5 (between "hello" and " world")
        splicer.add(5, 5, " beautiful".to_string());

        let result = splicer.apply("hello world");
        assert_eq!(result, "hello beautiful world");
    }
}

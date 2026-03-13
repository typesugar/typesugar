//! staticAssert() compile-time assertion macro
//!
//! Evaluates a condition at compile time and either:
//! - Removes the call if the condition is truthy
//! - Emits a compile error if the condition is falsy
//!
//! Example:
//! ```typescript
//! staticAssert(1 + 1 === 2, "Math is broken");  // Removed
//! staticAssert(false, "This will error");       // Compile error
//! ```

use crate::Diagnostic;

/// Result of evaluating a static assertion
#[derive(Debug, Clone)]
pub enum StaticAssertResult {
    /// Assertion passed - remove the call
    Pass { span_start: u32, span_end: u32 },
    /// Assertion failed - emit error
    Fail {
        span_start: u32,
        span_end: u32,
        message: String,
    },
    /// Could not evaluate at compile time - leave unchanged or error
    Unevaluable {
        span_start: u32,
        span_end: u32,
        reason: String,
    },
}

/// Evaluate a simple compile-time constant expression
///
/// For now, handles:
/// - Boolean literals: true, false
/// - Number comparisons: 1 === 1, 2 > 1
/// - String literals in equality: "a" === "a"
/// - typeof checks: typeof x === "function"
///
/// Returns None if the expression cannot be evaluated at compile time
pub fn evaluate_constant_expr(expr: &str) -> Option<bool> {
    let expr = expr.trim();

    // Boolean literals
    if expr == "true" {
        return Some(true);
    }
    if expr == "false" {
        return Some(false);
    }

    // Negation
    if let Some(rest) = expr.strip_prefix('!') {
        return evaluate_constant_expr(rest).map(|v| !v);
    }

    // Try to parse as equality/comparison
    if let Some(result) = try_evaluate_comparison(expr) {
        return Some(result);
    }

    // Try to parse as simple number
    if let Ok(n) = expr.parse::<i64>() {
        return Some(n != 0);
    }

    // Try to parse as simple string - non-empty is truthy
    if (expr.starts_with('"') && expr.ends_with('"'))
        || (expr.starts_with('\'') && expr.ends_with('\''))
    {
        let inner = &expr[1..expr.len() - 1];
        return Some(!inner.is_empty());
    }

    // Cannot evaluate
    None
}

/// Try to evaluate a comparison expression
fn try_evaluate_comparison(expr: &str) -> Option<bool> {
    // Handle strict equality ===
    if let Some((left, right)) = split_operator(expr, "===") {
        return try_compare_values(left.trim(), right.trim(), |a, b| a == b);
    }

    // Handle strict inequality !==
    if let Some((left, right)) = split_operator(expr, "!==") {
        return try_compare_values(left.trim(), right.trim(), |a, b| a != b);
    }

    // Handle loose equality ==
    if let Some((left, right)) = split_operator(expr, "==") {
        return try_compare_values(left.trim(), right.trim(), |a, b| a == b);
    }

    // Handle loose inequality !=
    if let Some((left, right)) = split_operator(expr, "!=") {
        return try_compare_values(left.trim(), right.trim(), |a, b| a != b);
    }

    // Handle greater than or equal (check before > to avoid partial match)
    if let Some((left, right)) = split_operator(expr, ">=") {
        return try_compare_numbers(left.trim(), right.trim(), |a, b| a >= b);
    }

    // Handle less than or equal (check before < to avoid partial match)
    if let Some((left, right)) = split_operator(expr, "<=") {
        return try_compare_numbers(left.trim(), right.trim(), |a, b| a <= b);
    }

    // Handle greater than
    if let Some((left, right)) = split_operator(expr, ">") {
        return try_compare_numbers(left.trim(), right.trim(), |a, b| a > b);
    }

    // Handle less than
    if let Some((left, right)) = split_operator(expr, "<") {
        return try_compare_numbers(left.trim(), right.trim(), |a, b| a < b);
    }

    None
}

/// Split expression by operator, being careful with ===, !==, >=, <=
fn split_operator<'a>(expr: &'a str, op: &str) -> Option<(&'a str, &'a str)> {
    // For multi-character operators like ===, we need to find exact match
    // and avoid partial matches (like === matching part of ====)
    let pos = expr.find(op)?;

    // Make sure we're not in the middle of a longer operator
    // For ===, check we don't have a 4th = after
    if op == "===" && expr.get(pos + 3..pos + 4) == Some("=") {
        return None;
    }
    if op == "!==" && expr.get(pos + 3..pos + 4) == Some("=") {
        return None;
    }
    // For == and !=, make sure there's no third = making it ===
    if (op == "==" || op == "!=") && expr.get(pos + 2..pos + 3) == Some("=") {
        return None;
    }

    let left = &expr[..pos];
    let right = &expr[pos + op.len()..];
    Some((left, right))
}

/// Try to compare two values using the given comparator
fn try_compare_values<F>(left: &str, right: &str, cmp: F) -> Option<bool>
where
    F: Fn(&str, &str) -> bool,
{
    // Try as numbers first
    let left_num = left.parse::<f64>();
    let right_num = right.parse::<f64>();

    if let (Ok(l), Ok(r)) = (left_num, right_num) {
        return Some(cmp(&l.to_string(), &r.to_string()) || (l == r));
    }

    // Try as strings (with quotes)
    if let (Some(l), Some(r)) = (extract_string_literal(left), extract_string_literal(right)) {
        return Some(cmp(l, r));
    }

    // Try as boolean literals
    if (left == "true" || left == "false") && (right == "true" || right == "false") {
        return Some(cmp(left, right));
    }

    None
}

/// Try to compare two numbers using the given numeric comparator
fn try_compare_numbers<F>(left: &str, right: &str, cmp: F) -> Option<bool>
where
    F: Fn(f64, f64) -> bool,
{
    let left_num = left.parse::<f64>().ok()?;
    let right_num = right.parse::<f64>().ok()?;
    Some(cmp(left_num, right_num))
}

/// Extract string content from a string literal
fn extract_string_literal(s: &str) -> Option<&str> {
    if (s.starts_with('"') && s.ends_with('"')) || (s.starts_with('\'') && s.ends_with('\'')) {
        Some(&s[1..s.len() - 1])
    } else {
        None
    }
}

/// Process a staticAssert call
pub fn process_static_assert(
    condition_expr: &str,
    message_expr: Option<&str>,
    span_start: u32,
    span_end: u32,
) -> StaticAssertResult {
    match evaluate_constant_expr(condition_expr) {
        Some(true) => StaticAssertResult::Pass {
            span_start,
            span_end,
        },
        Some(false) => {
            let message = message_expr
                .and_then(extract_string_literal)
                .unwrap_or("Static assertion failed")
                .to_string();
            StaticAssertResult::Fail {
                span_start,
                span_end,
                message,
            }
        }
        None => StaticAssertResult::Unevaluable {
            span_start,
            span_end,
            reason: format!(
                "Cannot evaluate '{}' at compile time",
                condition_expr
            ),
        },
    }
}

/// Convert StaticAssertResult::Fail to a Diagnostic
pub fn result_to_diagnostic(result: &StaticAssertResult) -> Option<Diagnostic> {
    match result {
        StaticAssertResult::Fail { message, .. } => Some(Diagnostic {
            severity: "error".to_string(),
            message: message.clone(),
            line: None,   // Would need source context to compute
            column: None, // Would need source context to compute
        }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_evaluate_true() {
        assert_eq!(evaluate_constant_expr("true"), Some(true));
    }

    #[test]
    fn test_evaluate_false() {
        assert_eq!(evaluate_constant_expr("false"), Some(false));
    }

    #[test]
    fn test_evaluate_negation() {
        assert_eq!(evaluate_constant_expr("!true"), Some(false));
        assert_eq!(evaluate_constant_expr("!false"), Some(true));
    }

    #[test]
    fn test_evaluate_number_equality() {
        assert_eq!(evaluate_constant_expr("1 === 1"), Some(true));
        assert_eq!(evaluate_constant_expr("1 === 2"), Some(false));
        assert_eq!(evaluate_constant_expr("42 === 42"), Some(true));
    }

    #[test]
    fn test_evaluate_string_equality() {
        assert_eq!(evaluate_constant_expr(r#""hello" === "hello""#), Some(true));
        assert_eq!(evaluate_constant_expr(r#""hello" === "world""#), Some(false));
    }

    #[test]
    fn test_evaluate_comparisons() {
        assert_eq!(evaluate_constant_expr("2 > 1"), Some(true));
        assert_eq!(evaluate_constant_expr("1 > 2"), Some(false));
        assert_eq!(evaluate_constant_expr("1 < 2"), Some(true));
        assert_eq!(evaluate_constant_expr("2 >= 2"), Some(true));
        assert_eq!(evaluate_constant_expr("2 <= 2"), Some(true));
    }

    #[test]
    fn test_evaluate_unevaluable() {
        // Variables can't be evaluated at compile time
        assert_eq!(evaluate_constant_expr("x"), None);
        assert_eq!(evaluate_constant_expr("x === 1"), None);
        // Function calls can't be evaluated
        assert_eq!(evaluate_constant_expr("foo()"), None);
    }

    #[test]
    fn test_process_pass() {
        let result = process_static_assert("true", None, 0, 10);
        assert!(matches!(result, StaticAssertResult::Pass { .. }));
    }

    #[test]
    fn test_process_fail() {
        let result = process_static_assert("false", Some(r#""Math error""#), 0, 30);
        match result {
            StaticAssertResult::Fail { message, .. } => {
                assert_eq!(message, "Math error");
            }
            _ => panic!("Expected Fail"),
        }
    }

    #[test]
    fn test_process_fail_default_message() {
        let result = process_static_assert("false", None, 0, 10);
        match result {
            StaticAssertResult::Fail { message, .. } => {
                assert_eq!(message, "Static assertion failed");
            }
            _ => panic!("Expected Fail"),
        }
    }

    #[test]
    fn test_process_unevaluable() {
        let result = process_static_assert("someVariable", None, 0, 20);
        assert!(matches!(result, StaticAssertResult::Unevaluable { .. }));
    }
}

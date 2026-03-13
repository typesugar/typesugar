//! @cfg conditional compilation macro
//!
//! The cfg macro conditionally includes or excludes declarations based on
//! configuration flags. Declarations annotated with `/** @cfg <flag> */`
//! are removed when the flag is not set in the config.
//!
//! Example:
//! ```typescript
//! /** @cfg debug */
//! const debugLog = () => console.log("debug");
//!
//! /** @cfg test */
//! function testHelper() {}
//! ```
//!
//! With config `{ debug: true, test: false }`:
//! - debugLog is kept
//! - testHelper is removed

use std::collections::{HashMap, HashSet};

/// Configuration flags for conditional compilation
#[derive(Debug, Clone, Default)]
pub struct CfgConfig {
    /// Set of enabled configuration flags
    pub flags: HashSet<String>,
}

impl CfgConfig {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_flags(flags: impl IntoIterator<Item = impl Into<String>>) -> Self {
        Self {
            flags: flags.into_iter().map(|s| s.into()).collect(),
        }
    }

    pub fn is_enabled(&self, flag: &str) -> bool {
        self.flags.contains(flag)
    }
}

/// Evaluation result for a cfg expression
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CfgResult {
    /// Keep the declaration
    Keep,
    /// Remove the declaration
    Remove,
}

/// Evaluate a cfg expression against the config
///
/// Supports:
/// - Simple flags: `debug`, `test`
/// - Negation: `!debug`
/// - And: `debug && test`
/// - Or: `debug || test`
/// - Parentheses: `(debug || test) && !production`
pub fn evaluate_cfg(expr: &str, config: &CfgConfig) -> CfgResult {
    let expr = expr.trim();

    // Handle empty expression
    if expr.is_empty() {
        return CfgResult::Keep;
    }

    // Handle negation
    if let Some(rest) = expr.strip_prefix('!') {
        return match evaluate_cfg(rest, config) {
            CfgResult::Keep => CfgResult::Remove,
            CfgResult::Remove => CfgResult::Keep,
        };
    }

    // Handle parentheses
    if expr.starts_with('(') && expr.ends_with(')') {
        // Find matching close paren
        let mut depth = 0;
        let mut last_close = 0;
        for (i, c) in expr.chars().enumerate() {
            if c == '(' {
                depth += 1;
            } else if c == ')' {
                depth -= 1;
                if depth == 0 {
                    last_close = i;
                    break;
                }
            }
        }
        if last_close == expr.len() - 1 {
            return evaluate_cfg(&expr[1..expr.len() - 1], config);
        }
    }

    // Handle || (lowest precedence, evaluate left to right)
    if let Some(or_pos) = find_operator(expr, "||") {
        let left = evaluate_cfg(&expr[..or_pos], config);
        let right = evaluate_cfg(&expr[or_pos + 2..], config);
        return match (left, right) {
            (CfgResult::Keep, _) | (_, CfgResult::Keep) => CfgResult::Keep,
            _ => CfgResult::Remove,
        };
    }

    // Handle && (higher precedence)
    if let Some(and_pos) = find_operator(expr, "&&") {
        let left = evaluate_cfg(&expr[..and_pos], config);
        let right = evaluate_cfg(&expr[and_pos + 2..], config);
        return match (left, right) {
            (CfgResult::Keep, CfgResult::Keep) => CfgResult::Keep,
            _ => CfgResult::Remove,
        };
    }

    // Simple flag name
    let flag = expr.trim();
    if config.is_enabled(flag) {
        CfgResult::Keep
    } else {
        CfgResult::Remove
    }
}

/// Find an operator at the top level (not inside parentheses)
fn find_operator(expr: &str, op: &str) -> Option<usize> {
    let mut depth = 0;
    let chars: Vec<char> = expr.chars().collect();
    let op_chars: Vec<char> = op.chars().collect();

    for i in 0..chars.len() {
        if chars[i] == '(' {
            depth += 1;
        } else if chars[i] == ')' {
            depth -= 1;
        } else if depth == 0 && i + op_chars.len() <= chars.len() {
            let slice: String = chars[i..i + op_chars.len()].iter().collect();
            if slice == op {
                return Some(i);
            }
        }
    }
    None
}

/// Spans to remove based on cfg evaluation
#[derive(Debug, Default)]
pub struct CfgRemovalPlan {
    /// Spans (start, end) of statements to remove
    pub removals: Vec<(u32, u32)>,
}

impl CfgRemovalPlan {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add_removal(&mut self, start: u32, end: u32) {
        self.removals.push((start, end));
    }

    /// Apply removals to source code, replacing removed spans with whitespace
    pub fn apply(&self, source: &str) -> String {
        if self.removals.is_empty() {
            return source.to_string();
        }

        let mut result = source.to_string();

        // Sort removals in reverse order to apply from end to start
        let mut sorted_removals = self.removals.clone();
        sorted_removals.sort_by(|a, b| b.0.cmp(&a.0));

        for (start, end) in sorted_removals {
            // Replace the span with empty string
            let start = start as usize;
            let end = end as usize;
            if start < result.len() && end <= result.len() {
                result.replace_range(start..end, "");
            }
        }

        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_flag_enabled() {
        let config = CfgConfig::with_flags(["debug"]);
        assert_eq!(evaluate_cfg("debug", &config), CfgResult::Keep);
    }

    #[test]
    fn test_simple_flag_disabled() {
        let config = CfgConfig::with_flags(["debug"]);
        assert_eq!(evaluate_cfg("test", &config), CfgResult::Remove);
    }

    #[test]
    fn test_negation() {
        let config = CfgConfig::with_flags(["debug"]);
        assert_eq!(evaluate_cfg("!debug", &config), CfgResult::Remove);
        assert_eq!(evaluate_cfg("!test", &config), CfgResult::Keep);
    }

    #[test]
    fn test_and() {
        let config = CfgConfig::with_flags(["debug", "test"]);
        assert_eq!(evaluate_cfg("debug && test", &config), CfgResult::Keep);
        assert_eq!(evaluate_cfg("debug && prod", &config), CfgResult::Remove);
    }

    #[test]
    fn test_or() {
        let config = CfgConfig::with_flags(["debug"]);
        assert_eq!(evaluate_cfg("debug || test", &config), CfgResult::Keep);
        assert_eq!(evaluate_cfg("prod || test", &config), CfgResult::Remove);
    }

    #[test]
    fn test_complex_expression() {
        let config = CfgConfig::with_flags(["debug", "browser"]);
        // (debug || test) && !production
        assert_eq!(
            evaluate_cfg("(debug || test) && !production", &config),
            CfgResult::Keep
        );

        let config2 = CfgConfig::with_flags(["debug", "production"]);
        assert_eq!(
            evaluate_cfg("(debug || test) && !production", &config2),
            CfgResult::Remove
        );
    }

    #[test]
    fn test_removal_plan_apply() {
        let source = "const a = 1;\nconst b = 2;\nconst c = 3;";
        // Positions: "const a = 1;\n" = 0..13, "const b = 2;\n" = 13..26, "const c = 3;" = 26..38
        let mut plan = CfgRemovalPlan::new();

        // Remove "const b = 2;\n" (positions 13 to 26 exclusive)
        plan.add_removal(13, 26);

        let result = plan.apply(source);
        assert_eq!(result, "const a = 1;\nconst c = 3;");
    }

    #[test]
    fn test_removal_plan_multiple() {
        let source = "a;b;c;d;e;";
        let mut plan = CfgRemovalPlan::new();

        // Remove "b;" and "d;"
        plan.add_removal(2, 4);
        plan.add_removal(6, 8);

        let result = plan.apply(source);
        assert_eq!(result, "a;c;e;");
    }
}

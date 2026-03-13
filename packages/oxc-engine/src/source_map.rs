//! Source map generation utilities
//!
//! This module handles source map creation and manipulation for
//! the transformed output.

#![allow(dead_code)]

use oxc_sourcemap::SourceMap;

/// Convert an oxc SourceMap to a JSON string
pub fn sourcemap_to_json(map: &SourceMap) -> String {
    map.to_json_string()
}

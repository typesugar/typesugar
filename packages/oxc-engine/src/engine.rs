//! Engine orchestration: parse → semantic → traverse → codegen
//!
//! This module will coordinate the full transformation pipeline once
//! macro expansion is implemented.

#![allow(dead_code)]

use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_span::SourceType;

/// The macro transformation engine
pub struct Engine<'a> {
    allocator: &'a Allocator,
    source: &'a str,
    source_type: SourceType,
}

impl<'a> Engine<'a> {
    pub fn new(allocator: &'a Allocator, source: &'a str, source_type: SourceType) -> Self {
        Self {
            allocator,
            source,
            source_type,
        }
    }

    /// Parse the source and return the program
    pub fn parse(&self) -> oxc_parser::ParserReturn<'a> {
        Parser::new(self.allocator, self.source, self.source_type).parse()
    }
}

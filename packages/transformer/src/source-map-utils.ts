/**
 * Source Map Utilities for the Transformation Pipeline
 *
 * Provides source map composition and position mapping utilities.
 */

import remapping from "@ampproject/remapping";
import type { RawSourceMap } from "@typesugar/preprocessor";

// Re-export the type for convenience
export type { RawSourceMap };

/**
 * Compose two source maps: preprocessor → transformer
 *
 * The result maps from original source to final transformed output.
 *
 * @param preprocessMap - Source map from preprocessing (original → preprocessed)
 * @param transformMap - Source map from macro transformation (preprocessed → transformed)
 * @returns Composed source map (original → transformed), or null if no mapping needed
 */
export function composeSourceMaps(
  preprocessMap: RawSourceMap | null,
  transformMap: RawSourceMap | null
): RawSourceMap | null {
  if (!preprocessMap && !transformMap) return null;
  if (!preprocessMap) return transformMap;
  if (!transformMap) return preprocessMap;

  // Use @ampproject/remapping to compose the maps
  // The loader function provides upstream source maps when requested
  const composed = remapping(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transformMap as any,
    ((file: string) => {
      // Return the preprocessor's map as the upstream source
      if (file === preprocessMap.sources?.[0]) {
        return preprocessMap;
      }
      return null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any
  );

  return {
    version: 3,
    file: composed.file ?? undefined,
    sourceRoot: composed.sourceRoot ?? "",
    sources: composed.sources.filter((s): s is string => s !== null),
    sourcesContent: composed.sourcesContent,
    names: composed.names,
    mappings: composed.mappings as string,
  };
}

/**
 * Decoded source map segment
 */
export interface DecodedSegment {
  generatedColumn: number;
  sourceIndex?: number;
  sourceLine?: number;
  sourceColumn?: number;
  nameIndex?: number;
}

/**
 * Decoded source map line (array of segments)
 */
export type DecodedLine = DecodedSegment[];

/**
 * Fully decoded source map
 */
export interface DecodedSourceMap {
  version: 3;
  file?: string;
  sourceRoot?: string;
  sources: string[];
  sourcesContent?: (string | null)[];
  names: string[];
  mappings: DecodedLine[];
}

// VLQ character map
const VLQ_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const VLQ_CHAR_MAP = new Map<string, number>();
for (let i = 0; i < VLQ_CHARS.length; i++) {
  VLQ_CHAR_MAP.set(VLQ_CHARS[i], i);
}

/**
 * Decode a VLQ-encoded value
 */
function decodeVLQ(encoded: string, startIndex: number): { value: number; nextIndex: number } {
  let value = 0;
  let shift = 0;
  let index = startIndex;

  while (index < encoded.length) {
    const char = encoded[index];
    const charValue = VLQ_CHAR_MAP.get(char);
    if (charValue === undefined) {
      throw new Error(`Invalid VLQ character: ${char}`);
    }

    const continued = (charValue & 32) !== 0;
    value += (charValue & 31) << shift;

    index++;
    if (!continued) break;
    shift += 5;
  }

  // Convert from unsigned to signed
  const isNegative = (value & 1) !== 0;
  value = value >> 1;
  if (isNegative) value = -value;

  return { value, nextIndex: index };
}

/**
 * Decode VLQ-encoded source map mappings
 */
export function decodeMappings(mappings: string): DecodedLine[] {
  const lines: DecodedLine[] = [];
  let line: DecodedLine = [];

  // State for relative decoding
  let generatedColumn = 0;
  let sourceIndex = 0;
  let sourceLine = 0;
  let sourceColumn = 0;
  let nameIndex = 0;

  let index = 0;
  while (index < mappings.length) {
    const char = mappings[index];

    if (char === ";") {
      // New line
      lines.push(line);
      line = [];
      generatedColumn = 0;
      index++;
      continue;
    }

    if (char === ",") {
      // Next segment in same line
      index++;
      continue;
    }

    // Decode segment
    const segment: DecodedSegment = { generatedColumn: 0 };

    // Generated column (always present)
    const col = decodeVLQ(mappings, index);
    generatedColumn += col.value;
    segment.generatedColumn = generatedColumn;
    index = col.nextIndex;

    // Check if there are more fields
    if (index < mappings.length && mappings[index] !== "," && mappings[index] !== ";") {
      // Source index
      const src = decodeVLQ(mappings, index);
      sourceIndex += src.value;
      segment.sourceIndex = sourceIndex;
      index = src.nextIndex;

      // Source line
      const srcLine = decodeVLQ(mappings, index);
      sourceLine += srcLine.value;
      segment.sourceLine = sourceLine;
      index = srcLine.nextIndex;

      // Source column
      const srcCol = decodeVLQ(mappings, index);
      sourceColumn += srcCol.value;
      segment.sourceColumn = sourceColumn;
      index = srcCol.nextIndex;

      // Optional: name index
      if (index < mappings.length && mappings[index] !== "," && mappings[index] !== ";") {
        const name = decodeVLQ(mappings, index);
        nameIndex += name.value;
        segment.nameIndex = nameIndex;
        index = name.nextIndex;
      }
    }

    line.push(segment);
  }

  // Don't forget the last line
  if (line.length > 0 || lines.length > 0) {
    lines.push(line);
  }

  return lines;
}

/**
 * Decode a raw source map into a decoded source map
 */
export function decodeSourceMap(map: RawSourceMap): DecodedSourceMap {
  return {
    version: 3,
    file: map.file,
    sourceRoot: map.sourceRoot,
    sources: map.sources,
    sourcesContent: map.sourcesContent,
    names: map.names,
    mappings: decodeMappings(map.mappings),
  };
}

/**
 * Position in a source file
 */
export interface SourcePosition {
  line: number;    // 0-based
  column: number;  // 0-based
}

/**
 * Find the original position for a generated position
 */
export function findOriginalPosition(
  decoded: DecodedSourceMap,
  generatedLine: number,
  generatedColumn: number
): SourcePosition | null {
  if (generatedLine < 0 || generatedLine >= decoded.mappings.length) {
    return null;
  }

  const line = decoded.mappings[generatedLine];
  if (line.length === 0) {
    return null;
  }

  // Binary search for the segment containing the column
  let left = 0;
  let right = line.length - 1;
  let bestMatch: DecodedSegment | null = null;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const segment = line[mid];

    if (segment.generatedColumn <= generatedColumn) {
      bestMatch = segment;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  if (!bestMatch || bestMatch.sourceLine === undefined || bestMatch.sourceColumn === undefined) {
    return null;
  }

  // Calculate the offset within the segment
  const columnOffset = generatedColumn - bestMatch.generatedColumn;

  return {
    line: bestMatch.sourceLine,
    column: bestMatch.sourceColumn + columnOffset,
  };
}

/**
 * Find the generated position for an original position
 */
export function findGeneratedPosition(
  decoded: DecodedSourceMap,
  sourceLine: number,
  sourceColumn: number,
  sourceIndex: number = 0
): SourcePosition | null {
  // Search all lines for the best match
  for (let genLine = 0; genLine < decoded.mappings.length; genLine++) {
    const line = decoded.mappings[genLine];

    for (const segment of line) {
      if (
        segment.sourceIndex === sourceIndex &&
        segment.sourceLine === sourceLine
      ) {
        // Found the line, check if column matches
        if (segment.sourceColumn !== undefined && segment.sourceColumn <= sourceColumn) {
          const columnOffset = sourceColumn - segment.sourceColumn;
          return {
            line: genLine,
            column: segment.generatedColumn + columnOffset,
          };
        }
      }
    }
  }

  return null;
}

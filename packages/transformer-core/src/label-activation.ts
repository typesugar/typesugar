/**
 * PEP-052 label-syntax activation gate — the single shared implementation
 * used by both transformers (legacy `@typesugar/transformer` and this
 * package's pipeline).
 *
 * Labeled-block macros (`let:`/`par:` do-notation) and attribute
 * trigger-labels (`requires:`/`ensures:` contracts) only expand in files
 * that activate them via a `@syntax-labels <macroName>` marker import.
 * `globalRegistry.getLabeledBlock` is the raw, activation-UNAWARE lookup;
 * every label dispatch site must go through {@link getActivatedLabeledBlock}
 * (or check {@link globalResolutionScope.isLabelSyntaxActivated} and emit the
 * hint via {@link emitLabelSyntaxNotActivatedHint}) so import-scoped
 * activation cannot be bypassed.
 */

import * as ts from "typescript";
import {
  globalRegistry,
  globalResolutionScope,
  isInOptedOutScope,
  TS9224,
  type LabeledBlockMacro,
  type MacroContext,
} from "@typesugar/core";

/** The slice of MacroContext the gate needs — both transformers' contexts satisfy it. */
type GateContext = Pick<MacroContext, "sourceFile" | "diagnostic">;

/**
 * Emit the TS9224 "label syntax not activated" hint at `hintNode`, unless the
 * file/scope opted out of macros. Shared by labeled-block dispatch and the
 * attribute trigger-label path.
 */
export function emitLabelSyntaxNotActivatedHint(
  ctx: GateContext,
  hintNode: ts.Node,
  labelName: string,
  macro: { name: string; syntaxModule?: string }
): void {
  if (isInOptedOutScope(ctx.sourceFile, hintNode, globalResolutionScope, "macros")) {
    return;
  }
  ctx
    .diagnostic(TS9224)
    .at(hintNode)
    .withArgs({ label: labelName, macro: macro.name })
    .help(
      macro.syntaxModule
        ? `Add \`import "${macro.syntaxModule}";\` to activate ${labelName}: blocks in this file.`
        : `Import a module carrying a \`@syntax-labels ${macro.name}\` marker to activate ${labelName}: blocks in this file.`
    )
    .emit();
}

/**
 * Look up a labeled-block macro for a label, applying the PEP-052
 * `@syntax-labels` activation gate: the macro only expands when the current
 * file imports a module carrying a `@syntax-labels <macro.name>` marker.
 *
 * When the macro matches but is NOT activated, emits the TS9224 hint at
 * `hintNode`. Callers pass `undefined` at peek sites (so the hint fires once,
 * at the labeled statement's own dispatch) and for labels that are not
 * block-shaped (ordinary loop labels that happen to collide — those are never
 * dispatch candidates; enforce the shape check at the call site).
 */
export function getActivatedLabeledBlock(
  ctx: GateContext,
  labelName: string,
  hintNode: ts.Node | undefined
): LabeledBlockMacro | undefined {
  const macro = globalRegistry.getLabeledBlock(labelName);
  if (!macro) return undefined;
  if (globalResolutionScope.isLabelSyntaxActivated(ctx.sourceFile.fileName, macro.name)) {
    return macro;
  }
  if (hintNode) {
    emitLabelSyntaxNotActivatedHint(ctx, hintNode, labelName, macro);
  }
  return undefined;
}

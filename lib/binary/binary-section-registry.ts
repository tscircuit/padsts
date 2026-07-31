import type { SupportedPadsBinaryVersion } from "./pads-binary-document"

export type PadsBinaryDecodeStatus = "decoded" | "partial" | "opaque"
export type PadsBinaryFieldConfidence =
  | "verified"
  | "strong-candidate"
  | "experimental"
  | "unknown"

export interface PadsBinarySectionDefinition {
  index: number
  name: string
  status: PadsBinaryDecodeStatus
  confidence: PadsBinaryFieldConfidence
  fixedRecordSize?: number
  notes: string
}

const OBSERVED_SECTION_DEFINITIONS: Record<
  number,
  Omit<PadsBinarySectionDefinition, "index">
> = {
  1: {
    name: "board-setup",
    status: "partial",
    confidence: "experimental",
    notes: "Candidate layer count and board origin fields are decoded.",
  },
  8: {
    name: "text",
    status: "partial",
    confidence: "experimental",
    notes: "Plausible text records are decoded using section 57 strings.",
  },
  12: {
    name: "vertices",
    status: "partial",
    confidence: "strong-candidate",
    fixedRecordSize: 12,
    notes: "Candidate X/Y coordinates are decoded; flags remain opaque.",
  },
  21: {
    name: "drawing-objects",
    status: "partial",
    confidence: "experimental",
    notes: "A version-specific candidate outline path is exposed for review.",
  },
  22: {
    name: "placements",
    status: "partial",
    confidence: "experimental",
    notes: "Plausible reference, position, and rotation fields are decoded.",
  },
  24: {
    name: "connections",
    status: "partial",
    confidence: "experimental",
    notes: "Candidate connectivity records are debug-only.",
  },
  57: {
    name: "string-pool",
    status: "partial",
    confidence: "strong-candidate",
    notes: "Printable ASCII strings are recovered; pool structure is partial.",
  },
  59: {
    name: "route-endpoints-or-vias",
    status: "partial",
    confidence: "experimental",
    notes: "Candidate positions are debug-only and have no invented aperture.",
  },
  60: {
    name: "route-vertices",
    status: "partial",
    confidence: "experimental",
    notes: "Candidate route paths are debug-only.",
  },
}

export const getPadsBinarySectionDefinition = (
  version: SupportedPadsBinaryVersion,
  index: number,
): PadsBinarySectionDefinition => {
  const observed = OBSERVED_SECTION_DEFINITIONS[index]
  if (observed) {
    return {
      index,
      ...observed,
      notes: `${observed.notes} Observed in container version 0x${version.toString(16)}.`,
    }
  }
  return {
    index,
    name: `unknown-section-${index}`,
    status: "opaque",
    confidence: "unknown",
    notes: "Preserved losslessly; semantic meaning has not been assigned.",
  }
}

export const getPadsBinarySectionRegistry = (
  version: SupportedPadsBinaryVersion,
  sectionCount: number,
): PadsBinarySectionDefinition[] =>
  Array.from({ length: sectionCount }, (_, index) =>
    getPadsBinarySectionDefinition(version, index),
  )

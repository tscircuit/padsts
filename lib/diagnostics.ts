import type { PadsSourceProvenance } from "./source-provenance"

export type PadsDiagnosticSeverity = "info" | "warning" | "error"

export type PadsDiagnosticCategory =
  | "unsupported"
  | "malformed"
  | "approximate"
  | "inferred"
  | "validation"
  | "coverage"

export interface PadsDiagnostic {
  code: string
  severity: PadsDiagnosticSeverity
  category: PadsDiagnosticCategory
  message: string
  source?: PadsSourceProvenance
  entityIds?: string[]
  details?: Record<string, boolean | number | string | string[]>
}

export const createPadsDiagnostic = (
  diagnostic: PadsDiagnostic,
): PadsDiagnostic => diagnostic

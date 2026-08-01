import type { PadsDiagnostic } from "./diagnostics"
import type { PadsInspection, PadsInspectionCoverage } from "./inspection"
import { inspectPads } from "./inspection"
import { type PadsDocument, parsePads } from "./parse-pads"
import { getPadsDocumentSourceProvenance } from "./source-provenance"

export interface PadsConversionReport {
  schemaVersion: "1"
  format: PadsInspection["format"]
  version: string
  strict: boolean
  lossless: boolean
  coverage: PadsInspectionCoverage
  diagnostics: PadsDiagnostic[]
}

export interface PadsValidationResult {
  valid: boolean
  exitCode: 0 | 1
  report: PadsConversionReport
}

const isLossDiagnostic = (diagnostic: PadsDiagnostic): boolean =>
  diagnostic.severity === "error" ||
  diagnostic.category === "unsupported" ||
  diagnostic.category === "malformed" ||
  diagnostic.category === "approximate" ||
  diagnostic.category === "inferred" ||
  diagnostic.category === "coverage"

export const createPadsConversionReport = (
  source: string | Uint8Array | PadsDocument,
  { strict = false }: { strict?: boolean } = {},
): PadsConversionReport => {
  const document =
    typeof source === "string" || source instanceof Uint8Array
      ? parsePads(source)
      : source
  const inspection = inspectPads(document)
  const coverageLoss =
    inspection.coverage.entitiesWithoutProvenance > 0 ||
    inspection.coverage.skippedSourceRecords > 0 ||
    inspection.coverage.malformedSourceRecords > 0 ||
    inspection.coverage.opaqueBinaryBytes > 0
  const diagnosticLoss = inspection.diagnostics.some(isLossDiagnostic)
  const lossless = !coverageLoss && !diagnosticLoss
  const diagnostics = [...inspection.diagnostics]
  if (strict && !lossless) {
    diagnostics.push({
      code: "strict-conversion-would-be-lossy",
      severity: "error",
      category: "coverage",
      message:
        "Strict conversion refused input with unsupported, malformed, inferred, approximate, opaque, or unaccounted source data",
      source: getPadsDocumentSourceProvenance(document),
      details: {
        entitiesWithoutProvenance:
          inspection.coverage.entitiesWithoutProvenance,
        skippedSourceRecords: inspection.coverage.skippedSourceRecords,
        malformedSourceRecords: inspection.coverage.malformedSourceRecords,
        opaqueBinaryBytes: inspection.coverage.opaqueBinaryBytes,
      },
    })
  }
  return {
    schemaVersion: "1",
    format: inspection.format,
    version: inspection.version,
    strict,
    lossless,
    coverage: inspection.coverage,
    diagnostics,
  }
}

export const validatePads = (
  source: string | Uint8Array | PadsDocument,
  { strict = false }: { strict?: boolean } = {},
): PadsValidationResult => {
  const report = createPadsConversionReport(source, { strict })
  const hasErrors = report.diagnostics.some(
    (diagnostic) => diagnostic.severity === "error",
  )
  const valid = !hasErrors && (!strict || report.lossless)
  return {
    valid,
    exitCode: valid ? 0 : 1,
    report,
  }
}

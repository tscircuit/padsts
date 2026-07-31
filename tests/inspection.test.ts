import { describe, expect, test } from "bun:test"
import {
  createPadsConversionReport,
  inspectPads,
  parsePadsAscii,
  validatePads,
} from "../lib"

const sourceText = [
  "!PADS-POWERPCB-V9.5-MILS! DESIGN DATABASE ASCII FILE 1.0",
  "*LINES*",
  "BOARD_OUTLINE BOARD 0 0 1 0",
  "CLOSED 5 10 0 0",
  "0 0",
  "100 0",
  "100 50",
  "0 50",
  "0 0",
  "*END*",
  "",
].join("\n")

describe("PADS inspection and conversion reports", () => {
  test("returns serializable format, sections, entities, bounds, and coverage", () => {
    const inspection = inspectPads(sourceText)

    expect(inspection).toMatchObject({
      schemaVersion: "1",
      format: "ascii",
      version: "V9.5",
      units: "MILS",
      coordinateUnit: "nanometer",
      entityCounts: { paths: 1 },
      bounds: {
        minimumX: 0,
        minimumY: 0,
        maximumX: 2_540_000,
        maximumY: 1_270_000,
      },
    })
    expect(inspection.sections.map(({ name }) => name)).toEqual([
      "PADS-POWERPCB-V9.5-MILS",
      "LINES",
      "END",
    ])
    expect(() => JSON.stringify(inspection)).not.toThrow()
  })

  test("strict validation refuses source records that are not semantically decoded", () => {
    const document = parsePadsAscii(sourceText)
    const report = createPadsConversionReport(document, { strict: true })
    const validation = validatePads(document, { strict: true })

    expect(report.lossless).toBe(false)
    expect(report.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "strict-conversion-would-be-lossy",
        severity: "error",
      }),
    )
    expect(validation).toMatchObject({ valid: false, exitCode: 1 })
  })
})

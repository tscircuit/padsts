import { describe, expect, test } from "bun:test"
import {
  detectPadsFormat,
  extractPadsBoardGeometry,
  PadsAsciiUnknownSection,
  parsePads,
  parsePadsAscii,
} from "../lib"

const fixtureUrl = new URL("./fixtures/minimal.asc", import.meta.url)

describe("PADS ASCII", () => {
  test("parses sections and round-trips the original source", async () => {
    const sourceText = await Bun.file(fixtureUrl).text()
    const document = parsePadsAscii(sourceText)

    expect(document.kind).toBe("ascii")
    expect(document.version).toBe("V9.5")
    expect(document.units).toBe("BASIC")
    expect(document.sections.map((section) => section.name)).toEqual([
      "PADS-POWERPCB-V9.5-BASIC",
      "PCB",
      "FUTURE_RECORDS",
      "END",
    ])
    expect(document.getSection("FUTURE_RECORDS")).toBeInstanceOf(
      PadsAsciiUnknownSection,
    )
    expect(document.getString()).toBe(sourceText)
  })

  test("detects and parses ASCII bytes", async () => {
    const sourceBytes = new Uint8Array(await Bun.file(fixtureUrl).arrayBuffer())

    expect(detectPadsFormat(sourceBytes)).toBe("ascii")
    expect(parsePads(sourceBytes).kind).toBe("ascii")
  })

  test("preserves mixed line endings and a preamble", () => {
    const sourceText = "\r\n*PADS-POWERPCB-V9.5-METRIC*\r\n*PCB*\nBODY\r*END*"
    const document = parsePadsAscii(sourceText)

    expect(document.preambleText).toBe("\r\n")
    expect(document.units).toBe("METRIC")
    expect(document.getString()).toBe(sourceText)
  })

  test("parses the standard bang header and annotated section headers", () => {
    const sourceText =
      "!PADS-POWERPCB-V2005.0-BASIC! DESIGN DATABASE ASCII FILE 1.0\n" +
      "*PCB*        GENERAL PARAMETERS OF THE PCB DESIGN\n" +
      "UNITS 1\n" +
      "*END*     OF ASCII OUTPUT FILE\n"
    const document = parsePadsAscii(sourceText)

    expect(document.version).toBe("V2005.0")
    expect(document.units).toBe("BASIC")
    expect(document.sections.map((section) => section.name)).toEqual([
      "PADS-POWERPCB-V2005.0-BASIC",
      "PCB",
      "END",
    ])
    expect(document.getString()).toBe(sourceText)
  })

  test("omits layer-0 ratlines and thermal flags from fabrication geometry", () => {
    const sourceText = [
      "!PADS-POWERPCB-V9.5-BASIC! DESIGN DATABASE ASCII FILE 1.0",
      "*ROUTE*",
      "*SIGNAL* UNROUTED",
      "U1.1 U2.1",
      "0 0 0 10 1792 THERMAL",
      "100 100 65 10 1792 THERMAL",
      "",
      "*SIGNAL* ROUTED",
      "U1.2 U2.2",
      "0 0 1 10 0",
      "100 0 65 10 0",
      "*END*",
      "",
    ].join("\n")
    const geometry = extractPadsBoardGeometry(parsePadsAscii(sourceText))

    expect(geometry.paths).toHaveLength(1)
    expect(geometry.paths[0]).toMatchObject({
      kind: "route",
      layer: 1,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
    })
    expect(geometry.circles).toEqual([])
    expect(geometry.diagnostics).toContain(
      "1 unrouted ASCII connections omitted from fabrication geometry",
    )
  })

  test("accepts numeric footprint names in part placements", () => {
    const sourceText = [
      "!PADS-POWERPCB-V9.5-BASIC! DESIGN DATABASE ASCII FILE 1.0",
      "*PART*",
      "C6 0402 1250 -2500 90.000 U N 0 -1 0 -1 2",
      "*END*",
      "",
    ].join("\n")
    const geometry = extractPadsBoardGeometry(parsePadsAscii(sourceText))

    expect(geometry.placements).toEqual([
      {
        reference: "C6",
        footprintName: "0402",
        location: { x: 1250, y: -2500 },
        rotation: 90,
        bottomLayer: false,
      },
    ])
  })
})

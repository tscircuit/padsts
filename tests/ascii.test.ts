import { describe, expect, test } from "bun:test"
import {
  detectPadsFormat,
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
})

import { describe, expect, test } from "bun:test"
import {
  detectPadsFormat,
  PADS_BINARY_DIRECTORY_ENTRY_SIZE,
  PADS_BINARY_FOOTER_SIZE,
  PADS_BINARY_HEADER_SIZE,
  PadsParseError,
  parsePads,
  parsePadsBinary,
} from "../lib"

const createMinimalBinaryFixture = (): Uint8Array => {
  const footerStartOffset =
    PADS_BINARY_HEADER_SIZE + 73 * PADS_BINARY_DIRECTORY_ENTRY_SIZE + 3
  const bytes = new Uint8Array(footerStartOffset + PADS_BINARY_FOOTER_SIZE)
  bytes.set([0x00, 0xff, 0x21, 0x20])
  const sectionEntryOffset =
    PADS_BINARY_HEADER_SIZE + PADS_BINARY_DIRECTORY_ENTRY_SIZE
  const entryView = new DataView(bytes.buffer)
  entryView.setUint32(sectionEntryOffset, 1, true)
  entryView.setUint32(sectionEntryOffset + 4, 3, true)
  bytes.set(
    [1, 2, 3],
    PADS_BINARY_HEADER_SIZE + 73 * PADS_BINARY_DIRECTORY_ENTRY_SIZE,
  )
  bytes.set(
    new TextEncoder().encode("{2FE18320-6448-11d1-A412-000000000000}"),
    footerStartOffset + 4,
  )
  entryView.setUint32(footerStartOffset + 42, footerStartOffset, true)
  return bytes
}

const createRandom = (seed: number) => {
  let state = seed >>> 0
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0
    return state
  }
}

describe("detector and parser hostile-input properties", () => {
  test("format detection is total for randomized byte arrays and strings", () => {
    const random = createRandom(0x50414453)
    for (let iteration = 0; iteration < 500; iteration++) {
      const bytes = Uint8Array.from(
        { length: random() % 256 },
        () => random() & 0xff,
      )
      expect(["ascii", "binary", "unknown"]).toContain(detectPadsFormat(bytes))
      expect(["ascii", "unknown"]).toContain(
        detectPadsFormat(new TextDecoder().decode(bytes)),
      )
    }
  })

  test("mutated native containers either round trip or fail with a parse offset", () => {
    const random = createRandom(0x3326)
    const fixture = createMinimalBinaryFixture()
    for (let iteration = 0; iteration < 200; iteration++) {
      const bytes = fixture.slice()
      const mutationCount = 1 + (random() % 4)
      for (let mutation = 0; mutation < mutationCount; mutation++) {
        const offset = random() % bytes.length
        bytes[offset] = random() & 0xff
      }
      try {
        const document = parsePadsBinary(bytes)
        expect(document.getBytes()).toEqual(bytes)
      } catch (error) {
        expect(error).toBeInstanceOf(PadsParseError)
        expect((error as PadsParseError).offset).toBeGreaterThanOrEqual(0)
      }
    }
  })

  test("enforces an application-controlled input allocation limit", () => {
    const source =
      "!PADS-POWERPCB-V9.5-MILS! DESIGN DATABASE ASCII FILE 1.0\n*END*\n"
    expect(() => parsePads(source, { maxInputBytes: 16 })).toThrow(
      PadsParseError,
    )
    expect(parsePads(source, { maxInputBytes: 1024 }).kind).toBe("ascii")
  })

  test("measures string input limits in UTF-8 bytes rather than UTF-16 units", () => {
    expect(() => parsePads("éé", { maxInputBytes: 3 })).toThrow(
      "exceeds the configured 3-byte limit",
    )
  })
})

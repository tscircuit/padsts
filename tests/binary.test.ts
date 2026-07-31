import { describe, expect, test } from "bun:test"
import {
  detectPadsFormat,
  PADS_BINARY_DIRECTORY_ENTRY_SIZE,
  PADS_BINARY_FOOTER_SIZE,
  PADS_BINARY_HEADER_SIZE,
  PadsParseError,
  parsePadsBinary,
} from "../lib"

const FOOTER_GUID = "{2FE18320-6448-11d1-A412-000000000000}"

const writeUint32LittleEndian = (
  targetBytes: Uint8Array,
  offset: number,
  numberToWrite: number,
): void => {
  targetBytes[offset] = numberToWrite & 0xff
  targetBytes[offset + 1] = (numberToWrite >>> 8) & 0xff
  targetBytes[offset + 2] = (numberToWrite >>> 16) & 0xff
  targetBytes[offset + 3] = (numberToWrite >>> 24) & 0xff
}

const createMinimalBinaryFixture = ({
  sectionByteLength = 3,
  availableSectionBytes = 3,
  storedSizeAdjustment = 0,
}: {
  sectionByteLength?: number
  availableSectionBytes?: number
  storedSizeAdjustment?: number
} = {}): Uint8Array => {
  const directoryEntryCount = 73
  const directoryByteLength =
    directoryEntryCount * PADS_BINARY_DIRECTORY_ENTRY_SIZE
  const footerStartOffset =
    PADS_BINARY_HEADER_SIZE + directoryByteLength + availableSectionBytes
  const sourceBytes = new Uint8Array(
    footerStartOffset + PADS_BINARY_FOOTER_SIZE,
  )

  sourceBytes[0] = 0x00
  sourceBytes[1] = 0xff
  sourceBytes[2] = 0x21
  sourceBytes[3] = 0x20

  const sectionOneEntryOffset =
    PADS_BINARY_HEADER_SIZE + PADS_BINARY_DIRECTORY_ENTRY_SIZE
  writeUint32LittleEndian(sourceBytes, sectionOneEntryOffset, 1)
  writeUint32LittleEndian(
    sourceBytes,
    sectionOneEntryOffset + 4,
    sectionByteLength,
  )

  const sectionStartOffset = PADS_BINARY_HEADER_SIZE + directoryByteLength
  for (let index = 0; index < availableSectionBytes; index++) {
    sourceBytes[sectionStartOffset + index] = index + 1
  }

  sourceBytes.set(new TextEncoder().encode(FOOTER_GUID), footerStartOffset + 4)
  writeUint32LittleEndian(
    sourceBytes,
    footerStartOffset + 42,
    footerStartOffset + storedSizeAdjustment,
  )
  return sourceBytes
}

describe("PADS native binary", () => {
  test("parses bounded sections and round-trips every byte", () => {
    const sourceBytes = createMinimalBinaryFixture()
    const document = parsePadsBinary(sourceBytes)

    expect(document.kind).toBe("binary")
    expect(document.version).toBe(0x2021)
    expect(document.directoryEntries).toHaveLength(73)
    expect(document.getSection(1)?.recordCount).toBe(1)
    expect(document.getSection(1)?.getBytes()).toEqual(
      new Uint8Array([1, 2, 3]),
    )
    expect(document.diagnostics).toEqual([])
    expect(document.getBytes()).toEqual(sourceBytes)
    expect(detectPadsFormat(sourceBytes)).toBe("binary")
  })

  test("rejects a section that extends into the footer", () => {
    const sourceBytes = createMinimalBinaryFixture({
      sectionByteLength: 4,
      availableSectionBytes: 3,
    })

    expect(() => parsePadsBinary(sourceBytes)).toThrow(PadsParseError)
    expect(() => parsePadsBinary(sourceBytes)).toThrow(
      "section 1 extends beyond the footer",
    )
  })

  test("reports footer size mismatches without losing bytes", () => {
    const sourceBytes = createMinimalBinaryFixture({ storedSizeAdjustment: 2 })
    const document = parsePadsBinary(sourceBytes)

    expect(document.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "footer-size-mismatch",
    ])
    expect(document.getBytes()).toEqual(sourceBytes)
  })

  test("rebuilds directory and footer sizes after an opaque section edit", () => {
    const document = parsePadsBinary(createMinimalBinaryFixture())
    const editedDocument = document.withSectionBytes(
      1,
      new Uint8Array([9, 8, 7, 6, 5, 4]),
      { recordCount: 2 },
    )
    const reparsedDocument = parsePadsBinary(editedDocument.getBytes())

    expect(reparsedDocument.getSection(1)?.recordCount).toBe(2)
    expect(reparsedDocument.getSection(1)?.getBytes()).toEqual(
      new Uint8Array([9, 8, 7, 6, 5, 4]),
    )
    expect(reparsedDocument.directoryEntries[1]).toMatchObject({
      byteLength: 6,
      recordCount: 2,
    })
    expect(reparsedDocument.footer.storedFileBodySize).toBe(
      editedDocument.getBytes().byteLength - PADS_BINARY_FOOTER_SIZE,
    )
    expect(reparsedDocument.diagnostics).toEqual([])
  })

  test("diagnoses fixed-layout record count and byte-length mismatches", () => {
    const document = parsePadsBinary(createMinimalBinaryFixture())
    const editedDocument = document.withSectionBytes(12, new Uint8Array(13), {
      recordCount: 2,
    })
    const reparsedDocument = parsePadsBinary(editedDocument.getBytes())

    expect(reparsedDocument.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "fixed-record-size-mismatch",
        offset: PADS_BINARY_HEADER_SIZE + 12 * PADS_BINARY_DIRECTORY_ENTRY_SIZE,
      }),
    )
    expect(reparsedDocument.getBytes()).toEqual(editedDocument.getBytes())
  })
})

import { PadsParseError } from "../parse-error"
import { getPadsBinarySectionDefinition } from "./binary-section-registry"
import {
  PADS_BINARY_DIRECTORY_ENTRY_SIZE,
  PADS_BINARY_FOOTER_SIZE,
  PADS_BINARY_HEADER_SIZE,
  type PadsBinaryDiagnostic,
  PadsBinaryDirectoryEntry,
  PadsBinaryDocument,
  PadsBinaryFooter,
  PadsBinaryHeader,
  PadsBinarySection,
  SUPPORTED_PADS_BINARY_VERSIONS,
  type SupportedPadsBinaryVersion,
} from "./pads-binary-document"

const EXPECTED_FOOTER_GUID = "{2FE18320-6448-11d1-A412-000000000000}"

const readUint16LittleEndian = (
  sourceBytes: Uint8Array,
  offset: number,
): number => {
  const firstByte = sourceBytes[offset]
  const secondByte = sourceBytes[offset + 1]
  if (firstByte === undefined || secondByte === undefined) {
    throw new PadsParseError({
      message: "Unexpected end of PADS binary input while reading uint16",
      offset,
    })
  }
  return firstByte | (secondByte << 8)
}

const readUint32LittleEndian = (
  sourceBytes: Uint8Array,
  offset: number,
): number => {
  const firstByte = sourceBytes[offset]
  const secondByte = sourceBytes[offset + 1]
  const thirdByte = sourceBytes[offset + 2]
  const fourthByte = sourceBytes[offset + 3]
  if (
    firstByte === undefined ||
    secondByte === undefined ||
    thirdByte === undefined ||
    fourthByte === undefined
  ) {
    throw new PadsParseError({
      message: "Unexpected end of PADS binary input while reading uint32",
      offset,
    })
  }

  return (
    firstByte +
    secondByte * 0x100 +
    thirdByte * 0x10000 +
    fourthByte * 0x1000000
  )
}

const isSupportedVersion = (
  version: number,
): version is SupportedPadsBinaryVersion =>
  SUPPORTED_PADS_BINARY_VERSIONS.some(
    (supportedVersion) => supportedVersion === version,
  )

const getDirectoryEntryCount = (version: SupportedPadsBinaryVersion): number =>
  version === 0x2021 ? 73 : 74

export const isPadsBinaryBytes = (sourceBytes: Uint8Array): boolean =>
  sourceBytes[0] === 0x00 && sourceBytes[1] === 0xff

export const parsePadsBinary = (
  sourceBytes: Uint8Array,
): PadsBinaryDocument => {
  if (
    sourceBytes.byteLength <
    PADS_BINARY_HEADER_SIZE + PADS_BINARY_FOOTER_SIZE
  ) {
    throw new PadsParseError({
      message: "Input is too small to contain a PADS binary header and footer",
      offset: sourceBytes.byteLength,
    })
  }

  if (!isPadsBinaryBytes(sourceBytes)) {
    throw new PadsParseError({
      message: "Invalid PADS binary magic bytes",
      offset: 0,
    })
  }

  const version = readUint16LittleEndian(sourceBytes, 2)
  if (!isSupportedVersion(version)) {
    throw new PadsParseError({
      message: `Unsupported PADS binary version 0x${version.toString(16)}`,
      offset: 2,
    })
  }

  const directoryEntryCount = getDirectoryEntryCount(version)
  const directoryStartOffset = PADS_BINARY_HEADER_SIZE
  const directoryEndOffset =
    directoryStartOffset +
    directoryEntryCount * PADS_BINARY_DIRECTORY_ENTRY_SIZE
  const footerStartOffset = sourceBytes.byteLength - PADS_BINARY_FOOTER_SIZE

  if (directoryEndOffset > footerStartOffset) {
    throw new PadsParseError({
      message:
        "Input is too small to contain the PADS binary section directory",
      offset: directoryEndOffset,
    })
  }

  const header = new PadsBinaryHeader({
    bytes: sourceBytes.slice(0, PADS_BINARY_HEADER_SIZE),
    version,
  })
  const directoryEntries: PadsBinaryDirectoryEntry[] = []
  const sections: PadsBinarySection[] = []
  const diagnostics: PadsBinaryDiagnostic[] = []
  let sectionOffset = directoryEndOffset

  for (let index = 0; index < directoryEntryCount; index++) {
    const entryOffset =
      directoryStartOffset + index * PADS_BINARY_DIRECTORY_ENTRY_SIZE
    const recordCount = readUint32LittleEndian(sourceBytes, entryOffset)
    const byteLength = readUint32LittleEndian(sourceBytes, entryOffset + 4)
    const entrySectionOffset = index === 0 ? 0 : sectionOffset
    const directoryEntry = new PadsBinaryDirectoryEntry({
      bytes: sourceBytes.slice(
        entryOffset,
        entryOffset + PADS_BINARY_DIRECTORY_ENTRY_SIZE,
      ),
      index,
      recordCount,
      byteLength,
      sectionOffset: entrySectionOffset,
    })
    directoryEntries.push(directoryEntry)

    const sectionDefinition = getPadsBinarySectionDefinition(version, index)
    if (
      sectionDefinition.fixedRecordSize !== undefined &&
      byteLength !== recordCount * sectionDefinition.fixedRecordSize
    ) {
      diagnostics.push({
        code: "fixed-record-size-mismatch",
        message: `PADS binary section ${index} declares ${recordCount} records and ${byteLength} bytes; expected ${recordCount * sectionDefinition.fixedRecordSize} bytes`,
        offset: entryOffset,
      })
    }

    if (index === 0) {
      sections.push(
        new PadsBinarySection({ directoryEntry, bytes: new Uint8Array() }),
      )
      continue
    }

    const sectionEndOffset = sectionOffset + byteLength
    if (
      !Number.isSafeInteger(sectionEndOffset) ||
      sectionEndOffset > footerStartOffset
    ) {
      throw new PadsParseError({
        message: `PADS binary section ${index} extends beyond the footer`,
        offset: entryOffset + 4,
      })
    }

    sections.push(
      new PadsBinarySection({
        directoryEntry,
        bytes: sourceBytes.slice(sectionOffset, sectionEndOffset),
      }),
    )
    sectionOffset = sectionEndOffset
  }

  const footerBytes = sourceBytes.slice(footerStartOffset)
  const guidText = new TextDecoder().decode(footerBytes.slice(4, 42))
  const storedFileBodySize = readUint32LittleEndian(footerBytes, 42)
  if (guidText !== EXPECTED_FOOTER_GUID) {
    diagnostics.push({
      code: "footer-guid-mismatch",
      message: `Unexpected PADS footer marker ${JSON.stringify(guidText)}`,
      offset: footerStartOffset + 4,
    })
  }

  if (storedFileBodySize !== footerStartOffset) {
    diagnostics.push({
      code: "footer-size-mismatch",
      message: `PADS footer stores body size ${storedFileBodySize}, actual size is ${footerStartOffset}`,
      offset: footerStartOffset + 42,
    })
  }

  return new PadsBinaryDocument({
    header,
    directoryEntries,
    sections,
    trailingBytes: sourceBytes.slice(sectionOffset, footerStartOffset),
    footer: new PadsBinaryFooter({
      bytes: footerBytes,
      guidText,
      storedFileBodySize,
    }),
    diagnostics,
  })
}

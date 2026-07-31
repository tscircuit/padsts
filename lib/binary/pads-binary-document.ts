export const PADS_BINARY_HEADER_SIZE = 10
export const PADS_BINARY_DIRECTORY_ENTRY_SIZE = 16
export const PADS_BINARY_FOOTER_SIZE = 46

export const SUPPORTED_PADS_BINARY_VERSIONS = [
  0x2021, 0x2025, 0x2026, 0x2027,
] as const

export type SupportedPadsBinaryVersion =
  (typeof SUPPORTED_PADS_BINARY_VERSIONS)[number]

export interface PadsBinaryHeaderInit {
  bytes: Uint8Array
  version: SupportedPadsBinaryVersion
}

export class PadsBinaryHeader {
  readonly bytes: Uint8Array
  readonly version: SupportedPadsBinaryVersion

  constructor({ bytes, version }: PadsBinaryHeaderInit) {
    this.bytes = bytes.slice()
    this.version = version
  }

  getBytes(): Uint8Array {
    return this.bytes.slice()
  }
}

export interface PadsBinaryDirectoryEntryInit {
  bytes: Uint8Array
  index: number
  recordCount: number
  byteLength: number
  sectionOffset: number
}

export class PadsBinaryDirectoryEntry {
  readonly bytes: Uint8Array
  readonly index: number
  readonly recordCount: number
  readonly byteLength: number
  readonly sectionOffset: number

  constructor({
    bytes,
    index,
    recordCount,
    byteLength,
    sectionOffset,
  }: PadsBinaryDirectoryEntryInit) {
    this.bytes = bytes.slice()
    this.index = index
    this.recordCount = recordCount
    this.byteLength = byteLength
    this.sectionOffset = sectionOffset
  }

  getBytes(): Uint8Array {
    return this.bytes.slice()
  }

  withLayout({
    recordCount = this.recordCount,
    byteLength = this.byteLength,
    sectionOffset = this.sectionOffset,
  }: {
    recordCount?: number
    byteLength?: number
    sectionOffset?: number
  }): PadsBinaryDirectoryEntry {
    if (
      !Number.isSafeInteger(recordCount) ||
      recordCount < 0 ||
      recordCount > 0xffff_ffff ||
      !Number.isSafeInteger(byteLength) ||
      byteLength < 0 ||
      byteLength > 0xffff_ffff
    ) {
      throw new RangeError("Invalid PADS binary directory entry layout")
    }
    const bytes = this.bytes.slice()
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    view.setUint32(0, recordCount, true)
    view.setUint32(4, byteLength, true)
    return new PadsBinaryDirectoryEntry({
      bytes,
      index: this.index,
      recordCount,
      byteLength,
      sectionOffset,
    })
  }
}

export interface PadsBinarySectionInit {
  directoryEntry: PadsBinaryDirectoryEntry
  bytes: Uint8Array
}

export class PadsBinarySection {
  readonly directoryEntry: PadsBinaryDirectoryEntry
  readonly bytes: Uint8Array

  constructor({ directoryEntry, bytes }: PadsBinarySectionInit) {
    this.directoryEntry = directoryEntry
    this.bytes = bytes.slice()
  }

  get index(): number {
    return this.directoryEntry.index
  }

  get recordCount(): number {
    return this.directoryEntry.recordCount
  }

  getBytes(): Uint8Array {
    return this.bytes.slice()
  }
}

export interface PadsBinaryFooterInit {
  bytes: Uint8Array
  guidText: string
  storedFileBodySize: number
}

export class PadsBinaryFooter {
  readonly bytes: Uint8Array
  readonly guidText: string
  readonly storedFileBodySize: number

  constructor({ bytes, guidText, storedFileBodySize }: PadsBinaryFooterInit) {
    this.bytes = bytes.slice()
    this.guidText = guidText
    this.storedFileBodySize = storedFileBodySize
  }

  getBytes(): Uint8Array {
    return this.bytes.slice()
  }

  withStoredFileBodySize(storedFileBodySize: number): PadsBinaryFooter {
    if (
      !Number.isSafeInteger(storedFileBodySize) ||
      storedFileBodySize < 0 ||
      storedFileBodySize > 0xffff_ffff
    ) {
      throw new RangeError("Invalid PADS binary footer body size")
    }
    const bytes = this.bytes.slice()
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    view.setUint32(42, storedFileBodySize, true)
    return new PadsBinaryFooter({
      bytes,
      guidText: this.guidText,
      storedFileBodySize,
    })
  }
}

export type PadsBinaryDiagnosticCode =
  | "footer-guid-mismatch"
  | "footer-size-mismatch"
  | "fixed-record-size-mismatch"

export interface PadsBinaryDiagnostic {
  code: PadsBinaryDiagnosticCode
  message: string
  offset: number
}

export interface PadsBinaryDocumentInit {
  header: PadsBinaryHeader
  directoryEntries: PadsBinaryDirectoryEntry[]
  sections: PadsBinarySection[]
  trailingBytes: Uint8Array
  footer: PadsBinaryFooter
  diagnostics?: PadsBinaryDiagnostic[]
}

const concatenateBytes = (chunks: Uint8Array[]): Uint8Array => {
  let byteLength = 0
  for (const chunk of chunks) byteLength += chunk.byteLength

  const combinedBytes = new Uint8Array(byteLength)
  let writeOffset = 0
  for (const chunk of chunks) {
    combinedBytes.set(chunk, writeOffset)
    writeOffset += chunk.byteLength
  }
  return combinedBytes
}

export class PadsBinaryDocument {
  readonly kind = "binary"
  readonly header: PadsBinaryHeader
  readonly directoryEntries: PadsBinaryDirectoryEntry[]
  readonly sections: PadsBinarySection[]
  readonly trailingBytes: Uint8Array
  readonly footer: PadsBinaryFooter
  readonly diagnostics: PadsBinaryDiagnostic[]

  constructor({
    header,
    directoryEntries,
    sections,
    trailingBytes,
    footer,
    diagnostics = [],
  }: PadsBinaryDocumentInit) {
    this.header = header
    this.directoryEntries = directoryEntries
    this.sections = sections
    this.trailingBytes = trailingBytes.slice()
    this.footer = footer
    this.diagnostics = diagnostics
  }

  get version(): SupportedPadsBinaryVersion {
    return this.header.version
  }

  getChildren(): readonly PadsBinarySection[] {
    return this.sections
  }

  getSection(index: number): PadsBinarySection | undefined {
    return this.sections[index]
  }

  getBytes(): Uint8Array {
    return concatenateBytes([
      this.header.getBytes(),
      ...this.directoryEntries.map((entry) => entry.getBytes()),
      ...this.sections.map((section) => section.getBytes()),
      this.trailingBytes,
      this.footer.getBytes(),
    ])
  }

  withSectionBytes(
    index: number,
    bytes: Uint8Array,
    { recordCount }: { recordCount?: number } = {},
  ): PadsBinaryDocument {
    if (
      !Number.isInteger(index) ||
      index <= 0 ||
      index >= this.sections.length
    ) {
      throw new RangeError(`Invalid mutable PADS binary section index ${index}`)
    }

    const updatedSections = this.sections.map((section) =>
      section.index === index
        ? new PadsBinarySection({
            directoryEntry: section.directoryEntry,
            bytes,
          })
        : section,
    )
    const directoryByteLength = this.directoryEntries.reduce(
      (total, entry) => total + entry.bytes.byteLength,
      0,
    )
    let sectionOffset = this.header.bytes.byteLength + directoryByteLength
    const updatedDirectoryEntries = this.directoryEntries.map((entry) => {
      if (entry.index === 0) return entry.withLayout({ sectionOffset: 0 })
      const section = updatedSections[entry.index]
      const updatedEntry = entry.withLayout({
        recordCount:
          entry.index === index
            ? (recordCount ?? entry.recordCount)
            : undefined,
        byteLength: section?.bytes.byteLength ?? 0,
        sectionOffset,
      })
      sectionOffset += updatedEntry.byteLength
      return updatedEntry
    })
    const sectionsWithUpdatedEntries = updatedSections.map(
      (section, sectionIndex) =>
        new PadsBinarySection({
          directoryEntry:
            updatedDirectoryEntries[sectionIndex] ?? section.directoryEntry,
          bytes: section.bytes,
        }),
    )
    const storedFileBodySize = sectionOffset + this.trailingBytes.byteLength

    return new PadsBinaryDocument({
      header: this.header,
      directoryEntries: updatedDirectoryEntries,
      sections: sectionsWithUpdatedEntries,
      trailingBytes: this.trailingBytes,
      footer: this.footer.withStoredFileBodySize(storedFileBodySize),
      diagnostics: [],
    })
  }

  editSectionBytes(
    index: number,
    update: (bytes: Uint8Array) => Uint8Array,
    options: { recordCount?: number } = {},
  ): PadsBinaryDocument {
    const section = this.getSection(index)
    if (!section) {
      throw new RangeError(`Missing mutable PADS binary section ${index}`)
    }
    return this.withSectionBytes(index, update(section.getBytes()), options)
  }
}

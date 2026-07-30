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
}

export type PadsBinaryDiagnosticCode =
  | "footer-guid-mismatch"
  | "footer-size-mismatch"

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
}

import type { PadsAsciiSourceProvenance } from "../source-provenance"
import type { PadsAsciiRecord } from "./pads-ascii-record"

const KNOWN_SECTION_NAMES = new Set([
  "PCB",
  "REUSE",
  "TEXT",
  "LINES",
  "VIA",
  "PARTDECAL",
  "PARTTYPE",
  "PART",
  "NET",
  "ROUTE",
  "POUR",
  "TESTPOINT",
  "MISC",
  "LAYER",
  "END",
])

export interface PadsAsciiSectionInit {
  name: string
  headerText: string
  bodyText?: string
  records?: PadsAsciiRecord[]
  provenance?: PadsAsciiSourceProvenance
}

export class PadsAsciiSection {
  readonly kind: "section" | "unknown-section" = "section"
  readonly name: string
  readonly headerText: string
  readonly bodyText: string
  readonly records: PadsAsciiRecord[]
  readonly provenance?: PadsAsciiSourceProvenance

  constructor({
    name,
    headerText,
    bodyText = "",
    records = [],
    provenance,
  }: PadsAsciiSectionInit) {
    this.name = name
    this.headerText = headerText
    this.bodyText = bodyText
    this.records = records
    this.provenance = provenance
  }

  getChildren(): readonly PadsAsciiRecord[] {
    return this.records
  }

  getString(): string {
    return `${this.headerText}${
      this.records.length > 0
        ? this.records.map((record) => record.getString()).join("")
        : this.bodyText
    }`
  }

  withRecords(records: PadsAsciiRecord[]): PadsAsciiSection {
    return createPadsAsciiSection({
      name: this.name,
      headerText: this.headerText,
      bodyText: "",
      records,
      provenance: this.provenance,
    })
  }

  withHeaderText(headerText: string): PadsAsciiSection {
    return createPadsAsciiSection({
      name: this.name,
      headerText,
      bodyText: this.bodyText,
      records: this.records,
      provenance: this.provenance,
    })
  }
}

export class PadsAsciiUnknownSection extends PadsAsciiSection {
  override readonly kind = "unknown-section"
}

export const createPadsAsciiSection = (
  init: PadsAsciiSectionInit,
): PadsAsciiSection => {
  if (
    init.name.startsWith("PADS-POWERPCB-") ||
    KNOWN_SECTION_NAMES.has(init.name)
  ) {
    return new PadsAsciiSection(init)
  }

  return new PadsAsciiUnknownSection(init)
}

export const isKnownPadsAsciiSectionName = (name: string): boolean =>
  name.startsWith("PADS-POWERPCB-") || KNOWN_SECTION_NAMES.has(name)

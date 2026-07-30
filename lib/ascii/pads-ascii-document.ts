import type { PadsAsciiSection } from "./pads-ascii-section"

export type PadsAsciiUnits = "BASIC" | "MILS" | "METRIC" | "unknown"

export interface PadsAsciiDocumentInit {
  preambleText?: string
  sections: PadsAsciiSection[]
  version: string
  units: PadsAsciiUnits
}

export class PadsAsciiDocument {
  readonly kind = "ascii"
  readonly preambleText: string
  readonly sections: PadsAsciiSection[]
  readonly version: string
  readonly units: PadsAsciiUnits

  constructor({
    preambleText = "",
    sections,
    version,
    units,
  }: PadsAsciiDocumentInit) {
    this.preambleText = preambleText
    this.sections = sections
    this.version = version
    this.units = units
  }

  getChildren(): readonly PadsAsciiSection[] {
    return this.sections
  }

  getSection(name: string): PadsAsciiSection | undefined {
    return this.sections.find((section) => section.name === name)
  }

  getString(): string {
    return `${this.preambleText}${this.sections
      .map((section) => section.getString())
      .join("")}`
  }
}

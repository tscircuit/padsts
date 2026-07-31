import type { PadsDiagnostic } from "../diagnostics"
import {
  type PadsAsciiBoardSetup,
  parsePadsAsciiBoardSetup,
} from "./pads-ascii-board-setup"
import type { PadsAsciiSection } from "./pads-ascii-section"

export type PadsAsciiUnits = "BASIC" | "MILS" | "INCHES" | "METRIC" | "unknown"

export interface PadsAsciiDocumentInit {
  preambleText?: string
  sections: PadsAsciiSection[]
  version: string
  units: PadsAsciiUnits
  diagnostics?: PadsDiagnostic[]
  coverage?: PadsAsciiCoverage
}

export interface PadsAsciiCoverage {
  sectionCount: number
  knownSectionCount: number
  unknownSectionCount: number
  recordCount: number
  recordsByKind: Record<string, number>
}

export class PadsAsciiDocument {
  readonly kind = "ascii"
  readonly preambleText: string
  readonly sections: PadsAsciiSection[]
  readonly version: string
  readonly units: PadsAsciiUnits
  readonly diagnostics: PadsDiagnostic[]
  readonly coverage: PadsAsciiCoverage

  constructor({
    preambleText = "",
    sections,
    version,
    units,
    diagnostics = [],
    coverage = {
      sectionCount: sections.length,
      knownSectionCount: sections.filter(
        (section) => section.kind === "section",
      ).length,
      unknownSectionCount: sections.filter(
        (section) => section.kind === "unknown-section",
      ).length,
      recordCount: sections.reduce(
        (count, section) => count + section.records.length,
        0,
      ),
      recordsByKind: {},
    },
  }: PadsAsciiDocumentInit) {
    this.preambleText = preambleText
    this.sections = sections
    this.version = version
    this.units = units
    this.diagnostics = diagnostics
    this.coverage = coverage
  }

  getChildren(): readonly PadsAsciiSection[] {
    return this.sections
  }

  get boardSetup(): PadsAsciiBoardSetup {
    return parsePadsAsciiBoardSetup(this.sections, this.units)
  }

  getSection(name: string): PadsAsciiSection | undefined {
    return this.sections.find((section) => section.name === name)
  }

  getSections(name: string): PadsAsciiSection[] {
    return this.sections.filter((section) => section.name === name)
  }

  getString(): string {
    return `${this.preambleText}${this.sections
      .map((section) => section.getString())
      .join("")}`
  }

  withSections(sections: PadsAsciiSection[]): PadsAsciiDocument {
    return new PadsAsciiDocument({
      preambleText: this.preambleText,
      sections,
      version: this.version,
      units: this.units,
      diagnostics: this.diagnostics,
    })
  }

  replaceSection(
    sectionToReplace: PadsAsciiSection,
    replacement: PadsAsciiSection,
  ): PadsAsciiDocument {
    return this.withSections(
      this.sections.map((section) =>
        section === sectionToReplace ? replacement : section,
      ),
    )
  }

  insertSection(index: number, section: PadsAsciiSection): PadsAsciiDocument {
    if (!Number.isInteger(index) || index < 0 || index > this.sections.length) {
      throw new RangeError(`Invalid PADS ASCII section index ${index}`)
    }
    return this.withSections([
      ...this.sections.slice(0, index),
      section,
      ...this.sections.slice(index),
    ])
  }

  removeSection(sectionToRemove: PadsAsciiSection): PadsAsciiDocument {
    return this.withSections(
      this.sections.filter((section) => section !== sectionToRemove),
    )
  }
}

const KNOWN_SECTION_NAMES = new Set([
  "PCB",
  "REUSE",
  "TEXT",
  "LINES",
  "PARTDECAL",
  "PARTTYPE",
  "PART",
  "SIGNAL",
  "POUR",
  "MISC",
  "END",
])

export interface PadsAsciiSectionInit {
  name: string
  headerText: string
  bodyText?: string
}

export class PadsAsciiSection {
  readonly kind: "section" | "unknown-section" = "section"
  readonly name: string
  readonly headerText: string
  readonly bodyText: string

  constructor({ name, headerText, bodyText = "" }: PadsAsciiSectionInit) {
    this.name = name
    this.headerText = headerText
    this.bodyText = bodyText
  }

  getChildren(): readonly [] {
    return []
  }

  getString(): string {
    return `${this.headerText}${this.bodyText}`
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

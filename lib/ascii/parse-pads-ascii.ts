import type { PadsDiagnostic } from "../diagnostics"
import { PadsParseError } from "../parse-error"
import { createPadsAsciiDocumentSourceProvenance } from "../source-provenance"
import { PadsAsciiDocument, type PadsAsciiUnits } from "./pads-ascii-document"
import { createPadsAsciiRecord } from "./pads-ascii-record"
import {
  createPadsAsciiSection,
  isKnownPadsAsciiSectionName,
} from "./pads-ascii-section"

interface LineSpan {
  startOffset: number
  endOffset: number
  line: number
  sectionName?: string
}

const NESTED_HEADER_NAMES = new Set(["REMARK", "SIGNAL"])

const getSectionName = (lineText: string): string | undefined => {
  const contentText = lineText.replace(/(?:\r\n|\r|\n)$/u, "").trim()
  const padsHeaderMatch = /^!(PADS-POWERPCB-[^!]+)!/u.exec(contentText)
  if (padsHeaderMatch?.[1]) return padsHeaderMatch[1]

  const sectionHeaderMatch = /^\*([^*\s]+)\*/u.exec(contentText)
  return sectionHeaderMatch?.[1]
}

const readLineSpans = (sourceText: string): LineSpan[] => {
  const lineSpans: LineSpan[] = []
  let startOffset = 0
  let line = 1

  while (startOffset < sourceText.length) {
    let endOffset = startOffset
    while (
      endOffset < sourceText.length &&
      sourceText[endOffset] !== "\r" &&
      sourceText[endOffset] !== "\n"
    ) {
      endOffset++
    }

    if (sourceText[endOffset] === "\r" && sourceText[endOffset + 1] === "\n") {
      endOffset += 2
    } else if (
      sourceText[endOffset] === "\r" ||
      sourceText[endOffset] === "\n"
    ) {
      endOffset++
    }

    const lineText = sourceText.slice(startOffset, endOffset)
    lineSpans.push({
      startOffset,
      endOffset,
      line,
      sectionName: getSectionName(lineText),
    })
    startOffset = endOffset
    line++
  }

  return lineSpans
}

const parseVersionHeader = (
  sectionName: string,
): { version: string; units: PadsAsciiUnits } | undefined => {
  const match = /^PADS-POWERPCB-(.+)-(BASIC|MILS|INCHES|METRIC)$/u.exec(
    sectionName,
  )
  if (!match) return undefined

  return {
    version: match[1] ?? "unknown",
    units: (match[2] as PadsAsciiUnits | undefined) ?? "unknown",
  }
}

export const isPadsAsciiText = (sourceText: string): boolean => {
  const beginningText = sourceText.slice(0, 512).trimStart()
  return (
    beginningText.startsWith("!PADS-POWERPCB-") ||
    beginningText.startsWith("*PADS-POWERPCB-")
  )
}

export const parsePadsAscii = (sourceText: string): PadsAsciiDocument => {
  const lineSpans = readLineSpans(sourceText)
  const sectionLineSpans: LineSpan[] = []

  for (const lineSpan of lineSpans) {
    if (
      lineSpan.sectionName &&
      !NESTED_HEADER_NAMES.has(lineSpan.sectionName)
    ) {
      sectionLineSpans.push(lineSpan)
    }
  }

  const firstSection = sectionLineSpans[0]
  if (!firstSection?.sectionName) {
    throw new PadsParseError({
      message: "PADS ASCII input has no section header",
      offset: 0,
    })
  }

  const versionHeader = parseVersionHeader(firstSection.sectionName)
  if (!versionHeader) {
    throw new PadsParseError({
      message: "PADS ASCII input does not start with a PADS-POWERPCB header",
      offset: firstSection.startOffset,
    })
  }

  const sections = []
  const sectionNameCounts = new Map<string, number>()
  for (let index = 0; index < sectionLineSpans.length; index++) {
    const lineSpan = sectionLineSpans[index]
    if (!lineSpan?.sectionName) continue

    const nextLineSpan = sectionLineSpans[index + 1]
    const sectionEndOffset = nextLineSpan?.startOffset ?? sourceText.length
    const bodyLineSpans = lineSpans.filter(
      (candidateLineSpan) =>
        candidateLineSpan.startOffset >= lineSpan.endOffset &&
        candidateLineSpan.startOffset < sectionEndOffset,
    )
    const occurrence = (sectionNameCounts.get(lineSpan.sectionName) ?? 0) + 1
    sectionNameCounts.set(lineSpan.sectionName, occurrence)
    sections.push(
      createPadsAsciiSection({
        name: lineSpan.sectionName,
        headerText: sourceText.slice(lineSpan.startOffset, lineSpan.endOffset),
        bodyText: sourceText.slice(lineSpan.endOffset, sectionEndOffset),
        records: bodyLineSpans.map((bodyLineSpan) =>
          createPadsAsciiRecord({
            rawText: sourceText.slice(
              bodyLineSpan.startOffset,
              bodyLineSpan.endOffset,
            ),
            section: lineSpan.sectionName ?? "unknown",
            span: {
              startOffset: bodyLineSpan.startOffset,
              endOffset: bodyLineSpan.endOffset,
            },
            line: bodyLineSpan.line,
          }),
        ),
        provenance: {
          format: "ascii",
          sourceId: `ascii:${lineSpan.sectionName}:${occurrence}`,
          section: lineSpan.sectionName,
          span: {
            startOffset: lineSpan.startOffset,
            endOffset: sectionEndOffset,
            startLine: lineSpan.line,
            endLine: bodyLineSpans.at(-1)?.line ?? lineSpan.line,
          },
        },
      }),
    )
  }

  const diagnostics: PadsDiagnostic[] = []
  const documentSource = createPadsAsciiDocumentSourceProvenance(sourceText)
  const endSectionIndices = sections.flatMap((section, index) =>
    section.name === "END" ? [index] : [],
  )
  if (endSectionIndices.length === 0) {
    diagnostics.push({
      code: "ascii-missing-end",
      severity: "warning",
      category: "validation",
      message: "PADS ASCII document does not contain an *END* terminator",
      source: documentSource,
    })
  } else if (
    endSectionIndices.length !== 1 ||
    endSectionIndices[0] !== sections.length - 1
  ) {
    diagnostics.push({
      code: "ascii-invalid-end-order",
      severity: "warning",
      category: "validation",
      message: "PADS ASCII *END* terminator is duplicated or is not last",
      source: documentSource,
    })
  }

  const recordsByKind: Record<string, number> = {}
  for (const section of sections) {
    for (const record of section.records) {
      recordsByKind[record.kind] = (recordsByKind[record.kind] ?? 0) + 1
    }
  }

  return new PadsAsciiDocument({
    preambleText: sourceText.slice(0, firstSection.startOffset),
    sections,
    version: versionHeader.version,
    units: versionHeader.units,
    diagnostics,
    coverage: {
      sectionCount: sections.length,
      knownSectionCount: sections.filter((section) =>
        isKnownPadsAsciiSectionName(section.name),
      ).length,
      unknownSectionCount: sections.filter(
        (section) => !isKnownPadsAsciiSectionName(section.name),
      ).length,
      recordCount: sections.reduce(
        (count, section) => count + section.records.length,
        0,
      ),
      recordsByKind,
    },
  })
}

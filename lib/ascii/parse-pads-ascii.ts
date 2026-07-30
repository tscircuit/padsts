import { PadsParseError } from "../parse-error"
import { PadsAsciiDocument, type PadsAsciiUnits } from "./pads-ascii-document"
import { createPadsAsciiSection } from "./pads-ascii-section"

interface LineSpan {
  startOffset: number
  endOffset: number
  sectionName?: string
}

const readLineSpans = (sourceText: string): LineSpan[] => {
  const lineSpans: LineSpan[] = []
  let startOffset = 0

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
    const contentText = lineText.replace(/(?:\r\n|\r|\n)$/u, "").trim()
    const isHeader =
      contentText.length >= 3 &&
      contentText.startsWith("*") &&
      contentText.endsWith("*")
    const innerText = isHeader ? contentText.slice(1, -1) : ""
    const sectionName =
      innerText.length > 0 && !/\s/u.test(innerText) ? innerText : undefined

    lineSpans.push({ startOffset, endOffset, sectionName })
    startOffset = endOffset
  }

  return lineSpans
}

const parseVersionHeader = (
  sectionName: string,
): { version: string; units: PadsAsciiUnits } | undefined => {
  const match = /^PADS-POWERPCB-(.+)-(BASIC|MILS|METRIC)$/u.exec(sectionName)
  if (!match) return undefined

  return {
    version: match[1] ?? "unknown",
    units: (match[2] as PadsAsciiUnits | undefined) ?? "unknown",
  }
}

export const isPadsAsciiText = (sourceText: string): boolean => {
  const beginningText = sourceText.slice(0, 512).trimStart()
  return beginningText.startsWith("*PADS-POWERPCB-")
}

export const parsePadsAscii = (sourceText: string): PadsAsciiDocument => {
  const lineSpans = readLineSpans(sourceText)
  const sectionLineSpans: LineSpan[] = []

  for (const lineSpan of lineSpans) {
    if (lineSpan.sectionName) sectionLineSpans.push(lineSpan)
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
  for (let index = 0; index < sectionLineSpans.length; index++) {
    const lineSpan = sectionLineSpans[index]
    if (!lineSpan?.sectionName) continue

    const nextLineSpan = sectionLineSpans[index + 1]
    const sectionEndOffset = nextLineSpan?.startOffset ?? sourceText.length
    sections.push(
      createPadsAsciiSection({
        name: lineSpan.sectionName,
        headerText: sourceText.slice(lineSpan.startOffset, lineSpan.endOffset),
        bodyText: sourceText.slice(lineSpan.endOffset, sectionEndOffset),
      }),
    )
  }

  return new PadsAsciiDocument({
    preambleText: sourceText.slice(0, firstSection.startOffset),
    sections,
    version: versionHeader.version,
    units: versionHeader.units,
  })
}

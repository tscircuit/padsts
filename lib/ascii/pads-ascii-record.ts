import type {
  PadsAsciiSourceProvenance,
  PadsSourceSpan,
} from "../source-provenance"

export type PadsAsciiRecordKind =
  | "blank"
  | "comment"
  | "remark"
  | "nested-header"
  | "data"

export interface PadsAsciiToken {
  value: string
  rawText: string
  quoted: boolean
  startColumn: number
  endColumn: number
}

export interface PadsAsciiRecordInit {
  kind: PadsAsciiRecordKind
  rawText: string
  contentText: string
  lineEnding: string
  tokens: PadsAsciiToken[]
  provenance: PadsAsciiSourceProvenance
  nestedHeaderName?: string
  changedContentText?: string
}

const escapeQuotedToken = (value: string): string =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`

export const tokenizePadsAsciiRecord = (
  contentText: string,
): PadsAsciiToken[] => {
  const tokens: PadsAsciiToken[] = []
  let column = 0

  while (column < contentText.length) {
    while (
      column < contentText.length &&
      /\s/u.test(contentText[column] ?? "")
    ) {
      column++
    }
    if (column >= contentText.length) break

    const startColumn = column
    if (contentText[column] === '"') {
      column++
      let value = ""
      while (column < contentText.length) {
        const character = contentText[column]
        if (character === "\\") {
          const escapedCharacter = contentText[column + 1]
          if (escapedCharacter !== undefined) {
            value += escapedCharacter
            column += 2
            continue
          }
        }
        if (character === '"') {
          column++
          break
        }
        value += character ?? ""
        column++
      }
      tokens.push({
        value,
        rawText: contentText.slice(startColumn, column),
        quoted: true,
        startColumn,
        endColumn: column,
      })
      continue
    }

    while (
      column < contentText.length &&
      !/\s/u.test(contentText[column] ?? "")
    ) {
      column++
    }
    const rawText = contentText.slice(startColumn, column)
    tokens.push({
      value: rawText,
      rawText,
      quoted: false,
      startColumn,
      endColumn: column,
    })
  }

  return tokens
}

const getLineParts = (
  rawText: string,
): { contentText: string; lineEnding: string } => {
  const lineEndingMatch = /(\r\n|\r|\n)$/u.exec(rawText)
  const lineEnding = lineEndingMatch?.[1] ?? ""
  return {
    contentText: rawText.slice(0, rawText.length - lineEnding.length),
    lineEnding,
  }
}

export const getPadsAsciiRecordKind = (
  contentText: string,
): {
  kind: PadsAsciiRecordKind
  nestedHeaderName?: string
} => {
  const trimmedText = contentText.trim()
  if (!trimmedText) return { kind: "blank" }
  if (
    trimmedText.startsWith("#") ||
    trimmedText.startsWith(";") ||
    trimmedText.startsWith("//")
  ) {
    return { kind: "comment" }
  }

  const headerMatch = /^\*([^*\s]+)\*/u.exec(trimmedText)
  if (headerMatch?.[1] === "REMARK") return { kind: "remark" }
  if (headerMatch?.[1]) {
    return { kind: "nested-header", nestedHeaderName: headerMatch[1] }
  }
  return { kind: "data" }
}

export class PadsAsciiRecord {
  readonly kind: PadsAsciiRecordKind
  readonly rawText: string
  readonly contentText: string
  readonly lineEnding: string
  readonly tokens: PadsAsciiToken[]
  readonly provenance: PadsAsciiSourceProvenance
  readonly nestedHeaderName?: string
  private readonly changedContentText?: string

  constructor(init: PadsAsciiRecordInit) {
    this.kind = init.kind
    this.rawText = init.rawText
    this.contentText = init.contentText
    this.lineEnding = init.lineEnding
    this.tokens = init.tokens
    this.provenance = init.provenance
    this.nestedHeaderName = init.nestedHeaderName
    this.changedContentText = init.changedContentText
  }

  getString(): string {
    return this.changedContentText === undefined
      ? this.rawText
      : `${this.changedContentText}${this.lineEnding}`
  }

  withContent(contentText: string): PadsAsciiRecord {
    const classification = getPadsAsciiRecordKind(contentText)
    return new PadsAsciiRecord({
      ...this,
      ...classification,
      contentText,
      tokens: tokenizePadsAsciiRecord(contentText),
      changedContentText: contentText,
    })
  }

  withTokens(values: string[]): PadsAsciiRecord {
    const contentText = values
      .map((value) =>
        value === "" || /\s|"/u.test(value) ? escapeQuotedToken(value) : value,
      )
      .join(" ")
    return this.withContent(contentText)
  }
}

export const createPadsAsciiRecord = ({
  rawText,
  section,
  span,
  line,
}: {
  rawText: string
  section: string
  span: PadsSourceSpan
  line: number
}): PadsAsciiRecord => {
  const { contentText, lineEnding } = getLineParts(rawText)
  const classification = getPadsAsciiRecordKind(contentText)
  return new PadsAsciiRecord({
    ...classification,
    rawText,
    contentText,
    lineEnding,
    tokens: tokenizePadsAsciiRecord(contentText),
    provenance: {
      format: "ascii",
      sourceId: `ascii:${section}:${line}`,
      section,
      span: { ...span, startLine: line, endLine: line },
    },
  })
}

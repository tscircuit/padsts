import type { PadsDocument } from "./parse-pads"

export interface PadsSourceSpan {
  startOffset: number
  endOffset: number
  startLine?: number
  endLine?: number
}

export interface PadsAsciiSourceProvenance {
  format: "ascii"
  sourceId: string
  section: string
  span: PadsSourceSpan
}

export interface PadsBinarySourceProvenance {
  format: "binary"
  sourceId: string
  sectionIndex: number
  recordIndex?: number
  span: PadsSourceSpan
}

export type PadsSourceProvenance =
  | PadsAsciiSourceProvenance
  | PadsBinarySourceProvenance

export const createPadsSourceId = (
  format: "ascii" | "binary",
  section: string | number,
  record: string | number,
): string => `${format}:${section}:${record}`

export const createPadsAsciiDocumentSourceProvenance = (
  sourceText: string,
): PadsAsciiSourceProvenance => ({
  format: "ascii",
  sourceId: "ascii:document",
  section: "DOCUMENT",
  span: {
    startOffset: 0,
    endOffset: sourceText.length,
    startLine: 1,
    endLine:
      sourceText.length === 0 ? 1 : sourceText.split(/\r\n|\r|\n/u).length,
  },
})

export const getPadsDocumentSourceProvenance = (
  document: PadsDocument,
): PadsSourceProvenance => {
  if (document.kind === "binary") {
    return {
      format: "binary",
      sourceId: "binary:container",
      sectionIndex: 0,
      span: {
        startOffset: 0,
        endOffset: document.getBytes().byteLength,
      },
    }
  }

  return createPadsAsciiDocumentSourceProvenance(document.getString())
}

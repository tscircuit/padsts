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

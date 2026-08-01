import type { PadsSourceProvenance } from "../source-provenance"
import type { PadsGeometryPoint } from "./pads-board-geometry"

export interface AsciiPartDecalTextTemplate {
  source?: PadsSourceProvenance
  content: string
  location: PadsGeometryPoint
  rotation: number
  layer: number
  height: number
  strokeWidth: number
  mirrored: boolean
  horizontalAlignment: "left" | "center" | "right"
  verticalAlignment: "top" | "center" | "bottom"
}

const parseFiniteNumber = (token: string | undefined): number | undefined => {
  if (token === undefined || token.trim() === "") return undefined
  const value = Number(token)
  return Number.isFinite(value) ? value : undefined
}

export const parseAsciiPartDecalTextTemplate = ({
  lineTokens,
  content,
  source,
}: {
  lineTokens: string[]
  content: string
  source?: PadsSourceProvenance
}): AsciiPartDecalTextTemplate | undefined => {
  const x = parseFiniteNumber(lineTokens[0])
  const y = parseFiniteNumber(lineTokens[1])
  const rotation = parseFiniteNumber(lineTokens[2])
  const layer = parseFiniteNumber(lineTokens[3])
  const height = parseFiniteNumber(lineTokens[4])
  const strokeWidth = parseFiniteNumber(lineTokens[5])
  if (
    x === undefined ||
    y === undefined ||
    rotation === undefined ||
    layer === undefined ||
    height === undefined ||
    strokeWidth === undefined
  ) {
    return undefined
  }

  return {
    source,
    content,
    location: { x, y },
    rotation,
    layer: Math.trunc(layer),
    height: Math.abs(height),
    strokeWidth: Math.abs(strokeWidth),
    mirrored: lineTokens[6] === "M",
    horizontalAlignment:
      lineTokens[7] === "LEFT"
        ? "left"
        : lineTokens[7] === "RIGHT"
          ? "right"
          : "center",
    verticalAlignment:
      lineTokens[8] === "UP"
        ? "bottom"
        : lineTokens[8] === "DOWN"
          ? "top"
          : "center",
  }
}

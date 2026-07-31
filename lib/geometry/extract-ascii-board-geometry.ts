import type { PadsAsciiDocument } from "../ascii"
import type {
  PadsBoardGeometry,
  PadsGeometryCircle,
  PadsGeometryCircleKind,
  PadsGeometryLayerInfo,
  PadsGeometryPath,
  PadsGeometryPathKind,
  PadsGeometryPlacement,
  PadsGeometryPoint,
  PadsGeometryText,
} from "./pads-board-geometry"

interface AsciiSectionLines {
  name: string
  lines: string[]
}

const TOP_LEVEL_SECTION_NAMES = new Set([
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

const tokenizeLine = (lineText: string): string[] =>
  lineText.trim().split(/\s+/u).filter(Boolean)

const parseFiniteNumber = (token: string | undefined): number | undefined => {
  if (token === undefined) return undefined
  const parsedNumber = Number(token)
  return Number.isFinite(parsedNumber) ? parsedNumber : undefined
}

const getHeaderToken = (lineText: string): string | undefined =>
  /^\*([^*\s]+)\*/u.exec(lineText.trim())?.[1]

const collectTopLevelSections = (sourceText: string): AsciiSectionLines[] => {
  const sections: AsciiSectionLines[] = []
  let currentSection: AsciiSectionLines | undefined

  for (const lineText of sourceText.split(/\r\n|\r|\n/u)) {
    const headerToken = getHeaderToken(lineText)
    if (headerToken && TOP_LEVEL_SECTION_NAMES.has(headerToken)) {
      currentSection = { name: headerToken, lines: [] }
      sections.push(currentSection)
      continue
    }

    currentSection?.lines.push(lineText)
  }

  return sections
}

const getPathKind = (objectType: string): PadsGeometryPathKind => {
  if (objectType === "BOARD") return "outline"
  if (objectType.includes("KEEP")) return "keepout"
  if (objectType.includes("COPPER")) return "copper"
  return "drawing"
}

const getCircleKind = (
  pathKind: PadsGeometryPathKind,
): PadsGeometryCircleKind =>
  pathKind === "route" || pathKind === "outline" ? "drawing" : pathKind

const isLineObjectHeader = (lineTokens: string[]): boolean =>
  lineTokens.length >= 5 &&
  parseFiniteNumber(lineTokens[1]) === undefined &&
  parseFiniteNumber(lineTokens[2]) !== undefined &&
  parseFiniteNumber(lineTokens[3]) !== undefined &&
  parseFiniteNumber(lineTokens[4]) !== undefined &&
  !lineTokens[0]?.startsWith("*")

const isPieceHeader = (lineTokens: string[]): boolean =>
  lineTokens.length >= 4 &&
  parseFiniteNumber(lineTokens[1]) !== undefined &&
  parseFiniteNumber(lineTokens[2]) !== undefined &&
  parseFiniteNumber(lineTokens[3]) !== undefined

const addLineSectionGeometry = ({
  section,
  paths,
  circles,
  diagnostics,
}: {
  section: AsciiSectionLines
  paths: PadsGeometryPath[]
  circles: PadsGeometryCircle[]
  diagnostics: string[]
}): void => {
  let lineIndex = 0
  let approximatedArcCount = 0

  while (lineIndex < section.lines.length) {
    const objectTokens = tokenizeLine(section.lines[lineIndex] ?? "")
    if (!isLineObjectHeader(objectTokens)) {
      lineIndex++
      continue
    }

    const objectName = objectTokens[0] ?? ""
    const objectType = objectTokens[1] ?? "LINES"
    const originX = parseFiniteNumber(objectTokens[2]) ?? 0
    const originY = parseFiniteNumber(objectTokens[3]) ?? 0
    const pieceCount = Math.max(
      0,
      Math.trunc(parseFiniteNumber(objectTokens[4]) ?? 0),
    )
    const pathKind = getPathKind(objectType)
    lineIndex++

    for (let pieceIndex = 0; pieceIndex < pieceCount; pieceIndex++) {
      let pieceTokens: string[] = []
      while (lineIndex < section.lines.length) {
        pieceTokens = tokenizeLine(section.lines[lineIndex] ?? "")
        if (isPieceHeader(pieceTokens)) break
        lineIndex++
      }

      if (!isPieceHeader(pieceTokens)) break

      const pieceKind = pieceTokens[0] ?? "OPEN"
      const cornerCount = Math.max(
        0,
        Math.trunc(parseFiniteNumber(pieceTokens[1]) ?? 0),
      )
      const width = Math.abs(parseFiniteNumber(pieceTokens[2]) ?? 0)
      const layer = parseFiniteNumber(pieceTokens[3])
      const points: PadsGeometryPoint[] = []
      lineIndex++

      while (lineIndex < section.lines.length && points.length < cornerCount) {
        const pointTokens = tokenizeLine(section.lines[lineIndex] ?? "")
        const relativeX = parseFiniteNumber(pointTokens[0])
        const relativeY = parseFiniteNumber(pointTokens[1])
        lineIndex++

        if (relativeX === undefined || relativeY === undefined) continue
        if (pointTokens.length > 2) approximatedArcCount++

        points.push({
          x: originX + relativeX,
          y: originY + relativeY,
        })
      }

      if (
        (pieceKind === "CIRCLE" || pieceKind === "KPTCIR") &&
        points.length >= 2
      ) {
        const firstPoint = points[0]
        const secondPoint = points[1]
        if (firstPoint && secondPoint) {
          circles.push({
            kind: getCircleKind(pathKind),
            center: {
              x: (firstPoint.x + secondPoint.x) / 2,
              y: (firstPoint.y + secondPoint.y) / 2,
            },
            radius:
              Math.hypot(
                secondPoint.x - firstPoint.x,
                secondPoint.y - firstPoint.y,
              ) / 2,
            width,
            layer,
            name: objectName,
          })
        }
        continue
      }

      if (points.length >= 2) {
        paths.push({
          kind: pathKind,
          points,
          closed: pieceKind === "CLOSED" || pieceKind.endsWith("CLS"),
          width,
          layer,
          name: objectName,
        })
      }
    }
  }

  if (approximatedArcCount > 0) {
    diagnostics.push(
      `${approximatedArcCount} ASCII line vertices include arc metadata rendered as straight segments`,
    )
  }
}

const addRouteSectionGeometry = ({
  section,
  paths,
  circles,
}: {
  section: AsciiSectionLines
  paths: PadsGeometryPath[]
  circles: PadsGeometryCircle[]
}): void => {
  let netName = ""
  let previousPoint:
    | (PadsGeometryPoint & { layer?: number; width: number })
    | undefined

  for (const lineText of section.lines) {
    const signalMatch = /^\*SIGNAL\*\s*(\S*)/u.exec(lineText.trim())
    if (signalMatch) {
      netName = signalMatch[1] ?? ""
      previousPoint = undefined
      continue
    }

    const lineTokens = tokenizeLine(lineText)
    if (lineTokens.length === 0 || lineTokens[0]?.startsWith("*REMARK")) {
      previousPoint = undefined
      continue
    }

    if (lineTokens[0] === "V") {
      const x = parseFiniteNumber(lineTokens[1])
      const y = parseFiniteNumber(lineTokens[2])
      if (x !== undefined && y !== undefined) {
        circles.push({
          kind: "via",
          center: { x, y },
          radius: 40,
          width: 10,
          name: lineTokens[3],
          netName,
        })
      }
      previousPoint = undefined
      continue
    }

    const x = parseFiniteNumber(lineTokens[0])
    const y = parseFiniteNumber(lineTokens[1])
    const rawLayer = parseFiniteNumber(lineTokens[2])
    const width = Math.abs(parseFiniteNumber(lineTokens[3]) ?? 0)
    if (x === undefined || y === undefined || rawLayer === undefined) {
      previousPoint = undefined
      continue
    }

    const layer =
      rawLayer === 65 ? (previousPoint?.layer ?? rawLayer) : rawLayer
    const currentPoint = { x, y, layer, width }
    if (previousPoint) {
      paths.push({
        kind: "route",
        points: [previousPoint, currentPoint],
        closed: false,
        width: width || previousPoint.width,
        layer,
        netName,
      })
    }

    const routeFlags = Math.trunc(parseFiniteNumber(lineTokens[4]) ?? 0)
    const hasViaName = lineTokens
      .slice(5)
      .some((token) => token.toUpperCase().includes("VIA"))
    if (hasViaName || (routeFlags & 0x100) !== 0) {
      circles.push({
        kind: "via",
        center: { x, y },
        radius: Math.max(width, 1),
        width: Math.max(width / 4, 1),
        layer,
        netName,
      })
    }

    previousPoint = currentPoint
  }
}

const addTextSectionGeometry = (
  section: AsciiSectionLines,
  texts: PadsGeometryText[],
): void => {
  for (let lineIndex = 0; lineIndex < section.lines.length; lineIndex++) {
    const lineTokens = tokenizeLine(section.lines[lineIndex] ?? "")
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
      continue
    }

    const content = section.lines[lineIndex + 2]?.trim()
    if (!content || content.startsWith("*")) continue

    texts.push({
      content,
      location: { x, y },
      height: Math.abs(height),
      strokeWidth: Math.abs(strokeWidth),
      rotation,
      mirrored: lineTokens[6] === "M",
      layer,
    })
    lineIndex += 2
  }
}

const addPartSectionGeometry = (
  section: AsciiSectionLines,
  placements: PadsGeometryPlacement[],
): void => {
  for (const lineText of section.lines) {
    const lineTokens = tokenizeLine(lineText)
    const x = parseFiniteNumber(lineTokens[2])
    const y = parseFiniteNumber(lineTokens[3])
    const rotation = parseFiniteNumber(lineTokens[4])
    if (
      lineTokens.length < 5 ||
      !lineTokens[0] ||
      !lineTokens[1] ||
      parseFiniteNumber(lineTokens[0]) !== undefined ||
      parseFiniteNumber(lineTokens[1]) !== undefined ||
      x === undefined ||
      y === undefined ||
      rotation === undefined
    ) {
      continue
    }

    placements.push({
      reference: lineTokens[0],
      footprintName: lineTokens[1],
      location: { x, y },
      rotation,
      bottomLayer: lineTokens[6] === "M",
    })
  }
}

const parseLayerInfo = (
  sections: AsciiSectionLines[],
): PadsGeometryLayerInfo[] => {
  const layers: PadsGeometryLayerInfo[] = []
  for (const section of sections) {
    if (section.name !== "LAYER") continue
    for (const lineText of section.lines) {
      const lineTokens = tokenizeLine(lineText)
      const layerNumber = parseFiniteNumber(lineTokens[0])
      if (layerNumber === undefined || !lineTokens[1]) continue
      layers.push({ number: layerNumber, name: lineTokens.slice(1).join(" ") })
    }
  }
  return layers
}

const parseLayerCount = (
  sections: AsciiSectionLines[],
  layers: PadsGeometryLayerInfo[],
): number => {
  for (const section of sections) {
    if (section.name !== "PCB") continue
    for (const lineText of section.lines) {
      const lineTokens = tokenizeLine(lineText)
      if (lineTokens[0] !== "MAXLAYER" && lineTokens[0] !== "MAXIMUMLAYER") {
        continue
      }
      const layerCount = parseFiniteNumber(lineTokens[1])
      if (layerCount !== undefined) return Math.trunc(layerCount)
    }
  }
  return layers.length || 2
}

export const extractAsciiBoardGeometry = (
  document: PadsAsciiDocument,
): PadsBoardGeometry => {
  const sections = collectTopLevelSections(document.getString())
  const paths: PadsGeometryPath[] = []
  const circles: PadsGeometryCircle[] = []
  const texts: PadsGeometryText[] = []
  const placements: PadsGeometryPlacement[] = []
  const diagnostics: string[] = []

  for (const section of sections) {
    if (section.name === "LINES") {
      addLineSectionGeometry({ section, paths, circles, diagnostics })
    } else if (section.name === "ROUTE") {
      addRouteSectionGeometry({ section, paths, circles })
    } else if (section.name === "TEXT") {
      addTextSectionGeometry(section, texts)
    } else if (section.name === "PART") {
      addPartSectionGeometry(section, placements)
    }
  }

  const layers = parseLayerInfo(sections)
  return {
    sourceFormat: "ascii",
    version: document.version,
    layerCount: parseLayerCount(sections, layers),
    layers,
    paths,
    circles,
    texts,
    placements,
    unassignedVertices: [],
    binarySections: [],
    diagnostics,
  }
}

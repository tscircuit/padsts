import type { PadsAsciiDocument } from "../ascii"
import type {
  PadsBoardGeometry,
  PadsGeometryCircle,
  PadsGeometryCircleKind,
  PadsGeometryLayerInfo,
  PadsGeometryPath,
  PadsGeometryPathKind,
  PadsGeometryPathSegment,
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

const pointsAreEqual = (
  firstPoint: PadsGeometryPoint,
  secondPoint: PadsGeometryPoint,
): boolean =>
  Math.abs(firstPoint.x - secondPoint.x) < 1e-6 &&
  Math.abs(firstPoint.y - secondPoint.y) < 1e-6

const addLineSegment = ({
  segments,
  start,
  end,
}: {
  segments: PadsGeometryPathSegment[]
  start: PadsGeometryPoint | undefined
  end: PadsGeometryPoint
}): void => {
  if (!start || pointsAreEqual(start, end)) return
  segments.push({ kind: "line", start, end })
}

const parseArcVertex = ({
  pointTokens,
  originX,
  originY,
}: {
  pointTokens: string[]
  originX: number
  originY: number
}): Extract<PadsGeometryPathSegment, { kind: "arc" }> | undefined => {
  if (pointTokens.length < 8) return undefined

  const startAngleTenths = parseFiniteNumber(pointTokens[2])
  const deltaAngleTenths = parseFiniteNumber(pointTokens[3])
  const boundingMinimumX = parseFiniteNumber(pointTokens[4])
  const boundingMinimumY = parseFiniteNumber(pointTokens[5])
  const boundingMaximumX = parseFiniteNumber(pointTokens[6])
  const boundingMaximumY = parseFiniteNumber(pointTokens[7])
  if (
    startAngleTenths === undefined ||
    deltaAngleTenths === undefined ||
    boundingMinimumX === undefined ||
    boundingMinimumY === undefined ||
    boundingMaximumX === undefined ||
    boundingMaximumY === undefined
  ) {
    return undefined
  }

  const center = {
    x: originX + (boundingMinimumX + boundingMaximumX) / 2,
    y: originY + (boundingMinimumY + boundingMaximumY) / 2,
  }
  const radiusX = Math.abs(boundingMaximumX - boundingMinimumX) / 2
  const radiusY = Math.abs(boundingMaximumY - boundingMinimumY) / 2
  const radiusTolerance = Math.max(1, radiusX * 1e-6)
  if (Math.abs(radiusX - radiusY) > radiusTolerance) return undefined

  const radius = radiusX
  const startAngle = startAngleTenths / 10
  const deltaAngle = deltaAngleTenths / 10
  if (
    !Number.isFinite(radius) ||
    radius <= 0 ||
    !Number.isFinite(startAngle) ||
    !Number.isFinite(deltaAngle) ||
    deltaAngle === 0 ||
    Math.abs(deltaAngle) > 360
  ) {
    return undefined
  }

  const startAngleRadians = (startAngle * Math.PI) / 180
  const endAngleRadians = ((startAngle + deltaAngle) * Math.PI) / 180
  return {
    kind: "arc",
    start: {
      x: center.x + radius * Math.cos(startAngleRadians),
      y: center.y + radius * Math.sin(startAngleRadians),
    },
    end: {
      x: center.x + radius * Math.cos(endAngleRadians),
      y: center.y + radius * Math.sin(endAngleRadians),
    },
    center,
    radius,
    startAngle,
    deltaAngle,
  }
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
  let malformedArcCount = 0

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
      const segments: PadsGeometryPathSegment[] = []
      let currentPoint: PadsGeometryPoint | undefined
      lineIndex++

      let parsedCornerCount = 0
      while (
        lineIndex < section.lines.length &&
        parsedCornerCount < cornerCount
      ) {
        const pointTokens = tokenizeLine(section.lines[lineIndex] ?? "")
        const relativeX = parseFiniteNumber(pointTokens[0])
        const relativeY = parseFiniteNumber(pointTokens[1])
        lineIndex++

        if (relativeX === undefined || relativeY === undefined) continue
        parsedCornerCount++

        const arcSegment = parseArcVertex({
          pointTokens,
          originX,
          originY,
        })
        if (arcSegment) {
          addLineSegment({
            segments,
            start: currentPoint,
            end: arcSegment.start,
          })
          if (
            points.length === 0 ||
            !pointsAreEqual(points.at(-1) ?? arcSegment.start, arcSegment.start)
          ) {
            points.push(arcSegment.start)
          }
          points.push(arcSegment.end)
          segments.push(arcSegment)
          currentPoint = arcSegment.end
          continue
        }
        if (pointTokens.length >= 8) malformedArcCount++

        const point = {
          x: originX + relativeX,
          y: originY + relativeY,
        }
        addLineSegment({ segments, start: currentPoint, end: point })
        points.push(point)
        currentPoint = point
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
        const closed = pieceKind === "CLOSED" || pieceKind.endsWith("CLS")
        if (closed) {
          const firstPoint = points[0]
          if (firstPoint) {
            addLineSegment({
              segments,
              start: currentPoint,
              end: firstPoint,
            })
          }
        }
        paths.push({
          kind: pathKind,
          points,
          segments,
          closed,
          width,
          layer,
          name: objectName,
        })
      }
    }
  }

  if (malformedArcCount > 0) {
    diagnostics.push(
      `${malformedArcCount} ASCII line arc records could not be decoded`,
    )
  }
}

const addRouteSectionGeometry = ({
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
  let netName = ""
  let skippedUnroutedSegmentCount = 0
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
      if ((previousPoint.layer ?? 0) > 0 && layer > 0 && rawLayer !== 0) {
        paths.push({
          kind: "route",
          points: [previousPoint, currentPoint],
          closed: false,
          width: width || previousPoint.width,
          layer,
          netName,
        })
      } else {
        skippedUnroutedSegmentCount++
      }
    }

    const hasViaName = lineTokens
      .slice(5)
      .some((token) => token.toUpperCase().includes("VIA"))
    if (hasViaName) {
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

  if (skippedUnroutedSegmentCount > 0) {
    diagnostics.push(
      `${skippedUnroutedSegmentCount} unrouted ASCII connections omitted from fabrication geometry`,
    )
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
      !["G", "U"].includes(lineTokens[5] ?? "") ||
      !["M", "N"].includes(lineTokens[6] ?? "") ||
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
      addRouteSectionGeometry({ section, paths, circles, diagnostics })
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
    unverifiedConnections: [],
    unverifiedViaLocations: [],
    binarySections: [],
    diagnostics,
  }
}

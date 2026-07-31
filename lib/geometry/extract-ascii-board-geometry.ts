import type { PadsAsciiDocument } from "../ascii"
import type {
  PadsBoardGeometry,
  PadsGeometryCircle,
  PadsGeometryCircleKind,
  PadsGeometryHole,
  PadsGeometryLayerInfo,
  PadsGeometryPad,
  PadsGeometryPath,
  PadsGeometryPathKind,
  PadsGeometryPathSegment,
  PadsGeometryPlacement,
  PadsGeometryPoint,
  PadsGeometryText,
  PadsGeometryViaPad,
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
  if (
    objectType.includes("KEEP") ||
    objectType === "RESTRICTVIA" ||
    objectType === "RESTRICTROUTE" ||
    objectType === "RESTRICTAREA"
  ) {
    return "keepout"
  }
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

interface AsciiViaDefinition {
  name: string
  drillRadius: number
  pads: AsciiViaPadDefinition[]
  startLayer?: number
  endLayer?: number
}

interface AsciiViaPadDefinition {
  sourceLevel: number
  radius: number
  shape?: "circle" | "square"
  shapeCode: string
  kind: "conductive" | "negative" | "unsupported"
}

const parseViaDefinitions = ({
  sections,
  diagnostics,
}: {
  sections: AsciiSectionLines[]
  diagnostics: string[]
}): Map<string, AsciiViaDefinition> => {
  const definitions = new Map<string, AsciiViaDefinition>()
  let malformedDefinitionCount = 0
  let unsupportedPadShapeCount = 0

  for (const section of sections) {
    if (section.name !== "VIA") continue

    let lineIndex = 0
    while (lineIndex < section.lines.length) {
      const headerTokens = tokenizeLine(section.lines[lineIndex] ?? "")
      const name = headerTokens[0]
      const drillDiameter = parseFiniteNumber(headerTokens[1])
      const stackLineCount = parseFiniteNumber(headerTokens[2])
      if (
        !name ||
        name.startsWith("*") ||
        drillDiameter === undefined ||
        drillDiameter <= 0 ||
        stackLineCount === undefined ||
        stackLineCount < 1
      ) {
        lineIndex++
        continue
      }

      const normalizedStackLineCount = Math.trunc(stackLineCount)
      const startLayer = parseFiniteNumber(headerTokens[3])
      const endLayer = parseFiniteNumber(headerTokens[4])
      const pads: AsciiViaPadDefinition[] = []
      lineIndex++

      let parsedStackLineCount = 0
      while (
        lineIndex < section.lines.length &&
        parsedStackLineCount < normalizedStackLineCount
      ) {
        const stackTokens = tokenizeLine(section.lines[lineIndex] ?? "")
        lineIndex++
        if (stackTokens.length === 0 || stackTokens[0]?.startsWith("*REMARK")) {
          continue
        }
        parsedStackLineCount++

        const sourceLevel = parseFiniteNumber(stackTokens[0])
        const diameter = parseFiniteNumber(stackTokens[1])
        const shapeCode = stackTokens[2]?.toUpperCase()
        if (
          sourceLevel === undefined ||
          diameter === undefined ||
          diameter <= 0 ||
          !shapeCode
        ) {
          continue
        }
        pads.push({
          sourceLevel: Math.trunc(sourceLevel),
          radius: diameter / 2,
          shape:
            shapeCode === "R"
              ? "circle"
              : shapeCode === "S"
                ? "square"
                : undefined,
          shapeCode,
          kind:
            shapeCode === "R" || shapeCode === "S"
              ? "conductive"
              : shapeCode === "RA" || shapeCode === "SA"
                ? "negative"
                : "unsupported",
        })
      }

      if (parsedStackLineCount !== normalizedStackLineCount) {
        malformedDefinitionCount++
        continue
      }
      if (!pads.some((pad) => pad.kind === "conductive")) {
        unsupportedPadShapeCount++
      }

      definitions.set(name, {
        name,
        drillRadius: drillDiameter / 2,
        pads,
        ...(startLayer !== undefined && endLayer !== undefined
          ? {
              startLayer: Math.trunc(startLayer),
              endLayer: Math.trunc(endLayer),
            }
          : {}),
      })
    }
  }

  if (malformedDefinitionCount > 0) {
    diagnostics.push(
      `${malformedDefinitionCount} ASCII via definitions ended before all pad-stack records were parsed`,
    )
  }
  if (unsupportedPadShapeCount > 0) {
    diagnostics.push(
      `${unsupportedPadShapeCount} ASCII via definitions have no supported round or square copper pad`,
    )
  }
  return definitions
}

const resolveViaPadStack = ({
  definition,
  requestedStartLayer,
  requestedEndLayer,
  layerCount,
}: {
  definition: AsciiViaDefinition
  requestedStartLayer?: number
  requestedEndLayer?: number
  layerCount: number
}): {
  startLayer: number
  endLayer: number
  copperPads: PadsGeometryViaPad[]
  unsupportedShapeCodes: string[]
} => {
  const rawStartLayer = requestedStartLayer ?? definition.startLayer ?? 1
  const rawEndLayer = requestedEndLayer ?? definition.endLayer ?? layerCount
  const startLayer = Math.max(
    1,
    Math.min(
      layerCount,
      Math.min(Math.trunc(rawStartLayer), Math.trunc(rawEndLayer)),
    ),
  )
  const endLayer = Math.max(
    1,
    Math.min(
      layerCount,
      Math.max(Math.trunc(rawStartLayer), Math.trunc(rawEndLayer)),
    ),
  )
  const padBySpecificLayer = new Map<number, AsciiViaPadDefinition>()
  let topPad: AsciiViaPadDefinition | undefined
  let innerPad: AsciiViaPadDefinition | undefined
  let bottomPad: AsciiViaPadDefinition | undefined
  for (const pad of definition.pads) {
    if (pad.sourceLevel === -2) topPad = pad
    else if (pad.sourceLevel === -1) innerPad = pad
    else if (pad.sourceLevel === 0) bottomPad = pad
    else if (pad.sourceLevel > 0) {
      padBySpecificLayer.set(pad.sourceLevel, pad)
    }
  }

  const copperPads: PadsGeometryViaPad[] = []
  const unsupportedShapeCodes: string[] = []
  for (let layer = startLayer; layer <= endLayer; layer++) {
    const genericPad =
      startLayer === endLayer
        ? (topPad ?? bottomPad ?? innerPad)
        : layer === startLayer
          ? topPad
          : layer === endLayer
            ? bottomPad
            : innerPad
    const pad = padBySpecificLayer.get(layer) ?? genericPad
    if (!pad) continue
    if (pad.kind === "unsupported") {
      unsupportedShapeCodes.push(pad.shapeCode)
      continue
    }
    if (pad.kind === "negative" || !pad.shape) continue
    copperPads.push({
      layer,
      radius: pad.radius,
      shape: pad.shape,
    })
  }

  return { startLayer, endLayer, copperPads, unsupportedShapeCodes }
}

const addRouteSectionGeometry = ({
  section,
  layerCount,
  viaDefinitions,
  paths,
  circles,
  unverifiedViaLocations,
  diagnostics,
}: {
  section: AsciiSectionLines
  layerCount: number
  viaDefinitions: Map<string, AsciiViaDefinition>
  paths: PadsGeometryPath[]
  circles: PadsGeometryCircle[]
  unverifiedViaLocations: PadsGeometryPoint[]
  diagnostics: string[]
}): void => {
  type RoutePoint = PadsGeometryPoint & { layer: number; width: number }
  type PendingRouteArc = {
    center: PadsGeometryPoint
    direction: "CW" | "CCW"
    layer: number
    rawLayer: number
    width: number
  }

  let netName = ""
  let skippedUnroutedSegmentCount = 0
  let skippedNonCopperSegmentCount = 0
  let malformedArcCount = 0
  const unresolvedViaDefinitionCounts = new Map<string, number>()
  const unresolvedViaPadCounts = new Map<string, number>()
  const unsupportedViaPadShapeCounts = new Map<string, number>()
  let previousPoint: RoutePoint | undefined
  let pendingArc: PendingRouteArc | undefined

  const addVia = ({
    location,
    name,
    startLayer,
    endLayer,
  }: {
    location: PadsGeometryPoint
    name: string
    startLayer?: number
    endLayer?: number
  }): void => {
    const definition = viaDefinitions.get(name)
    if (!definition) {
      unverifiedViaLocations.push(location)
      unresolvedViaDefinitionCounts.set(
        name,
        (unresolvedViaDefinitionCounts.get(name) ?? 0) + 1,
      )
      return
    }

    const resolvedPadStack = resolveViaPadStack({
      definition,
      requestedStartLayer: startLayer,
      requestedEndLayer: endLayer,
      layerCount,
    })
    for (const shapeCode of resolvedPadStack.unsupportedShapeCodes) {
      unsupportedViaPadShapeCounts.set(
        shapeCode,
        (unsupportedViaPadShapeCounts.get(shapeCode) ?? 0) + 1,
      )
    }
    const largestPad = resolvedPadStack.copperPads.reduce<
      PadsGeometryViaPad | undefined
    >(
      (largestCandidate, candidate) =>
        !largestCandidate || candidate.radius > largestCandidate.radius
          ? candidate
          : largestCandidate,
      undefined,
    )
    if (!largestPad) {
      unverifiedViaLocations.push(location)
      unresolvedViaPadCounts.set(
        name,
        (unresolvedViaPadCounts.get(name) ?? 0) + 1,
      )
      return
    }
    const startPad =
      resolvedPadStack.copperPads.find(
        (pad) => pad.layer === resolvedPadStack.startLayer,
      ) ?? largestPad
    circles.push({
      kind: "via",
      center: location,
      radius: largestPad.radius,
      drillRadius: definition.drillRadius,
      shape: startPad.shape,
      copperPads: resolvedPadStack.copperPads,
      startLayer: resolvedPadStack.startLayer,
      endLayer: resolvedPadStack.endLayer,
      width: Math.max(largestPad.radius - definition.drillRadius, 0),
      layer: resolvedPadStack.startLayer,
      name,
      netName,
    })
  }

  const resetRouteState = (): void => {
    if (pendingArc) malformedArcCount++
    previousPoint = undefined
    pendingArc = undefined
  }

  const getArcSegment = ({
    start,
    end,
    pending,
  }: {
    start: PadsGeometryPoint
    end: PadsGeometryPoint
    pending: PendingRouteArc
  }): Extract<PadsGeometryPathSegment, { kind: "arc" }> | undefined => {
    const startRadius = Math.hypot(
      start.x - pending.center.x,
      start.y - pending.center.y,
    )
    const endRadius = Math.hypot(
      end.x - pending.center.x,
      end.y - pending.center.y,
    )
    const radiusTolerance = Math.max(
      1e-6,
      Math.max(startRadius, endRadius) * 1e-6,
    )
    if (
      startRadius <= radiusTolerance ||
      Math.abs(startRadius - endRadius) > radiusTolerance
    ) {
      return undefined
    }

    const startAngle =
      (Math.atan2(start.y - pending.center.y, start.x - pending.center.x) *
        180) /
      Math.PI
    const endAngle =
      (Math.atan2(end.y - pending.center.y, end.x - pending.center.x) * 180) /
      Math.PI
    let deltaAngle = endAngle - startAngle
    if (pending.direction === "CCW") {
      while (deltaAngle <= 0) deltaAngle += 360
    } else {
      while (deltaAngle >= 0) deltaAngle -= 360
    }

    return {
      kind: "arc",
      start,
      end,
      center: pending.center,
      radius: startRadius,
      startAngle,
      deltaAngle,
    }
  }

  const layerIsCopper = (layer: number): boolean =>
    layer >= 1 && layer <= layerCount

  for (const lineText of section.lines) {
    const signalMatch = /^\*SIGNAL\*\s*(\S*)/u.exec(lineText.trim())
    if (signalMatch) {
      netName = signalMatch[1] ?? ""
      resetRouteState()
      continue
    }

    const lineTokens = tokenizeLine(lineText)
    if (lineTokens.length === 0 || lineTokens[0]?.startsWith("*REMARK")) {
      resetRouteState()
      continue
    }

    if (lineTokens[0] === "V") {
      const x = parseFiniteNumber(lineTokens[1])
      const y = parseFiniteNumber(lineTokens[2])
      const name = lineTokens[3]
      if (x !== undefined && y !== undefined && name) {
        addVia({
          location: { x, y },
          name,
          startLayer: parseFiniteNumber(lineTokens[4]),
          endLayer: parseFiniteNumber(lineTokens[5]),
        })
      }
      resetRouteState()
      continue
    }

    const x = parseFiniteNumber(lineTokens[0])
    const y = parseFiniteNumber(lineTokens[1])
    const rawLayer = parseFiniteNumber(lineTokens[2])
    const width = Math.abs(parseFiniteNumber(lineTokens[3]) ?? 0)
    if (x === undefined || y === undefined || rawLayer === undefined) {
      resetRouteState()
      continue
    }

    const layer =
      rawLayer === 65 ? (previousPoint?.layer ?? rawLayer) : rawLayer
    const currentPoint = { x, y, layer, width }
    const arcDirection = lineTokens
      .slice(5)
      .find((token): token is "CW" | "CCW" => token === "CW" || token === "CCW")
    if (arcDirection) {
      if (!previousPoint || pendingArc) {
        malformedArcCount++
        pendingArc = undefined
      } else {
        pendingArc = {
          center: { x, y },
          direction: arcDirection,
          layer,
          rawLayer,
          width,
        }
      }
      continue
    }

    if (previousPoint) {
      const segmentLayer = pendingArc?.layer ?? layer
      const segmentRawLayer = pendingArc?.rawLayer ?? rawLayer
      if (
        previousPoint.layer === 0 ||
        segmentLayer === 0 ||
        layer === 0 ||
        segmentRawLayer === 0 ||
        rawLayer === 0
      ) {
        skippedUnroutedSegmentCount++
      } else if (
        !layerIsCopper(previousPoint.layer) ||
        !layerIsCopper(segmentLayer) ||
        !layerIsCopper(layer)
      ) {
        skippedNonCopperSegmentCount++
      } else {
        const arcSegment = pendingArc
          ? getArcSegment({
              start: previousPoint,
              end: currentPoint,
              pending: pendingArc,
            })
          : undefined
        if (pendingArc && !arcSegment) {
          malformedArcCount++
        } else {
          paths.push({
            kind: "route",
            points: [previousPoint, currentPoint],
            ...(arcSegment ? { segments: [arcSegment] } : {}),
            closed: false,
            width: width || pendingArc?.width || previousPoint.width,
            layer: segmentLayer,
            netName,
          })
        }
      }
    }
    pendingArc = undefined

    const viaName =
      lineTokens.slice(5).find((token) => viaDefinitions.has(token)) ??
      lineTokens.slice(5).find((token) => token.toUpperCase().includes("VIA"))
    if (viaName) {
      addVia({
        location: { x, y },
        name: viaName,
      })
    }

    previousPoint = currentPoint
  }

  if (pendingArc) malformedArcCount++

  if (skippedUnroutedSegmentCount > 0) {
    diagnostics.push(
      `${skippedUnroutedSegmentCount} unrouted ASCII connections omitted from fabrication geometry`,
    )
  }
  if (skippedNonCopperSegmentCount > 0) {
    diagnostics.push(
      `${skippedNonCopperSegmentCount} ASCII route segments on non-copper layers omitted from fabrication geometry`,
    )
  }
  if (malformedArcCount > 0) {
    diagnostics.push(
      `${malformedArcCount} ASCII route arc records could not be decoded`,
    )
  }
  if (unresolvedViaDefinitionCounts.size > 0) {
    const unresolvedViaCount = [
      ...unresolvedViaDefinitionCounts.values(),
    ].reduce((totalCount, definitionCount) => totalCount + definitionCount, 0)
    diagnostics.push(
      `${unresolvedViaCount} ASCII via instances reference missing pad-stack definitions (${[...unresolvedViaDefinitionCounts.keys()].sort().join(", ")})`,
    )
  }
  if (unresolvedViaPadCounts.size > 0) {
    const unresolvedViaCount = [...unresolvedViaPadCounts.values()].reduce(
      (totalCount, definitionCount) => totalCount + definitionCount,
      0,
    )
    diagnostics.push(
      `${unresolvedViaCount} ASCII via instances have no supported copper pads on their layer span (${[...unresolvedViaPadCounts.keys()].sort().join(", ")})`,
    )
  }
  if (unsupportedViaPadShapeCounts.size > 0) {
    const unsupportedPadCount = [
      ...unsupportedViaPadShapeCounts.values(),
    ].reduce((totalCount, shapeCount) => totalCount + shapeCount, 0)
    diagnostics.push(
      `${unsupportedPadCount} ASCII via layer pads use unsupported conductive shapes (${[...unsupportedViaPadShapeCounts.keys()].sort().join(", ")})`,
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

interface AsciiPartDecalTerminal {
  location: PadsGeometryPoint
  pinNumber: string
}

interface AsciiPartDecalPadLayer {
  sourceLevel: number
  size: number
  shapeCode: string
  orientation: number
  length: number
  offset: number
  cornerRadius: number
  chamfered: boolean
  drillDiameter: number
  plated: boolean
  slotOrientation: number
  slotLength: number
  slotOffset: number
  hasUnsupportedTrailingGeometry: boolean
}

interface AsciiPartDecalPadStack {
  pinNumber: string
  layers: AsciiPartDecalPadLayer[]
}

interface AsciiPartDecalDefinition {
  name: string
  terminals: AsciiPartDecalTerminal[]
  padStacks: Map<string, AsciiPartDecalPadStack>
  paths: PadsGeometryPath[]
  circles: PadsGeometryCircle[]
}

const isPartDecalHeader = (lineTokens: string[]): boolean =>
  lineTokens.length >= 9 &&
  ["I", "M", "MM"].includes(lineTokens[1] ?? "") &&
  lineTokens
    .slice(2, 9)
    .every((token) => parseFiniteNumber(token) !== undefined)

const PART_DECAL_PIECE_KINDS = new Set([
  "OPEN",
  "CLOSED",
  "CIRCLE",
  "COPCLS",
  "COPOPN",
  "COPCIR",
  "COPCUT",
  "COPCCO",
  "KPTCLS",
  "KPTCIR",
  "TAG",
])

const SUPPORTED_PART_DECAL_DRAWING_KINDS = new Set(["OPEN", "CLOSED", "CIRCLE"])

const parsePartDecalPadLayer = ({
  lineTokens,
  usesCornerRadiusFields,
}: {
  lineTokens: string[]
  usesCornerRadiusFields: boolean
}): AsciiPartDecalPadLayer | undefined => {
  const sourceLevel = parseFiniteNumber(lineTokens[0])
  const size = parseFiniteNumber(lineTokens[1])
  const shapeCode = lineTokens[2]?.toUpperCase()
  if (sourceLevel === undefined || size === undefined || !shapeCode) {
    return undefined
  }

  const fingerShape = shapeCode === "RF" || shapeCode === "OF"
  const orientation = fingerShape ? (parseFiniteNumber(lineTokens[3]) ?? 0) : 0
  const length = fingerShape
    ? Math.abs(parseFiniteNumber(lineTokens[4]) ?? size)
    : Math.abs(size)
  const offset = fingerShape ? (parseFiniteNumber(lineTokens[5]) ?? 0) : 0
  let trailingValueIndex = fingerShape ? 6 : 3
  let cornerRadius = 0
  let chamfered = false

  if ((shapeCode === "S" || shapeCode === "RF") && usesCornerRadiusFields) {
    const corner = parseFiniteNumber(lineTokens[trailingValueIndex]) ?? 0
    cornerRadius = Math.abs(corner)
    chamfered = corner < 0
    trailingValueIndex++
  } else if (shapeCode === "A") {
    // Annular pads carry an inner-diameter field before their drill.
    trailingValueIndex++
  } else if (shapeCode === "RT" || shapeCode === "ST") {
    // Thermal orientation, inner diameter, spoke width, and spoke count.
    trailingValueIndex = 7
  }

  const parsedDrillDiameter = parseFiniteNumber(lineTokens[trailingValueIndex])
  const drillDiameter =
    parsedDrillDiameter === undefined ? 0 : Math.abs(parsedDrillDiameter)
  if (parsedDrillDiameter !== undefined) trailingValueIndex++

  let plated = true
  const platedToken = lineTokens[trailingValueIndex]?.toUpperCase()
  if (platedToken === "N" || platedToken === "P" || platedToken === "Y") {
    plated = platedToken !== "N"
    trailingValueIndex++
  }

  let slotOrientation = 0
  let slotLength = 0
  let slotOffset = 0
  const parsedSlotOrientation = parseFiniteNumber(
    lineTokens[trailingValueIndex],
  )
  const parsedSlotLength = parseFiniteNumber(lineTokens[trailingValueIndex + 1])
  const parsedSlotOffset = parseFiniteNumber(lineTokens[trailingValueIndex + 2])
  if (
    parsedSlotOrientation !== undefined &&
    parsedSlotLength !== undefined &&
    parsedSlotOffset !== undefined
  ) {
    slotOrientation = parsedSlotOrientation
    slotLength = Math.abs(parsedSlotLength)
    slotOffset = parsedSlotOffset
    trailingValueIndex += 3
  }
  const hasUnsupportedTrailingGeometry = trailingValueIndex < lineTokens.length

  return {
    sourceLevel: Math.trunc(sourceLevel),
    size: Math.abs(size),
    shapeCode,
    orientation,
    length,
    offset,
    cornerRadius,
    chamfered,
    drillDiameter,
    plated,
    slotOrientation,
    slotLength,
    slotOffset,
    hasUnsupportedTrailingGeometry,
  }
}

const parsePartDecalDefinitions = ({
  sections,
  version,
  diagnostics,
}: {
  sections: AsciiSectionLines[]
  version: string
  diagnostics: string[]
}): Map<string, AsciiPartDecalDefinition> => {
  const definitions = new Map<string, AsciiPartDecalDefinition>()
  let malformedPadStackCount = 0
  let malformedPieceArcCount = 0
  let unsupportedPieceCount = 0
  const versionNumber = Number(/^V(\d+)/u.exec(version)?.[1])

  for (const section of sections) {
    if (section.name !== "PARTDECAL") continue
    const usesCornerRadiusFields =
      section.lines.some((lineText) => lineText.includes("[CORNERRADIUS]")) ||
      (Number.isFinite(versionNumber) &&
        versionNumber >= 9 &&
        versionNumber < 2000)
    const usesPieceLineStyleField = section.lines.some(
      (lineText) =>
        lineText.includes("PIECETYPE") && lineText.includes("LINESTYLE"),
    )

    let currentDefinition: AsciiPartDecalDefinition | undefined
    let remainingPieceCount = 0
    let lineIndex = 0
    while (lineIndex < section.lines.length) {
      const lineTokens = tokenizeLine(section.lines[lineIndex] ?? "")
      if (isPartDecalHeader(lineTokens)) {
        const name = lineTokens[0]
        if (name) {
          currentDefinition = {
            name,
            terminals: [],
            padStacks: new Map(),
            paths: [],
            circles: [],
          }
          definitions.set(name, currentDefinition)
          remainingPieceCount = Math.max(
            0,
            Math.trunc(parseFiniteNumber(lineTokens[4]) ?? 0),
          )
        }
        lineIndex++
        continue
      }
      if (!currentDefinition) {
        lineIndex++
        continue
      }

      const pieceKind = lineTokens[0]?.toUpperCase()
      if (
        remainingPieceCount > 0 &&
        pieceKind &&
        PART_DECAL_PIECE_KINDS.has(pieceKind)
      ) {
        const cornerCount = Math.max(
          0,
          Math.trunc(parseFiniteNumber(lineTokens[1]) ?? 0),
        )
        const width = Math.abs(parseFiniteNumber(lineTokens[2]) ?? 0)
        const layer = parseFiniteNumber(
          lineTokens[usesPieceLineStyleField ? 4 : 3],
        )
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
          const x = parseFiniteNumber(pointTokens[0])
          const y = parseFiniteNumber(pointTokens[1])
          lineIndex++
          if (x === undefined || y === undefined) continue
          parsedCornerCount++

          const arcSegment = parseArcVertex({
            pointTokens,
            originX: 0,
            originY: 0,
          })
          if (arcSegment) {
            addLineSegment({
              segments,
              start: currentPoint,
              end: arcSegment.start,
            })
            if (
              points.length === 0 ||
              !pointsAreEqual(
                points.at(-1) ?? arcSegment.start,
                arcSegment.start,
              )
            ) {
              points.push(arcSegment.start)
            }
            points.push(arcSegment.end)
            segments.push(arcSegment)
            currentPoint = arcSegment.end
            continue
          }
          if (pointTokens.length >= 8) malformedPieceArcCount++

          const point = { x, y }
          addLineSegment({ segments, start: currentPoint, end: point })
          points.push(point)
          currentPoint = point
        }

        remainingPieceCount--
        if (!SUPPORTED_PART_DECAL_DRAWING_KINDS.has(pieceKind)) {
          unsupportedPieceCount++
          continue
        }
        if (pieceKind === "CIRCLE" && points.length >= 2) {
          const firstPoint = points[0]
          const secondPoint = points[1]
          if (firstPoint && secondPoint) {
            currentDefinition.circles.push({
              kind: "drawing",
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
              name: currentDefinition.name,
              decalName: currentDefinition.name,
            })
          }
          continue
        }
        if (points.length >= 2) {
          const closed = pieceKind === "CLOSED"
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
          currentDefinition.paths.push({
            kind: "drawing",
            points,
            segments,
            closed,
            width,
            layer,
            name: currentDefinition.name,
            decalName: currentDefinition.name,
          })
        }
        continue
      }

      const terminalMatch = /^T([+-]?(?:\d+(?:\.\d*)?|\.\d+))$/u.exec(
        lineTokens[0] ?? "",
      )
      if (terminalMatch) {
        const x = parseFiniteNumber(terminalMatch[1])
        const y = parseFiniteNumber(lineTokens[1])
        if (x !== undefined && y !== undefined) {
          currentDefinition.terminals.push({
            location: { x, y },
            pinNumber:
              lineTokens[4] ?? String(currentDefinition.terminals.length + 1),
          })
        }
        lineIndex++
        continue
      }

      if (lineTokens[0] !== "PAD") {
        lineIndex++
        continue
      }

      const pinNumber = lineTokens[1]
      const stackLineCount = parseFiniteNumber(lineTokens[2])
      if (!pinNumber || stackLineCount === undefined || stackLineCount < 1) {
        lineIndex++
        continue
      }

      const normalizedStackLineCount = Math.trunc(stackLineCount)
      const layers: AsciiPartDecalPadLayer[] = []
      let parsedStackLineCount = 0
      lineIndex++
      while (
        lineIndex < section.lines.length &&
        parsedStackLineCount < normalizedStackLineCount
      ) {
        const stackTokens = tokenizeLine(section.lines[lineIndex] ?? "")
        lineIndex++
        if (stackTokens.length === 0 || stackTokens[0]?.startsWith("*REMARK")) {
          continue
        }
        parsedStackLineCount++
        const layer = parsePartDecalPadLayer({
          lineTokens: stackTokens,
          usesCornerRadiusFields,
        })
        if (layer) layers.push(layer)
      }
      if (parsedStackLineCount !== normalizedStackLineCount) {
        malformedPadStackCount++
        continue
      }
      currentDefinition.padStacks.set(pinNumber, { pinNumber, layers })
    }
  }

  if (malformedPadStackCount > 0) {
    diagnostics.push(
      `${malformedPadStackCount} ASCII part-decal pad stacks ended before all layer records were parsed`,
    )
  }
  if (malformedPieceArcCount > 0) {
    diagnostics.push(
      `${malformedPieceArcCount} ASCII part-decal arc records could not be decoded`,
    )
  }
  if (unsupportedPieceCount > 0) {
    diagnostics.push(
      `${unsupportedPieceCount} ASCII part-decal copper, keepout, or tag pieces were not added to drawing geometry`,
    )
  }
  return definitions
}

const parsePartTypeDecals = (
  sections: AsciiSectionLines[],
): Map<string, string[]> => {
  const decalNamesByPartType = new Map<string, string[]>()
  for (const section of sections) {
    if (section.name !== "PARTTYPE") continue
    for (const lineText of section.lines) {
      const lineTokens = tokenizeLine(lineText)
      const partTypeName = lineTokens[0]
      const decalList = lineTokens[1]
      const hasExplicitUnits = ["I", "M", "MM"].includes(lineTokens[2] ?? "")
      const hasLegacyHeader =
        !hasExplicitUnits &&
        parseFiniteNumber(lineTokens[2]) === undefined &&
        parseFiniteNumber(lineTokens[3]) !== undefined
      if (
        !partTypeName ||
        !decalList ||
        (!hasExplicitUnits && !hasLegacyHeader)
      ) {
        continue
      }
      decalNamesByPartType.set(
        partTypeName,
        decalList.split(":").filter(Boolean),
      )
    }
  }
  return decalNamesByPartType
}

const resolvePlacementDecalName = ({
  partTypeToken,
  alternateIndex,
  decalNamesByPartType,
}: {
  partTypeToken: string
  alternateIndex: number | undefined
  decalNamesByPartType: Map<string, string[]>
}): string => {
  const directDecalSeparator = partTypeToken.indexOf("@")
  if (directDecalSeparator >= 0) {
    return partTypeToken.slice(directDecalSeparator + 1) || partTypeToken
  }
  const alternatives = decalNamesByPartType.get(partTypeToken)
  if (!alternatives || alternatives.length === 0) return partTypeToken
  const selectedIndex =
    alternateIndex !== undefined && alternateIndex >= 0
      ? Math.trunc(alternateIndex)
      : 0
  return alternatives[selectedIndex] ?? alternatives[0] ?? partTypeToken
}

const addPartSectionGeometry = ({
  section,
  decalNamesByPartType,
  placements,
}: {
  section: AsciiSectionLines
  decalNamesByPartType: Map<string, string[]>
  placements: PadsGeometryPlacement[]
}): void => {
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
      footprintName: resolvePlacementDecalName({
        partTypeToken: lineTokens[1],
        alternateIndex: parseFiniteNumber(lineTokens[7]),
        decalNamesByPartType,
      }),
      location: { x, y },
      rotation,
      bottomLayer: lineTokens[6] === "M",
    })
  }
}

const normalizeRotation = (rotation: number): number => {
  const normalizedRotation = rotation % 360
  return normalizedRotation < 0 ? normalizedRotation + 360 : normalizedRotation
}

const transformDecalPoint = ({
  point,
  placement,
}: {
  point: PadsGeometryPoint
  placement: PadsGeometryPlacement
}): PadsGeometryPoint => {
  const mirroredX = placement.bottomLayer ? -point.x : point.x
  const rotationRadians = (placement.rotation * Math.PI) / 180
  return {
    x:
      placement.location.x +
      mirroredX * Math.cos(rotationRadians) -
      point.y * Math.sin(rotationRadians),
    y:
      placement.location.y +
      mirroredX * Math.sin(rotationRadians) +
      point.y * Math.cos(rotationRadians),
  }
}

const getPhysicalDecalGerberLayer = ({
  sourceLayer,
  placement,
  layers,
}: {
  sourceLayer: number | undefined
  placement: PadsGeometryPlacement
  layers: PadsGeometryLayerInfo[]
}): string => {
  if (sourceLayer === undefined || sourceLayer === 0) {
    return placement.bottomLayer ? "B_Fab" : "F_Fab"
  }

  const layerInfo = layers.find((layer) => layer.number === sourceLayer)
  const sourceSide =
    layerInfo?.side === "top" || layerInfo?.side === "bottom"
      ? layerInfo.side
      : undefined
  const physicalSide =
    sourceSide === undefined
      ? placement.bottomLayer
        ? "bottom"
        : "top"
      : placement.bottomLayer
        ? sourceSide === "top"
          ? "bottom"
          : "top"
        : sourceSide

  if (layerInfo?.role === "silkscreen") {
    return physicalSide === "bottom" ? "B_Silkscreen" : "F_Silkscreen"
  }
  if (layerInfo?.role === "assembly") {
    return physicalSide === "bottom" ? "B_Fab" : "F_Fab"
  }
  if (layerInfo?.role === "solder-mask") {
    return physicalSide === "bottom" ? "B_Mask" : "F_Mask"
  }
  if (layerInfo?.role === "paste-mask") {
    return physicalSide === "bottom" ? "B_Paste" : "F_Paste"
  }
  if (layerInfo?.role === "drill") return "Drill_Drawing"
  if (layerInfo?.role === "mechanical" || layerInfo?.role === "unassigned") {
    return "Dwgs_User"
  }

  // OPEN/CLOSED/CIRCLE decal pieces are component-outline drawings even when
  // their source level names a routing layer. Copper-bearing decal pieces use
  // the distinct COP* record kinds and remain quarantined until decoded.
  return physicalSide === "bottom" ? "B_Fab" : "F_Fab"
}

const transformDecalSegment = ({
  segment,
  placement,
}: {
  segment: PadsGeometryPathSegment
  placement: PadsGeometryPlacement
}): PadsGeometryPathSegment => {
  const start = transformDecalPoint({ point: segment.start, placement })
  const end = transformDecalPoint({ point: segment.end, placement })
  if (segment.kind === "line") return { kind: "line", start, end }

  const center = transformDecalPoint({ point: segment.center, placement })
  return {
    kind: "arc",
    start,
    end,
    center,
    radius: segment.radius,
    startAngle:
      (Math.atan2(start.y - center.y, start.x - center.x) * 180) / Math.PI,
    deltaAngle: placement.bottomLayer
      ? -segment.deltaAngle
      : segment.deltaAngle,
  }
}

const addPlacedPartGraphics = ({
  placements,
  definitions,
  layers,
  paths,
  circles,
}: {
  placements: PadsGeometryPlacement[]
  definitions: Map<string, AsciiPartDecalDefinition>
  layers: PadsGeometryLayerInfo[]
  paths: PadsGeometryPath[]
  circles: PadsGeometryCircle[]
}): void => {
  for (const placement of placements) {
    const decalName = placement.footprintName
    const definition = decalName ? definitions.get(decalName) : undefined
    if (!decalName || !definition) continue

    for (const path of definition.paths) {
      const sourceLayer =
        typeof path.layer === "number" && Number.isFinite(path.layer)
          ? Math.trunc(path.layer)
          : undefined
      paths.push({
        ...path,
        points: path.points.map((point) =>
          transformDecalPoint({ point, placement }),
        ),
        segments: path.segments?.map((segment) =>
          transformDecalSegment({ segment, placement }),
        ),
        gerberLayer: getPhysicalDecalGerberLayer({
          sourceLayer,
          placement,
          layers,
        }),
        name: `${placement.reference}:${decalName}`,
        reference: placement.reference,
        decalName,
      })
    }

    for (const circle of definition.circles) {
      const sourceLayer =
        typeof circle.layer === "number" && Number.isFinite(circle.layer)
          ? Math.trunc(circle.layer)
          : undefined
      circles.push({
        ...circle,
        center: transformDecalPoint({
          point: circle.center,
          placement,
        }),
        gerberLayer: getPhysicalDecalGerberLayer({
          sourceLayer,
          placement,
          layers,
        }),
        name: `${placement.reference}:${decalName}`,
        reference: placement.reference,
        decalName,
      })
    }
  }
}

const addPlacedPartPads = ({
  placements,
  definitions,
  layerCount,
  pads,
  holes,
  diagnostics,
}: {
  placements: PadsGeometryPlacement[]
  definitions: Map<string, AsciiPartDecalDefinition>
  layerCount: number
  pads: PadsGeometryPad[]
  holes: PadsGeometryHole[]
  diagnostics: string[]
}): void => {
  let unresolvedDecalCount = 0
  let missingPadStackCount = 0
  let unsupportedPadCount = 0

  for (const placement of placements) {
    const decalName = placement.footprintName
    const definition = decalName ? definitions.get(decalName) : undefined
    if (!decalName || !definition) {
      unresolvedDecalCount++
      continue
    }

    const mountedLayer = placement.bottomLayer ? layerCount : 1
    for (const terminal of definition.terminals) {
      const padStack =
        definition.padStacks.get(terminal.pinNumber) ??
        definition.padStacks.get("0")
      if (!padStack) {
        missingPadStackCount++
        continue
      }
      const padLayer =
        padStack.layers.find(
          (candidateLayer) => candidateLayer.sourceLevel === mountedLayer,
        ) ??
        padStack.layers.find(
          (candidateLayer) => candidateLayer.sourceLevel === -2,
        )
      if (!padLayer) continue

      const drillLayer =
        (padLayer.drillDiameter > 0 ? padLayer : undefined) ??
        padStack.layers.find(
          (candidateLayer) =>
            candidateLayer.sourceLevel === -2 &&
            candidateLayer.drillDiameter > 0,
        )
      if (drillLayer) {
        const slotRotationRadians = (drillLayer.slotOrientation * Math.PI) / 180
        const localHoleCenter = {
          x:
            terminal.location.x +
            drillLayer.slotOffset * Math.cos(slotRotationRadians),
          y:
            terminal.location.y +
            drillLayer.slotOffset * Math.sin(slotRotationRadians),
        }
        const localHoleRotation = placement.bottomLayer
          ? 180 - drillLayer.slotOrientation
          : drillLayer.slotOrientation
        holes.push({
          center: transformDecalPoint({
            point: localHoleCenter,
            placement,
          }),
          width: Math.max(drillLayer.drillDiameter, drillLayer.slotLength),
          height: drillLayer.drillDiameter,
          rotation: normalizeRotation(placement.rotation + localHoleRotation),
          plated: drillLayer.plated,
          startLayer: 1,
          endLayer: layerCount,
          reference: placement.reference,
          pinNumber: terminal.pinNumber,
          decalName,
        })
      }
      if (padLayer.size <= 0) continue

      const shape =
        padLayer.shapeCode === "R"
          ? "circle"
          : padLayer.shapeCode === "S"
            ? "square"
            : padLayer.shapeCode === "RF"
              ? "rect"
              : padLayer.shapeCode === "OF"
                ? "oval"
                : undefined
      if (!shape || padLayer.hasUnsupportedTrailingGeometry) {
        unsupportedPadCount++
        continue
      }

      const padRotation = placement.bottomLayer
        ? 180 - padLayer.orientation
        : padLayer.orientation
      const padRotationRadians = (padLayer.orientation * Math.PI) / 180
      const localPadCenter = {
        x: terminal.location.x + padLayer.offset * Math.cos(padRotationRadians),
        y: terminal.location.y + padLayer.offset * Math.sin(padRotationRadians),
      }
      pads.push({
        center: transformDecalPoint({
          point: localPadCenter,
          placement,
        }),
        width:
          padLayer.shapeCode === "RF" || padLayer.shapeCode === "OF"
            ? padLayer.length
            : padLayer.size,
        height: padLayer.size,
        shape,
        ...(padLayer.cornerRadius > 0
          ? {
              cornerRadius: padLayer.cornerRadius,
              chamfered: padLayer.chamfered,
            }
          : {}),
        rotation: normalizeRotation(placement.rotation + padRotation),
        layer: mountedLayer,
        reference: placement.reference,
        pinNumber: terminal.pinNumber,
        decalName,
      })
    }
  }

  if (unresolvedDecalCount > 0) {
    diagnostics.push(
      `${unresolvedDecalCount} ASCII part placements have no decoded decal definition`,
    )
  }
  if (missingPadStackCount > 0) {
    diagnostics.push(
      `${missingPadStackCount} ASCII decal terminals have no matching pad stack`,
    )
  }
  if (unsupportedPadCount > 0) {
    diagnostics.push(
      `${unsupportedPadCount} ASCII placed pads use drilled, rounded, or unsupported pad geometry`,
    )
  }
}

const getLayerRole = ({
  name,
  type,
  defaultToCopper,
}: {
  name: string
  type?: string
  defaultToCopper: boolean
}): PadsGeometryLayerInfo["role"] => {
  const normalizedName = name.toUpperCase()
  const normalizedType = type?.toUpperCase()
  if (
    normalizedType === "ROUTING" ||
    normalizedType === "ROUTE" ||
    normalizedType === "PLANE"
  ) {
    return "copper"
  }
  if (
    normalizedType === "SILK_SCREEN" ||
    normalizedName.includes("SILKSCREEN")
  ) {
    return "silkscreen"
  }
  if (
    normalizedType === "SOLDER_MASK" ||
    normalizedName.includes("SOLDER MASK")
  ) {
    return "solder-mask"
  }
  if (
    normalizedType === "PASTE_MASK" ||
    normalizedName.includes("PASTE MASK")
  ) {
    return "paste-mask"
  }
  if (
    normalizedType === "ASSEMBLY" ||
    normalizedName.includes("ASSEMBLY") ||
    normalizedName.includes("P&P")
  ) {
    return "assembly"
  }
  if (normalizedType === "DRILL" || normalizedName.includes("DRILL")) {
    return "drill"
  }
  if (
    normalizedName.includes("BOARD OUTLINE") ||
    normalizedName.includes("SIZE DRAWING")
  ) {
    return "mechanical"
  }
  return defaultToCopper ? "copper" : "unassigned"
}

const getLayerSide = ({
  name,
  role,
}: {
  name: string
  role: PadsGeometryLayerInfo["role"]
}): PadsGeometryLayerInfo["side"] => {
  const normalizedName = name.toUpperCase()
  if (normalizedName.includes("TOP")) return "top"
  if (normalizedName.includes("BOTTOM") || normalizedName.includes("BOT")) {
    return "bottom"
  }
  return role === "copper" ? "internal" : "none"
}

const makeLayerInfo = ({
  number,
  name,
  type,
  defaultToCopper,
}: {
  number: number
  name: string
  type?: string
  defaultToCopper: boolean
}): PadsGeometryLayerInfo => {
  const role = getLayerRole({ name, type, defaultToCopper })
  return {
    number,
    name,
    ...(type ? { type } : {}),
    role,
    side: getLayerSide({ name, role }),
  }
}

const parseMiscLayerInfo = (
  sections: AsciiSectionLines[],
): PadsGeometryLayerInfo[] => {
  const layers: PadsGeometryLayerInfo[] = []
  for (const section of sections) {
    if (section.name !== "MISC") continue

    let awaitingLayerDataBody = false
    let insideLayerData = false
    let depth = 0
    let pendingLayerNumber: number | undefined
    let currentLayer:
      | { number: number; name?: string; type?: string }
      | undefined

    for (const lineText of section.lines) {
      const trimmedLine = lineText.trim()
      const lineTokens = tokenizeLine(lineText)
      if (!insideLayerData) {
        if (
          lineTokens.length === 2 &&
          lineTokens[0] === "LAYER" &&
          lineTokens[1] === "DATA"
        ) {
          awaitingLayerDataBody = true
          continue
        }
        if (awaitingLayerDataBody && trimmedLine === "{") {
          insideLayerData = true
          awaitingLayerDataBody = false
          depth = 1
        }
        continue
      }

      if (trimmedLine === "{") {
        depth++
        if (depth === 2 && pendingLayerNumber !== undefined) {
          currentLayer = { number: pendingLayerNumber }
          pendingLayerNumber = undefined
        }
        continue
      }
      if (trimmedLine === "}") {
        if (depth === 2 && currentLayer) {
          if (currentLayer.number > 0 && currentLayer.name) {
            layers.push(
              makeLayerInfo({
                number: currentLayer.number,
                name: currentLayer.name,
                type: currentLayer.type,
                defaultToCopper: false,
              }),
            )
          }
          currentLayer = undefined
        }
        depth--
        if (depth <= 0) {
          insideLayerData = false
          break
        }
        continue
      }

      if (depth === 1 && lineTokens.length === 2 && lineTokens[0] === "LAYER") {
        const layerNumber = parseFiniteNumber(lineTokens[1])
        pendingLayerNumber =
          layerNumber === undefined ? undefined : Math.trunc(layerNumber)
        continue
      }
      if (depth !== 2 || !currentLayer) continue
      if (lineTokens[0] === "LAYER_NAME" && lineTokens.length > 1) {
        currentLayer.name = lineTokens.slice(1).join(" ")
      } else if (lineTokens[0] === "LAYER_TYPE" && lineTokens[1]) {
        currentLayer.type = lineTokens[1]
      }
    }
  }
  return layers
}

const parseLayerInfo = (
  sections: AsciiSectionLines[],
): PadsGeometryLayerInfo[] => {
  const layerByNumber = new Map<number, PadsGeometryLayerInfo>()
  for (const section of sections) {
    if (section.name !== "LAYER") continue
    for (const lineText of section.lines) {
      const lineTokens = tokenizeLine(lineText)
      const layerNumber = parseFiniteNumber(lineTokens[0])
      if (layerNumber === undefined || !lineTokens[1]) continue
      const normalizedLayerNumber = Math.trunc(layerNumber)
      layerByNumber.set(
        normalizedLayerNumber,
        makeLayerInfo({
          number: normalizedLayerNumber,
          name: lineTokens.slice(1).join(" "),
          defaultToCopper: true,
        }),
      )
    }
  }
  for (const layer of parseMiscLayerInfo(sections)) {
    layerByNumber.set(layer.number, layer)
  }
  return [...layerByNumber.values()].sort(
    (firstLayer, secondLayer) => firstLayer.number - secondLayer.number,
  )
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
  const copperLayerNumbers = layers
    .filter((layer) => layer.role === "copper")
    .map((layer) => layer.number)
  return copperLayerNumbers.length > 0
    ? Math.max(...copperLayerNumbers)
    : layers.length || 2
}

export const extractAsciiBoardGeometry = (
  document: PadsAsciiDocument,
): PadsBoardGeometry => {
  const sections = collectTopLevelSections(document.getString())
  const layers = parseLayerInfo(sections)
  const layerCount = parseLayerCount(sections, layers)
  const diagnostics: string[] = []
  const viaDefinitions = parseViaDefinitions({ sections, diagnostics })
  const partDecalDefinitions = parsePartDecalDefinitions({
    sections,
    version: document.version,
    diagnostics,
  })
  const decalNamesByPartType = parsePartTypeDecals(sections)
  const paths: PadsGeometryPath[] = []
  const circles: PadsGeometryCircle[] = []
  const texts: PadsGeometryText[] = []
  const placements: PadsGeometryPlacement[] = []
  const pads: PadsGeometryPad[] = []
  const holes: PadsGeometryHole[] = []
  const unverifiedViaLocations: PadsGeometryPoint[] = []

  for (const section of sections) {
    if (section.name === "LINES") {
      addLineSectionGeometry({ section, paths, circles, diagnostics })
    } else if (section.name === "ROUTE") {
      addRouteSectionGeometry({
        section,
        layerCount,
        viaDefinitions,
        paths,
        circles,
        unverifiedViaLocations,
        diagnostics,
      })
    } else if (section.name === "TEXT") {
      addTextSectionGeometry(section, texts)
    } else if (section.name === "PART") {
      addPartSectionGeometry({
        section,
        decalNamesByPartType,
        placements,
      })
    }
  }
  addPlacedPartPads({
    placements,
    definitions: partDecalDefinitions,
    layerCount,
    pads,
    holes,
    diagnostics,
  })
  addPlacedPartGraphics({
    placements,
    definitions: partDecalDefinitions,
    layers,
    paths,
    circles,
  })

  return {
    sourceFormat: "ascii",
    version: document.version,
    layerCount,
    layers,
    paths,
    circles,
    texts,
    placements,
    pads,
    holes,
    unassignedVertices: [],
    unverifiedConnections: [],
    unverifiedViaLocations,
    binarySections: [],
    diagnostics,
  }
}

import {
  type PadsAsciiDocument,
  type PadsAsciiRecord,
  tokenizePadsAsciiRecord,
} from "../ascii"
import type { PadsSourceProvenance } from "../source-provenance"
import { getPadsDocumentSourceProvenance } from "../source-provenance"
import {
  type AsciiPartDecalTextTemplate,
  parseAsciiPartDecalTextTemplate,
} from "./ascii-part-decal-text"
import { normalizeGeometryUnits } from "./normalize-geometry-units"
import type {
  PadsBoardGeometry,
  PadsGeometryAntipad,
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
  PadsGeometryThermalRelief,
  PadsGeometryViaPad,
} from "./pads-board-geometry"

interface AsciiSectionLines {
  name: string
  lines: string[]
  records: PadsAsciiRecord[]
}

const tokenizeLine = (lineText: string): string[] =>
  tokenizePadsAsciiRecord(lineText).map((token) => token.value)

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

const collectTopLevelSections = (
  document: PadsAsciiDocument,
): AsciiSectionLines[] =>
  document.sections.map((section) => ({
    name: section.name,
    lines: section.records.map((record) => record.contentText),
    records: section.records,
  }))

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
  if (objectType.includes("COPPER") || objectType === "COPCUT") return "copper"
  return "drawing"
}

const getCircleKind = (
  pathKind: PadsGeometryPathKind,
): PadsGeometryCircleKind => (pathKind === "route" ? "drawing" : pathKind)

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
    const objectSource = section.records[lineIndex]?.provenance
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
      const polarity =
        objectType === "COPCUT" ||
        pieceKind === "COPCUT" ||
        pieceKind === "COPCCO"
          ? "negative"
          : "positive"
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
        (pieceKind === "CIRCLE" ||
          pieceKind === "BRDCIR" ||
          pieceKind === "KPTCIR") &&
        points.length >= 2
      ) {
        const firstPoint = points[0]
        const secondPoint = points[1]
        if (firstPoint && secondPoint) {
          circles.push({
            source: objectSource,
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
            sourcePieceKind: pieceKind,
            polarity,
          })
        }
        continue
      }

      if (points.length >= 2) {
        const closed =
          pieceKind === "CLOSED" ||
          pieceKind.endsWith("CLS") ||
          pieceKind === "COPCUT" ||
          pieceKind === "COPCCO"
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
          source: objectSource,
          kind: pathKind,
          points,
          segments,
          closed,
          width,
          layer,
          name: objectName,
          sourcePieceKind: pieceKind,
          polarity,
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
  source?: PadsSourceProvenance
  drillRadius: number
  pads: AsciiViaPadDefinition[]
  startLayer?: number
  endLayer?: number
}

interface AsciiViaPadDefinition {
  source?: PadsSourceProvenance
  sourceLevel: number
  radius: number
  shape?: "circle" | "square"
  shapeCode: string
  kind: "conductive" | "negative" | "thermal" | "unsupported"
  thermal?: {
    rotation: number
    outerDiameter: number
    spokeWidth: number
    spokeCount: number
  }
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
      const source = section.records[lineIndex]?.provenance
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
        const shape =
          shapeCode === "R" || shapeCode === "RA" || shapeCode === "RT"
            ? "circle"
            : shapeCode === "S" || shapeCode === "SA" || shapeCode === "ST"
              ? "square"
              : undefined
        const isThermal = shapeCode === "RT" || shapeCode === "ST"
        const firstThermalValue = parseFiniteNumber(stackTokens[3])
        const secondThermalValue = parseFiniteNumber(stackTokens[4])
        // The published format is orientation then outer diameter. Some
        // PADS BASIC exports (including KiCad's pinned TMS fixture) reverse
        // those two fields; a dimension-sized first value makes that variant
        // unambiguous.
        const usesDimensionFirstThermalOrder =
          isThermal &&
          firstThermalValue !== undefined &&
          secondThermalValue !== undefined &&
          Math.abs(firstThermalValue) > 360 &&
          Math.abs(secondThermalValue) <= 360
        pads.push({
          source: section.records[lineIndex - 1]?.provenance,
          sourceLevel: Math.trunc(sourceLevel),
          radius: diameter / 2,
          shape,
          shapeCode,
          kind:
            shapeCode === "R" || shapeCode === "S"
              ? "conductive"
              : shapeCode === "RA" || shapeCode === "SA"
                ? "negative"
                : isThermal
                  ? "thermal"
                  : "unsupported",
          ...(isThermal
            ? {
                thermal: {
                  rotation: usesDimensionFirstThermalOrder
                    ? secondThermalValue
                    : (firstThermalValue ?? 0),
                  outerDiameter: Math.abs(
                    (usesDimensionFirstThermalOrder
                      ? firstThermalValue
                      : secondThermalValue) ?? diameter,
                  ),
                  spokeWidth: Math.abs(parseFiniteNumber(stackTokens[5]) ?? 0),
                  spokeCount: Math.max(
                    0,
                    Math.trunc(parseFiniteNumber(stackTokens[6]) ?? 0),
                  ),
                },
              }
            : {}),
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
        source,
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
  thermalReliefs: Array<Omit<PadsGeometryThermalRelief, "center">>
  antipads: Array<Omit<PadsGeometryAntipad, "center">>
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
  const padsByLevel = new Map<number, AsciiViaPadDefinition[]>()
  for (const pad of definition.pads) {
    const levelPads = padsByLevel.get(pad.sourceLevel) ?? []
    levelPads.push(pad)
    padsByLevel.set(pad.sourceLevel, levelPads)
  }

  const copperPads: PadsGeometryViaPad[] = []
  const thermalReliefs: Array<Omit<PadsGeometryThermalRelief, "center">> = []
  const antipads: Array<Omit<PadsGeometryAntipad, "center">> = []
  const unsupportedShapeCodes: string[] = []
  for (let layer = startLayer; layer <= endLayer; layer++) {
    let genericPads =
      startLayer === endLayer
        ? (padsByLevel.get(-2) ??
          padsByLevel.get(0) ??
          padsByLevel.get(-1) ??
          [])
        : layer === startLayer
          ? (padsByLevel.get(-2) ?? [])
          : layer === endLayer
            ? (padsByLevel.get(0) ?? [])
            : (padsByLevel.get(-1) ?? [])
    if (genericPads.length === 0 && layer > startLayer && layer < endLayer) {
      genericPads = padsByLevel.get(-2) ?? padsByLevel.get(0) ?? []
    }
    const specificPads = padsByLevel.get(layer) ?? []
    const getPadsForKind = (kind: AsciiViaPadDefinition["kind"]) => {
      const specific = specificPads.filter((pad) => pad.kind === kind)
      return specific.length > 0
        ? specific
        : genericPads.filter((pad) => pad.kind === kind)
    }

    const conductivePad = getPadsForKind("conductive").sort(
      (first, second) => second.radius - first.radius,
    )[0]
    if (conductivePad?.shape) {
      copperPads.push({
        layer,
        radius: conductivePad.radius,
        shape: conductivePad.shape,
      })
    }
    for (const pad of getPadsForKind("thermal")) {
      if (!pad.shape || !pad.thermal) continue
      thermalReliefs.push({
        source: pad.source,
        layer,
        shape: pad.shape,
        rotation: pad.thermal.rotation,
        innerDiameter: pad.radius * 2,
        outerDiameter: pad.thermal.outerDiameter,
        spokeWidth: pad.thermal.spokeWidth,
        spokeCount: pad.thermal.spokeCount,
      })
    }
    for (const pad of getPadsForKind("negative")) {
      if (!pad.shape) continue
      antipads.push({
        source: pad.source,
        layer,
        shape: pad.shape,
        diameter: pad.radius * 2,
      })
    }
    for (const pad of getPadsForKind("unsupported")) {
      unsupportedShapeCodes.push(pad.shapeCode)
    }
  }

  return {
    startLayer,
    endLayer,
    copperPads,
    thermalReliefs,
    antipads,
    unsupportedShapeCodes,
  }
}

const addRouteSectionGeometry = ({
  section,
  layerCount,
  viaDefinitions,
  paths,
  circles,
  thermalReliefs,
  antipads,
  unverifiedViaLocations,
  diagnostics,
}: {
  section: AsciiSectionLines
  layerCount: number
  viaDefinitions: Map<string, AsciiViaDefinition>
  paths: PadsGeometryPath[]
  circles: PadsGeometryCircle[]
  thermalReliefs: PadsGeometryThermalRelief[]
  antipads: PadsGeometryAntipad[]
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
    source,
  }: {
    location: PadsGeometryPoint
    name: string
    startLayer?: number
    endLayer?: number
    source?: PadsSourceProvenance
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
    thermalReliefs.push(
      ...resolvedPadStack.thermalReliefs.map((thermal) => ({
        ...thermal,
        center: location,
        viaName: name,
        netName,
      })),
    )
    antipads.push(
      ...resolvedPadStack.antipads.map((antipad) => ({
        ...antipad,
        center: location,
        viaName: name,
        netName,
      })),
    )
    const startPad =
      resolvedPadStack.copperPads.find(
        (pad) => pad.layer === resolvedPadStack.startLayer,
      ) ?? largestPad
    circles.push({
      source,
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

  let netSource: PadsSourceProvenance | undefined
  for (let lineIndex = 0; lineIndex < section.lines.length; lineIndex++) {
    const lineText = section.lines[lineIndex] ?? ""
    const source = section.records[lineIndex]?.provenance
    const signalMatch = /^\*SIGNAL\*\s*(\S*)/u.exec(lineText.trim())
    if (signalMatch) {
      netName = signalMatch[1] ?? ""
      netSource = source
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
          location: { x, y, source },
          name,
          startLayer: parseFiniteNumber(lineTokens[4]),
          endLayer: parseFiniteNumber(lineTokens[5]),
          source,
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
    const currentPoint = { x, y, layer, width, source }
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
            source: previousPoint.source ?? source ?? netSource,
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
        location: { x, y, source },
        name: viaName,
        source,
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
  layers: PadsGeometryLayerInfo[],
  layerCount: number,
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

    const layerInfo = layers.find(({ number }) => number === Math.trunc(layer))
    const side =
      layerInfo?.side === "top" || layerInfo?.side === "bottom"
        ? layerInfo.side
        : lineTokens[6] === "M"
          ? "bottom"
          : "top"
    const gerberLayer =
      layerInfo?.role === "silkscreen"
        ? side === "bottom"
          ? "B_Silkscreen"
          : "F_Silkscreen"
        : layerInfo?.role === "assembly"
          ? side === "bottom"
            ? "B_Fab"
            : "F_Fab"
          : layerInfo?.role === "solder-mask"
            ? side === "bottom"
              ? "B_Mask"
              : "F_Mask"
            : layerInfo?.role === "paste-mask"
              ? side === "bottom"
                ? "B_Paste"
                : "F_Paste"
              : layerInfo?.role === "drill"
                ? "Drill_Drawing"
                : layerInfo?.role === "mechanical" ||
                    layerInfo?.role === "unassigned"
                  ? "Dwgs_User"
                  : layer <= 1
                    ? "F_Cu"
                    : layer >= layerCount
                      ? "B_Cu"
                      : `In${Math.trunc(layer) - 1}_Cu`

    texts.push({
      source: section.records[lineIndex]?.provenance,
      content,
      location: { x, y },
      height: Math.abs(height),
      strokeWidth: Math.abs(strokeWidth),
      rotation,
      mirrored: lineTokens[6] === "M",
      layer,
      gerberLayer,
    })
    lineIndex += 2
  }
}

interface AsciiPartDecalTerminal {
  location: PadsGeometryPoint
  pinNumber: string
  source?: PadsSourceProvenance
}

interface AsciiPartDecalPadLayer {
  source?: PadsSourceProvenance
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
  thermal?: {
    outerDiameter: number
    spokeWidth: number
    spokeCount: number
  }
}

interface AsciiPartDecalPadStack {
  pinNumber: string
  layers: AsciiPartDecalPadLayer[]
}

interface AsciiPartDecalDefinition {
  name: string
  source?: PadsSourceProvenance
  terminals: AsciiPartDecalTerminal[]
  padStacks: Map<string, AsciiPartDecalPadStack>
  paths: PadsGeometryPath[]
  circles: PadsGeometryCircle[]
  texts: AsciiPartDecalTextTemplate[]
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

const SUPPORTED_PART_DECAL_COPPER_KINDS = new Set([
  "COPCLS",
  "COPOPN",
  "COPCIR",
  "COPCUT",
  "COPCCO",
])

const SUPPORTED_PART_DECAL_KEEPOUT_KINDS = new Set(["KPTCLS", "KPTCIR"])

const PART_DECAL_CIRCLE_KINDS = new Set([
  "CIRCLE",
  "COPCIR",
  "COPCCO",
  "KPTCIR",
])

const PART_DECAL_CLOSED_KINDS = new Set([
  "CLOSED",
  "COPCLS",
  "COPCUT",
  "KPTCLS",
])

const parsePartDecalPadLayer = ({
  lineTokens,
  usesCornerRadiusFields,
  source,
}: {
  lineTokens: string[]
  usesCornerRadiusFields: boolean
  source?: PadsSourceProvenance
}): AsciiPartDecalPadLayer | undefined => {
  const sourceLevel = parseFiniteNumber(lineTokens[0])
  const size = parseFiniteNumber(lineTokens[1])
  const shapeCode = lineTokens[2]?.toUpperCase()
  if (sourceLevel === undefined || size === undefined || !shapeCode) {
    return undefined
  }

  const fingerShape = shapeCode === "RF" || shapeCode === "OF"
  const thermalShape = shapeCode === "RT" || shapeCode === "ST"
  const orientation =
    fingerShape || thermalShape ? (parseFiniteNumber(lineTokens[3]) ?? 0) : 0
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
  } else if (thermalShape) {
    // Thermal orientation, outer diameter, spoke width, and spoke count.
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
    source,
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
    ...(thermalShape
      ? {
          thermal: {
            outerDiameter: Math.abs(parseFiniteNumber(lineTokens[4]) ?? size),
            spokeWidth: Math.abs(parseFiniteNumber(lineTokens[5]) ?? 0),
            spokeCount: Math.max(
              0,
              Math.trunc(parseFiniteNumber(lineTokens[6]) ?? 0),
            ),
          },
        }
      : {}),
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
  let allLayerCopperPieceCount = 0
  let malformedTagCount = 0
  let malformedTextCount = 0
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
    let remainingTextCount = 0
    let tagGroupSequence = 0
    let activeTagGroups: { id: string; pinNumber?: string }[] = []
    let lineIndex = 0
    while (lineIndex < section.lines.length) {
      const source = section.records[lineIndex]?.provenance
      const lineTokens = tokenizeLine(section.lines[lineIndex] ?? "")
      if (isPartDecalHeader(lineTokens)) {
        malformedTagCount += activeTagGroups.length
        activeTagGroups = []
        const name = lineTokens[0]
        if (name) {
          currentDefinition = {
            name,
            source,
            terminals: [],
            padStacks: new Map(),
            paths: [],
            circles: [],
            texts: [],
          }
          definitions.set(name, currentDefinition)
          remainingPieceCount = Math.max(
            0,
            Math.trunc(parseFiniteNumber(lineTokens[4]) ?? 0),
          )
          remainingTextCount = Math.max(
            0,
            Math.trunc(parseFiniteNumber(lineTokens[7]) ?? 0),
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
        const pieceSource = source
        const cornerCount = Math.max(
          0,
          Math.trunc(parseFiniteNumber(lineTokens[1]) ?? 0),
        )
        const width = Math.abs(parseFiniteNumber(lineTokens[2]) ?? 0)
        const layer = parseFiniteNumber(
          lineTokens[usesPieceLineStyleField ? 4 : 3],
        )
        const trailingToken =
          lineTokens[usesPieceLineStyleField ? 5 : 4]?.toUpperCase()
        const sourcePinIndex =
          pieceKind.startsWith("COP") || pieceKind === "TAG"
            ? parseFiniteNumber(trailingToken)
            : undefined
        const explicitPinNumber =
          sourcePinIndex !== undefined && sourcePinIndex >= 0
            ? String(Math.trunc(sourcePinIndex) + 1)
            : undefined
        const restrictions = pieceKind.startsWith("KPT")
          ? trailingToken
          : undefined
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
        if (pieceKind === "TAG") {
          if (layer === 1) {
            activeTagGroups.push({
              id: `${currentDefinition.name}:tag-${++tagGroupSequence}`,
              ...(explicitPinNumber ? { pinNumber: explicitPinNumber } : {}),
            })
          } else if (layer === 0 && activeTagGroups.length > 0) {
            activeTagGroups.pop()
          } else {
            malformedTagCount++
          }
          continue
        }
        if (SUPPORTED_PART_DECAL_COPPER_KINDS.has(pieceKind) && layer === 0) {
          allLayerCopperPieceCount++
          continue
        }

        const geometryKind: PadsGeometryPathKind =
          SUPPORTED_PART_DECAL_COPPER_KINDS.has(pieceKind)
            ? "copper"
            : SUPPORTED_PART_DECAL_KEEPOUT_KINDS.has(pieceKind)
              ? "keepout"
              : "drawing"
        const activeTagGroup = activeTagGroups.at(-1)
        const pinNumber = explicitPinNumber ?? activeTagGroup?.pinNumber
        const sharedPieceProperties = {
          source: pieceSource,
          layer,
          name: currentDefinition.name,
          decalName: currentDefinition.name,
          sourcePieceKind: pieceKind,
          polarity:
            pieceKind === "COPCUT" || pieceKind === "COPCCO"
              ? ("negative" as const)
              : ("positive" as const),
          ...(pinNumber ? { pinNumber } : {}),
          ...(restrictions ? { restrictions } : {}),
          ...(activeTagGroup ? { groupId: activeTagGroup.id } : {}),
        }

        if (PART_DECAL_CIRCLE_KINDS.has(pieceKind) && points.length >= 2) {
          const firstPoint = points[0]
          const secondPoint = points[1]
          if (firstPoint && secondPoint) {
            currentDefinition.circles.push({
              kind:
                geometryKind === "copper"
                  ? "copper"
                  : geometryKind === "keepout"
                    ? "keepout"
                    : "drawing",
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
              ...sharedPieceProperties,
            })
          }
          continue
        }
        if (points.length >= 2) {
          const closed = PART_DECAL_CLOSED_KINDS.has(pieceKind)
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
            kind: geometryKind,
            points,
            segments,
            closed,
            width,
            ...sharedPieceProperties,
          })
        }
        continue
      }

      if (remainingPieceCount === 0 && remainingTextCount > 0) {
        if (lineTokens.length === 0 || lineTokens[0]?.startsWith("*REMARK")) {
          lineIndex++
          continue
        }
        const hasFontLine = versionHasFontLines(version)
        const contentLineIndex = lineIndex + (hasFontLine ? 2 : 1)
        const content = section.lines[contentLineIndex]?.trim()
        const textTemplate =
          content === undefined
            ? undefined
            : parseAsciiPartDecalTextTemplate({
                lineTokens,
                content,
                source,
              })
        if (textTemplate) currentDefinition.texts.push(textTemplate)
        else malformedTextCount++
        remainingTextCount--
        lineIndex = contentLineIndex + 1
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
            location: { x, y, source },
            pinNumber:
              lineTokens[4] ?? String(currentDefinition.terminals.length + 1),
            source,
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
        const layerSource = section.records[lineIndex]?.provenance
        const stackTokens = tokenizeLine(section.lines[lineIndex] ?? "")
        lineIndex++
        if (stackTokens.length === 0 || stackTokens[0]?.startsWith("*REMARK")) {
          continue
        }
        parsedStackLineCount++
        const layer = parsePartDecalPadLayer({
          lineTokens: stackTokens,
          usesCornerRadiusFields,
          source: layerSource,
        })
        if (layer) layers.push(layer)
      }
      if (parsedStackLineCount !== normalizedStackLineCount) {
        malformedPadStackCount++
        continue
      }
      currentDefinition.padStacks.set(pinNumber, { pinNumber, layers })
    }
    malformedTagCount += activeTagGroups.length
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
  if (allLayerCopperPieceCount > 0) {
    diagnostics.push(
      `${allLayerCopperPieceCount} ASCII part-decal copper pieces target all layers and were not assigned to a fabrication layer`,
    )
  }
  if (malformedTagCount > 0) {
    diagnostics.push(
      `${malformedTagCount} ASCII part-decal tag records have unmatched group boundaries`,
    )
  }
  if (malformedTextCount > 0) {
    diagnostics.push(
      `${malformedTextCount} ASCII part-decal static text records could not be decoded`,
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

function normalizeRotation(rotation: number): number {
  const normalizedRotation = rotation % 360
  return normalizedRotation < 0 ? normalizedRotation + 360 : normalizedRotation
}

function transformDecalPoint({
  point,
  placement,
}: {
  point: PadsGeometryPoint
  placement: PadsGeometryPlacement
}): PadsGeometryPoint {
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

const getComponentLabelRole = (
  labelName: string,
): "reference" | "value" | undefined => {
  const normalizedName = labelName.trim().toUpperCase()
  if (normalizedName === "REF.DES.") return "reference"
  if (normalizedName === "PART TYPE" || normalizedName === "VALUE") {
    return "value"
  }
  return undefined
}

const versionHasFontLines = (version: string): boolean => {
  const majorVersion = Number(/^V?(\d+)/u.exec(version)?.[1])
  return (
    Number.isFinite(majorVersion) && (majorVersion === 0 || majorVersion >= 9)
  )
}

const addPartSectionGeometry = ({
  section,
  decalNamesByPartType,
  placements,
  texts,
  layerCount,
  version,
}: {
  section: AsciiSectionLines
  decalNamesByPartType: Map<string, string[]>
  placements: PadsGeometryPlacement[]
  texts: PadsGeometryText[]
  layerCount: number
  version: string
}): void => {
  for (let lineIndex = 0; lineIndex < section.lines.length; lineIndex++) {
    const lineText = section.lines[lineIndex] ?? ""
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

    const placement: PadsGeometryPlacement = {
      source: section.records[lineIndex]?.provenance,
      reference: lineTokens[0],
      partTypeName: lineTokens[1],
      footprintName: resolvePlacementDecalName({
        partTypeToken: lineTokens[1],
        alternateIndex: parseFiniteNumber(lineTokens[7]),
        decalNamesByPartType,
      }),
      location: { x, y },
      rotation,
      bottomLayer: lineTokens[6] === "M",
    }
    placements.push(placement)

    const labelCount = Math.max(
      0,
      Math.trunc(parseFiniteNumber(lineTokens[11]) ?? 0),
    )
    let labelLineIndex = lineIndex + 1
    if (section.lines[labelLineIndex]?.trim().startsWith(".REUSE.") === true) {
      labelLineIndex++
    }
    for (let labelIndex = 0; labelIndex < labelCount; labelIndex++) {
      const labelTokens = tokenizeLine(section.lines[labelLineIndex] ?? "")
      const labelX = parseFiniteNumber(labelTokens[1])
      const labelY = parseFiniteNumber(labelTokens[2])
      const labelRotation = parseFiniteNumber(labelTokens[3])
      const labelHeight = parseFiniteNumber(labelTokens[5])
      const labelStrokeWidth = parseFiniteNumber(labelTokens[6])
      const hasFontLine = versionHasFontLines(version)
      const roleLineIndex = labelLineIndex + (hasFontLine ? 2 : 1)
      const role = getComponentLabelRole(
        section.lines[roleLineIndex]?.trim() ?? "",
      )
      const visible = [
        "VALUE",
        "FULL_NAME",
        "NAME",
        "FULL_BOTH",
        "BOTH",
      ].includes(labelTokens[0] ?? "")
      const content =
        role === "reference"
          ? placement.reference
          : role === "value"
            ? placement.partTypeName
            : undefined
      if (
        visible &&
        role &&
        content &&
        labelX !== undefined &&
        labelY !== undefined &&
        labelRotation !== undefined &&
        labelHeight !== undefined &&
        labelStrokeWidth !== undefined
      ) {
        const localRotation = placement.bottomLayer
          ? 180 - labelRotation
          : labelRotation
        texts.push({
          source: section.records[labelLineIndex]?.provenance,
          content,
          location: transformDecalPoint({
            point: { x: labelX, y: labelY },
            placement,
          }),
          height: Math.abs(labelHeight),
          strokeWidth: Math.abs(labelStrokeWidth),
          rotation: normalizeRotation(placement.rotation + localRotation),
          mirrored: placement.bottomLayer !== (labelTokens[7] === "M"),
          horizontalAlignment:
            labelTokens[8] === "LEFT"
              ? "left"
              : labelTokens[8] === "RIGHT"
                ? "right"
                : "center",
          verticalAlignment:
            labelTokens[9] === "UP"
              ? "bottom"
              : labelTokens[9] === "DOWN"
                ? "top"
                : "center",
          reference: placement.reference,
          role,
          layer: placement.bottomLayer ? layerCount : 1,
          gerberLayer: placement.bottomLayer ? "B_Silkscreen" : "F_Silkscreen",
        })
      }
      lineIndex = roleLineIndex
      labelLineIndex = roleLineIndex + 1
    }
  }
}

const getPhysicalDecalGerberLayer = ({
  sourceLayer,
  pieceKind,
  placement,
  layers,
  layerCount,
}: {
  sourceLayer: number | undefined
  pieceKind: PadsGeometryPathKind | PadsGeometryCircleKind
  placement: PadsGeometryPlacement
  layers: PadsGeometryLayerInfo[]
  layerCount: number
}): string => {
  if (pieceKind === "keepout") return "Keepout"
  if (pieceKind === "copper" && sourceLayer === -1) {
    return placement.bottomLayer ? "F_Cu" : "B_Cu"
  }
  if (sourceLayer === undefined || sourceLayer === 0) {
    return pieceKind === "drawing"
      ? placement.bottomLayer
        ? "B_Fab"
        : "F_Fab"
      : "Dwgs_User"
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

  if (pieceKind === "copper") {
    if (physicalSide === "top") return "F_Cu"
    if (physicalSide === "bottom") return "B_Cu"
    if (sourceLayer > 1 && sourceLayer < layerCount) {
      return `In${sourceLayer - 1}_Cu`
    }
    return "Dwgs_User"
  }

  // OPEN/CLOSED/CIRCLE decal pieces are component-outline drawings even when
  // their source level names a routing layer. Copper-bearing decal pieces use
  // the distinct COP* record kinds.
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
  layerCount,
  paths,
  circles,
  texts,
}: {
  placements: PadsGeometryPlacement[]
  definitions: Map<string, AsciiPartDecalDefinition>
  layers: PadsGeometryLayerInfo[]
  layerCount: number
  paths: PadsGeometryPath[]
  circles: PadsGeometryCircle[]
  texts: PadsGeometryText[]
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
          pieceKind: path.kind,
          placement,
          layers,
          layerCount,
        }),
        name: `${placement.reference}:${decalName}`,
        reference: placement.reference,
        decalName,
        ...(path.groupId
          ? { groupId: `${placement.reference}:${path.groupId}` }
          : {}),
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
          pieceKind: circle.kind,
          placement,
          layers,
          layerCount,
        }),
        name: `${placement.reference}:${decalName}`,
        reference: placement.reference,
        decalName,
        ...(circle.groupId
          ? { groupId: `${placement.reference}:${circle.groupId}` }
          : {}),
      })
    }

    for (const textTemplate of definition.texts) {
      const localRotation = placement.bottomLayer
        ? 180 - textTemplate.rotation
        : textTemplate.rotation
      texts.push({
        source: textTemplate.source,
        content: textTemplate.content,
        location: transformDecalPoint({
          point: textTemplate.location,
          placement,
        }),
        height: textTemplate.height,
        strokeWidth: textTemplate.strokeWidth,
        rotation: normalizeRotation(placement.rotation + localRotation),
        mirrored: placement.bottomLayer !== textTemplate.mirrored,
        horizontalAlignment: textTemplate.horizontalAlignment,
        verticalAlignment: textTemplate.verticalAlignment,
        reference: placement.reference,
        layer: textTemplate.layer,
        gerberLayer: getPhysicalDecalGerberLayer({
          sourceLayer: textTemplate.layer,
          pieceKind: "drawing",
          placement,
          layers,
          layerCount,
        }),
      })
    }
  }
}

const getPlacedPadPhysicalLayers = ({
  sourceLevel,
  bottomLayer,
  layerCount,
}: {
  sourceLevel: number
  bottomLayer: boolean
  layerCount: number
}): number[] => {
  if (sourceLevel === -2) return [bottomLayer ? layerCount : 1]
  if (sourceLevel === 0) return [bottomLayer ? 1 : layerCount]
  if (sourceLevel === -1) {
    return Array.from(
      { length: Math.max(0, layerCount - 2) },
      (_, index) => index + 2,
    )
  }
  if (sourceLevel < 1 || sourceLevel > layerCount) return []
  return [bottomLayer ? layerCount + 1 - sourceLevel : sourceLevel]
}

const addPlacedPartPads = ({
  placements,
  definitions,
  netNameByTerminal,
  layerCount,
  pads,
  holes,
  thermalReliefs,
  antipads,
  diagnostics,
}: {
  placements: PadsGeometryPlacement[]
  definitions: Map<string, AsciiPartDecalDefinition>
  netNameByTerminal: Map<string, string>
  layerCount: number
  pads: PadsGeometryPad[]
  holes: PadsGeometryHole[]
  thermalReliefs: PadsGeometryThermalRelief[]
  antipads: PadsGeometryAntipad[]
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
      const terminalCenter = transformDecalPoint({
        point: terminal.location,
        placement,
      })
      const netName = netNameByTerminal.get(
        `${placement.reference}\0${terminal.pinNumber}`,
      )
      for (const reliefLayer of padStack.layers) {
        const physicalLayers = getPlacedPadPhysicalLayers({
          sourceLevel: reliefLayer.sourceLevel,
          bottomLayer: placement.bottomLayer,
          layerCount,
        })
        if (reliefLayer.thermal) {
          const shape = reliefLayer.shapeCode === "RT" ? "circle" : "square"
          const localRotation = placement.bottomLayer
            ? 180 - reliefLayer.orientation
            : reliefLayer.orientation
          for (const layer of physicalLayers) {
            thermalReliefs.push({
              source: reliefLayer.source ?? terminal.source,
              center: terminalCenter,
              layer,
              shape,
              rotation: normalizeRotation(placement.rotation + localRotation),
              innerDiameter: reliefLayer.size,
              outerDiameter: reliefLayer.thermal.outerDiameter,
              spokeWidth: reliefLayer.thermal.spokeWidth,
              spokeCount: reliefLayer.thermal.spokeCount,
              reference: placement.reference,
              pinNumber: terminal.pinNumber,
              decalName,
              netName,
            })
          }
        } else if (
          reliefLayer.shapeCode === "RA" ||
          reliefLayer.shapeCode === "SA"
        ) {
          const shape = reliefLayer.shapeCode === "RA" ? "circle" : "square"
          for (const layer of physicalLayers) {
            antipads.push({
              source: reliefLayer.source ?? terminal.source,
              center: terminalCenter,
              layer,
              shape,
              diameter: reliefLayer.size,
              reference: placement.reference,
              pinNumber: terminal.pinNumber,
              decalName,
              netName,
            })
          }
        }
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
          source: drillLayer.source ?? terminal.source,
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
          netName,
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
        source: padLayer.source ?? terminal.source,
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
        netName,
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

const getNetNamesByTerminal = ({
  sections,
  placements,
  diagnostics,
}: {
  sections: AsciiSectionLines[]
  placements: PadsGeometryPlacement[]
  diagnostics: string[]
}): Map<string, string> => {
  const references = new Set(placements.map(({ reference }) => reference))
  const netNameByTerminal = new Map<string, string>()
  let conflictingTerminalCount = 0

  for (const section of sections) {
    if (section.name !== "NET" && section.name !== "ROUTE") continue
    let netName: string | undefined
    for (const lineText of section.lines) {
      const signalMatch = /^\*SIGNAL\*\s*(\S*)/u.exec(lineText.trim())
      if (signalMatch) {
        netName = signalMatch[1] || undefined
        continue
      }
      if (!netName || lineText.trimStart().startsWith("*")) continue

      for (const token of tokenizeLine(lineText)) {
        const separatorIndex = token.lastIndexOf(".")
        if (separatorIndex <= 0 || separatorIndex >= token.length - 1) {
          continue
        }
        const reference = token.slice(0, separatorIndex)
        const pinNumber = token.slice(separatorIndex + 1)
        if (!references.has(reference)) continue

        const terminalKey = `${reference}\0${pinNumber}`
        const existingNetName = netNameByTerminal.get(terminalKey)
        if (existingNetName && existingNetName !== netName) {
          conflictingTerminalCount++
          continue
        }
        netNameByTerminal.set(terminalKey, netName)
      }
    }
  }

  if (conflictingTerminalCount > 0) {
    diagnostics.push(
      `${conflictingTerminalCount} ASCII component terminals are assigned to conflicting nets`,
    )
  }
  return netNameByTerminal
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
  if (document.units === "unknown") {
    throw new RangeError(
      "Cannot extract geometry with unknown PADS ASCII units",
    )
  }
  const sections = collectTopLevelSections(document)
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
  const thermalReliefs: PadsGeometryThermalRelief[] = []
  const antipads: PadsGeometryAntipad[] = []
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
        thermalReliefs,
        antipads,
        unverifiedViaLocations,
        diagnostics,
      })
    } else if (section.name === "TEXT") {
      addTextSectionGeometry(section, texts, layers, layerCount)
    } else if (section.name === "PART") {
      addPartSectionGeometry({
        section,
        decalNamesByPartType,
        placements,
        texts,
        layerCount,
        version: document.version,
      })
    }
  }
  const netNameByTerminal = getNetNamesByTerminal({
    sections,
    placements,
    diagnostics,
  })
  addPlacedPartPads({
    placements,
    definitions: partDecalDefinitions,
    netNameByTerminal,
    layerCount,
    pads,
    holes,
    thermalReliefs,
    antipads,
    diagnostics,
  })
  addPlacedPartGraphics({
    placements,
    definitions: partDecalDefinitions,
    layers,
    layerCount,
    paths,
    circles,
    texts,
  })

  return normalizeGeometryUnits({
    sourceUnits: document.units,
    geometry: {
      sourceFormat: "ascii",
      documentSource: getPadsDocumentSourceProvenance(document),
      version: document.version,
      sourceUnits: document.units,
      coordinateUnit: "nanometer",
      layerCount,
      layers,
      paths,
      circles,
      texts,
      placements,
      pads,
      holes,
      thermalReliefs,
      antipads,
      unassignedVertices: [],
      unverifiedConnections: [],
      unverifiedViaLocations,
      binarySections: [],
      diagnostics,
    },
  })
}

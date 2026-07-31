import {
  extractPadsBoardGeometry,
  type PadsBinarySectionSummary,
  type PadsBoardGeometry,
  type PadsGeometryCircle,
  type PadsGeometryPath,
  type PadsGeometryPathSegment,
  type PadsGeometryPoint,
} from "../geometry"
import { type PadsDocument, parsePads } from "../parse-pads"

export interface GeneratePadsSvgOptions {
  width?: number
  height?: number
  backgroundColor?: string
  boardColor?: string
  drillColor?: string
  gerberLayerColors?: Partial<Record<string, string>>
  visibleGerberLayers?: string[]
  showBinarySectionSummary?: boolean
  showUnverifiedConnections?: boolean
  showUnassignedVertices?: boolean
  showPlacements?: boolean
  showText?: boolean
}

export type PadsSvgInput = PadsDocument | string | Uint8Array

interface GeometryBounds {
  minimumX: number
  minimumY: number
  maximumX: number
  maximumY: number
}

interface RenderContext {
  geometry: PadsBoardGeometry
  bounds: GeometryBounds
  minimumFeatureSize: number
  boardClipAttribute: string
  drillColor: string
  layerColors: Record<string, string>
  visibleGerberLayers?: Set<string>
}

interface ViaAperture {
  id: string
  radius: number
  drillRadius: number
}

const DEFAULT_GERBER_LAYER_COLORS: Record<string, string> = {
  F_Cu: "#c83434",
  In1_Cu: "#7fc97f",
  In2_Cu: "#ce7d2c",
  In3_Cu: "#7f7fc9",
  In4_Cu: "#c97f7f",
  In5_Cu: "#7fc9c9",
  In6_Cu: "#c9c97f",
  In7_Cu: "#c97fc9",
  In8_Cu: "#7fa8c9",
  B_Cu: "#4d7fc4",
  F_Silkscreen: "#f3f3f3",
  B_Silkscreen: "#d6d6d6",
  Edge_Cuts: "#d8d8d8",
  Dwgs_User: "#8b9bb4",
  Keepout: "#d36ba6",
  Debug_Vertices: "#9ca3af",
  Debug_Connections: "#56cfe1",
}

const escapeXml = (sourceText: string): string =>
  sourceText
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")

const formatNumber = (numberToFormat: number): string => {
  const roundedNumber = Math.round(numberToFormat * 1000) / 1000
  return Object.is(roundedNumber, -0) ? "0" : String(roundedNumber)
}

const isFinitePoint = (point: PadsGeometryPoint): boolean =>
  Number.isFinite(point.x) &&
  Number.isFinite(point.y) &&
  Math.abs(point.x) < 1e12 &&
  Math.abs(point.y) < 1e12

const normalizeDegrees = (angle: number): number => ((angle % 360) + 360) % 360

const angleIsWithinArcSweep = ({
  angle,
  startAngle,
  deltaAngle,
}: {
  angle: number
  startAngle: number
  deltaAngle: number
}): boolean => {
  if (Math.abs(deltaAngle) >= 360 - 1e-9) return true
  const sweptAngle =
    deltaAngle >= 0
      ? normalizeDegrees(angle - startAngle)
      : normalizeDegrees(startAngle - angle)
  return sweptAngle <= Math.abs(deltaAngle) + 1e-9
}

const getArcExtentPoints = (
  segment: Extract<PadsGeometryPathSegment, { kind: "arc" }>,
): PadsGeometryPoint[] => {
  const points = [segment.start, segment.end]
  for (const cardinalAngle of [0, 90, 180, 270]) {
    if (
      !angleIsWithinArcSweep({
        angle: cardinalAngle,
        startAngle: segment.startAngle,
        deltaAngle: segment.deltaAngle,
      })
    ) {
      continue
    }
    const angleRadians = (cardinalAngle * Math.PI) / 180
    points.push({
      x: segment.center.x + segment.radius * Math.cos(angleRadians),
      y: segment.center.y + segment.radius * Math.sin(angleRadians),
    })
  }
  return points
}

const getPathPoints = (
  geometry: PadsBoardGeometry,
  includedKinds: Set<PadsGeometryPath["kind"]>,
): PadsGeometryPoint[] => {
  const points: PadsGeometryPoint[] = []
  for (const path of geometry.paths) {
    if (!includedKinds.has(path.kind)) continue
    for (const point of path.points) {
      if (isFinitePoint(point)) points.push(point)
    }
    for (const segment of path.segments ?? []) {
      if (segment.kind !== "arc" || !isFinitePoint(segment.center)) continue
      points.push(...getArcExtentPoints(segment).filter(isFinitePoint))
    }
  }
  return points
}

const getPreferredBoundPoints = (
  geometry: PadsBoardGeometry,
): { points: PadsGeometryPoint[]; trimOutliers: boolean } => {
  const outlinePoints = getPathPoints(geometry, new Set(["outline"]))
  if (outlinePoints.length >= 3) {
    return { points: outlinePoints, trimOutliers: false }
  }

  const placementPoints = geometry.placements
    .map((placement) => placement.location)
    .filter(isFinitePoint)
  if (placementPoints.length >= 3) {
    return { points: placementPoints, trimOutliers: true }
  }

  const physicalPoints = getPathPoints(
    geometry,
    new Set(["route", "copper", "keepout"]),
  )
  for (const circle of geometry.circles) {
    if (circle.kind === "drawing" || !isFinitePoint(circle.center)) continue
    physicalPoints.push(
      {
        x: circle.center.x - circle.radius,
        y: circle.center.y - circle.radius,
      },
      {
        x: circle.center.x + circle.radius,
        y: circle.center.y + circle.radius,
      },
    )
  }
  if (physicalPoints.length >= 2) {
    return { points: physicalPoints, trimOutliers: true }
  }

  const textPoints = geometry.texts
    .map((text) => text.location)
    .filter(isFinitePoint)
  if (textPoints.length >= 2) {
    return { points: textPoints, trimOutliers: true }
  }

  const drawingPoints = getPathPoints(geometry, new Set(["drawing"]))
  if (drawingPoints.length >= 2) {
    return { points: drawingPoints, trimOutliers: true }
  }

  return {
    points: geometry.unassignedVertices.filter(isFinitePoint),
    trimOutliers: true,
  }
}

const getBounds = (geometry: PadsBoardGeometry): GeometryBounds => {
  const { points, trimOutliers } = getPreferredBoundPoints(geometry)
  if (points.length === 0) {
    return { minimumX: -1, minimumY: -1, maximumX: 1, maximumY: 1 }
  }

  const sortedX = points.map((point) => point.x).sort((a, b) => a - b)
  const sortedY = points.map((point) => point.y).sort((a, b) => a - b)
  const trimRatio = trimOutliers && points.length >= 50 ? 0.02 : 0
  const minimumIndex = Math.floor((points.length - 1) * trimRatio)
  const maximumIndex = Math.ceil((points.length - 1) * (1 - trimRatio))
  const minimumX = sortedX[minimumIndex] ?? -1
  const minimumY = sortedY[minimumIndex] ?? -1
  const maximumX = sortedX[maximumIndex] ?? 1
  const maximumY = sortedY[maximumIndex] ?? 1
  const rawWidth = maximumX - minimumX
  const rawHeight = maximumY - minimumY
  const padding = Math.max(rawWidth, rawHeight, 1) * 0.035

  return {
    minimumX: minimumX - padding,
    minimumY: minimumY - padding,
    maximumX: maximumX + padding,
    maximumY: maximumY + padding,
  }
}

const pointInsideBounds = ({
  point,
  bounds,
}: {
  point: PadsGeometryPoint
  bounds: GeometryBounds
}): boolean =>
  point.x >= bounds.minimumX &&
  point.x <= bounds.maximumX &&
  point.y >= bounds.minimumY &&
  point.y <= bounds.maximumY

const getSegmentPathData = (
  segments: PadsGeometryPathSegment[],
  closed: boolean,
): string => {
  const firstSegment = segments[0]
  if (!firstSegment || !isFinitePoint(firstSegment.start)) return ""

  const commands = [
    `M ${formatNumber(firstSegment.start.x)} ${formatNumber(firstSegment.start.y)}`,
  ]
  let currentPoint = firstSegment.start
  for (const segment of segments) {
    if (!isFinitePoint(segment.start) || !isFinitePoint(segment.end)) continue
    if (
      Math.abs(currentPoint.x - segment.start.x) >= 1e-6 ||
      Math.abs(currentPoint.y - segment.start.y) >= 1e-6
    ) {
      commands.push(
        `L ${formatNumber(segment.start.x)} ${formatNumber(segment.start.y)}`,
      )
    }

    if (segment.kind === "line") {
      commands.push(
        `L ${formatNumber(segment.end.x)} ${formatNumber(segment.end.y)}`,
      )
    } else {
      if (Math.abs(segment.deltaAngle) >= 360 - 1e-9) {
        const startAngleRadians = (segment.startAngle * Math.PI) / 180
        const oppositePoint = {
          x: segment.center.x - segment.radius * Math.cos(startAngleRadians),
          y: segment.center.y - segment.radius * Math.sin(startAngleRadians),
        }
        const sweepFlag = segment.deltaAngle >= 0 ? 1 : 0
        commands.push(
          `A ${formatNumber(segment.radius)} ${formatNumber(segment.radius)} 0 1 ${sweepFlag} ${formatNumber(oppositePoint.x)} ${formatNumber(oppositePoint.y)}`,
          `A ${formatNumber(segment.radius)} ${formatNumber(segment.radius)} 0 1 ${sweepFlag} ${formatNumber(segment.end.x)} ${formatNumber(segment.end.y)}`,
        )
        currentPoint = segment.end
        continue
      }
      const largeArcFlag = Math.abs(segment.deltaAngle) > 180 ? 1 : 0
      const sweepFlag = segment.deltaAngle >= 0 ? 1 : 0
      commands.push(
        `A ${formatNumber(segment.radius)} ${formatNumber(segment.radius)} 0 ${largeArcFlag} ${sweepFlag} ${formatNumber(segment.end.x)} ${formatNumber(segment.end.y)}`,
      )
    }
    currentPoint = segment.end
  }

  if (closed) commands.push("Z")
  return commands.join(" ")
}

const getPathData = (path: PadsGeometryPath): string => {
  if (path.segments && path.segments.length > 0) {
    return getSegmentPathData(path.segments, path.closed)
  }

  const finitePoints = path.points.filter(isFinitePoint)
  if (finitePoints.length === 0) return ""
  const commands = finitePoints.map(
    (point, pointIndex) =>
      `${pointIndex === 0 ? "M" : "L"} ${formatNumber(point.x)} ${formatNumber(point.y)}`,
  )
  if (path.closed && finitePoints.length >= 3) commands.push("Z")
  return commands.join(" ")
}

const getLayerInfoName = (
  geometry: PadsBoardGeometry,
  layer: number,
): string | undefined =>
  geometry.layers.find((layerInfo) => layerInfo.number === layer)?.name

const getGerberCopperLayerName = ({
  geometry,
  layer,
}: {
  geometry: PadsBoardGeometry
  layer: number | string | undefined
}): string => {
  if (typeof layer === "string") {
    const normalizedLayer = layer.toUpperCase().replaceAll(".", "_")
    if (normalizedLayer.includes("BOTTOM") || normalizedLayer === "B_CU") {
      return "B_Cu"
    }
    if (normalizedLayer.includes("TOP") || normalizedLayer === "F_CU") {
      return "F_Cu"
    }
  }

  const numericLayer =
    typeof layer === "number" && Number.isFinite(layer) ? Math.trunc(layer) : 1
  const layerInfoName = getLayerInfoName(geometry, numericLayer)?.toUpperCase()
  if (layerInfoName?.includes("BOTTOM")) return "B_Cu"
  if (layerInfoName?.includes("TOP")) return "F_Cu"
  if (numericLayer <= 1) return "F_Cu"
  if (numericLayer >= geometry.layerCount) return "B_Cu"
  return `In${numericLayer - 1}_Cu`
}

const getLayerColor = ({
  layerName,
  layerColors,
}: {
  layerName: string
  layerColors: Record<string, string>
}): string => {
  const exactColor = layerColors[layerName]
  if (exactColor) return exactColor

  const internalLayerMatch = /^In(\d+)_Cu$/u.exec(layerName)
  if (internalLayerMatch) {
    const internalLayerNumber = Number(internalLayerMatch[1])
    const paletteIndex = ((internalLayerNumber - 1) % 8) + 1
    return layerColors[`In${paletteIndex}_Cu`] ?? "#cccccc"
  }

  return "#cccccc"
}

const shouldRenderLayer = (
  context: RenderContext,
  layerName: string,
): boolean =>
  context.visibleGerberLayers === undefined ||
  context.visibleGerberLayers.has(layerName)

const getMetadataAttributes = ({
  kind,
  layer,
  name,
  netName,
}: {
  kind: string
  layer?: number | string
  name?: string
  netName?: string
}): string =>
  [
    `data-kind="${escapeXml(kind)}"`,
    layer !== undefined ? `data-pads-layer="${escapeXml(String(layer))}"` : "",
    name ? `data-name="${escapeXml(name)}"` : "",
    netName ? `data-net="${escapeXml(netName)}"` : "",
  ]
    .filter(Boolean)
    .join(" ")

const getRenderedStrokeWidth = ({
  sourceWidth,
  minimumFeatureSize,
  kind,
}: {
  sourceWidth: number
  minimumFeatureSize: number
  kind: PadsGeometryPath["kind"]
}): number => {
  const kindMinimum =
    kind === "outline"
      ? minimumFeatureSize * 1.6
      : kind === "drawing"
        ? minimumFeatureSize
        : minimumFeatureSize * 0.8
  return Math.max(Math.abs(sourceWidth), kindMinimum)
}

const renderCopperPaths = (context: RenderContext): string => {
  const pathsByLayer = new Map<string, PadsGeometryPath[]>()
  for (const path of context.geometry.paths) {
    if (path.kind !== "route" && path.kind !== "copper") continue
    const layerName = getGerberCopperLayerName({
      geometry: context.geometry,
      layer: path.layer,
    })
    const layerPaths = pathsByLayer.get(layerName) ?? []
    layerPaths.push(path)
    pathsByLayer.set(layerName, layerPaths)
  }

  return [...pathsByLayer.entries()]
    .map(([layerName, paths]) => {
      if (!shouldRenderLayer(context, layerName)) return ""
      const color = getLayerColor({
        layerName,
        layerColors: context.layerColors,
      })
      const pathElements = paths
        .map((path) => {
          const pathData = getPathData(path)
          if (!pathData) return ""
          const strokeWidth = getRenderedStrokeWidth({
            sourceWidth: path.width,
            minimumFeatureSize: context.minimumFeatureSize,
            kind: path.kind,
          })
          const fill =
            path.kind === "copper" && path.closed ? "currentColor" : "none"
          return `<path ${getMetadataAttributes(path)} d="${pathData}" fill="${fill}" stroke="currentColor" stroke-width="${formatNumber(strokeWidth)}"/>`
        })
        .join("")

      return `<g id="pads-${layerName}" data-gerber-layer="${layerName}" color="${color}" fill="currentColor" stroke="currentColor"${context.boardClipAttribute}>${pathElements}</g>`
    })
    .join("")
}

const getViaDrillRadius = (
  circle: PadsGeometryCircle,
  minimumFeatureSize: number,
): number => {
  const outerRadius = Math.max(
    Math.abs(circle.radius),
    minimumFeatureSize * 1.8,
  )
  const annularWidth = Math.max(
    Math.min(Math.abs(circle.width), outerRadius * 0.55),
    minimumFeatureSize * 0.65,
  )
  return Math.max(outerRadius - annularWidth, outerRadius * 0.38)
}

const getViaApertures = (
  geometry: PadsBoardGeometry,
  minimumFeatureSize: number,
): {
  apertures: ViaAperture[]
  apertureByCircle: Map<PadsGeometryCircle, ViaAperture>
} => {
  const apertureByKey = new Map<string, ViaAperture>()
  const apertureByCircle = new Map<PadsGeometryCircle, ViaAperture>()

  for (const circle of geometry.circles) {
    if (circle.kind !== "via") continue
    const radius = Math.max(Math.abs(circle.radius), minimumFeatureSize * 1.8)
    const drillRadius = getViaDrillRadius(circle, minimumFeatureSize)
    const apertureKey = `${formatNumber(radius)}:${formatNumber(drillRadius)}`
    let aperture = apertureByKey.get(apertureKey)
    if (!aperture) {
      aperture = {
        id: `pads-via-aperture-${apertureByKey.size + 1}`,
        radius,
        drillRadius,
      }
      apertureByKey.set(apertureKey, aperture)
    }
    apertureByCircle.set(circle, aperture)
  }

  return { apertures: [...apertureByKey.values()], apertureByCircle }
}

const renderApertureDefinitions = (apertures: ViaAperture[]): string =>
  apertures
    .map(
      (aperture) =>
        `<circle id="${aperture.id}" cx="0" cy="0" r="${formatNumber(aperture.radius)}"/>`,
    )
    .join("")

const renderCopperCircles = ({
  context,
  apertureByCircle,
}: {
  context: RenderContext
  apertureByCircle: Map<PadsGeometryCircle, ViaAperture>
}): string => {
  const circlesByLayer = new Map<string, PadsGeometryCircle[]>()
  for (const circle of context.geometry.circles) {
    if (circle.kind !== "via" && circle.kind !== "copper") continue
    const layerName = getGerberCopperLayerName({
      geometry: context.geometry,
      layer: circle.layer,
    })
    const layerCircles = circlesByLayer.get(layerName) ?? []
    layerCircles.push(circle)
    circlesByLayer.set(layerName, layerCircles)
  }

  return [...circlesByLayer.entries()]
    .map(([layerName, circles]) => {
      if (!shouldRenderLayer(context, layerName)) return ""
      const color = getLayerColor({
        layerName,
        layerColors: context.layerColors,
      })
      const circleElements = circles
        .map((circle) => {
          const attributes = getMetadataAttributes(circle)
          if (circle.kind === "via") {
            const aperture = apertureByCircle.get(circle)
            if (!aperture) return ""
            return `<use ${attributes} xlink:href="#${aperture.id}" href="#${aperture.id}" x="${formatNumber(circle.center.x)}" y="${formatNumber(circle.center.y)}"/>`
          }

          const radius = Math.max(
            Math.abs(circle.radius),
            context.minimumFeatureSize,
          )
          return `<circle ${attributes} cx="${formatNumber(circle.center.x)}" cy="${formatNumber(circle.center.y)}" r="${formatNumber(radius)}" fill="currentColor" stroke="currentColor"/>`
        })
        .join("")

      return `<g id="pads-${layerName}-flashes" data-gerber-layer="${layerName}" color="${color}" fill="currentColor" stroke="currentColor"${context.boardClipAttribute}>${circleElements}</g>`
    })
    .join("")
}

const renderDrills = ({
  context,
  apertureByCircle,
}: {
  context: RenderContext
  apertureByCircle: Map<PadsGeometryCircle, ViaAperture>
}): string => {
  if (!shouldRenderLayer(context, "Drill")) return ""
  const drillElements = context.geometry.circles
    .filter((circle) => circle.kind === "via")
    .map((circle) => {
      const aperture = apertureByCircle.get(circle)
      if (!aperture) return ""
      return `<circle data-kind="drill" cx="${formatNumber(circle.center.x)}" cy="${formatNumber(circle.center.y)}" r="${formatNumber(aperture.drillRadius)}"/>`
    })
    .join("")

  if (!drillElements) return ""
  return `<g id="pads-Drill" data-gerber-layer="Drill" fill="${escapeXml(context.drillColor)}" stroke="none"${context.boardClipAttribute}>${drillElements}</g>`
}

const renderDrawingGeometry = (context: RenderContext): string => {
  if (!shouldRenderLayer(context, "Dwgs_User")) return ""
  const drawingPaths = context.geometry.paths
    .filter((path) => path.kind === "drawing")
    .map((path) => {
      const pathData = getPathData(path)
      if (!pathData) return ""
      const strokeWidth = getRenderedStrokeWidth({
        sourceWidth: path.width,
        minimumFeatureSize: context.minimumFeatureSize,
        kind: path.kind,
      })
      return `<path ${getMetadataAttributes(path)} d="${pathData}" fill="none" stroke="currentColor" stroke-width="${formatNumber(strokeWidth)}"/>`
    })
    .join("")

  const drawingCircles = context.geometry.circles
    .filter((circle) => circle.kind === "drawing")
    .map((circle) => {
      const radius = Math.max(
        Math.abs(circle.radius),
        context.minimumFeatureSize,
      )
      const strokeWidth = Math.max(
        Math.abs(circle.width),
        context.minimumFeatureSize,
      )
      return `<circle ${getMetadataAttributes(circle)} cx="${formatNumber(circle.center.x)}" cy="${formatNumber(circle.center.y)}" r="${formatNumber(radius)}" fill="none" stroke="currentColor" stroke-width="${formatNumber(strokeWidth)}"/>`
    })
    .join("")

  if (!drawingPaths && !drawingCircles) return ""
  const color = getLayerColor({
    layerName: "Dwgs_User",
    layerColors: context.layerColors,
  })
  return `<g id="pads-Dwgs_User" data-gerber-layer="Dwgs_User" color="${color}" fill="currentColor" stroke="currentColor"${context.boardClipAttribute}>${drawingPaths}${drawingCircles}</g>`
}

const renderKeepouts = (context: RenderContext): string => {
  if (!shouldRenderLayer(context, "Keepout")) return ""
  const keepoutPaths = context.geometry.paths
    .filter((path) => path.kind === "keepout")
    .map((path) => {
      const pathData = getPathData(path)
      if (!pathData) return ""
      const strokeWidth = getRenderedStrokeWidth({
        sourceWidth: path.width,
        minimumFeatureSize: context.minimumFeatureSize,
        kind: path.kind,
      })
      return `<path ${getMetadataAttributes(path)} d="${pathData}" fill="none" stroke="currentColor" stroke-width="${formatNumber(strokeWidth)}" stroke-dasharray="${formatNumber(strokeWidth * 4)} ${formatNumber(strokeWidth * 3)}"/>`
    })
    .join("")

  const keepoutCircles = context.geometry.circles
    .filter((circle) => circle.kind === "keepout")
    .map((circle) => {
      const radius = Math.max(
        Math.abs(circle.radius),
        context.minimumFeatureSize,
      )
      const strokeWidth = Math.max(
        Math.abs(circle.width),
        context.minimumFeatureSize,
      )
      return `<circle ${getMetadataAttributes(circle)} cx="${formatNumber(circle.center.x)}" cy="${formatNumber(circle.center.y)}" r="${formatNumber(radius)}" fill="none" stroke="currentColor" stroke-width="${formatNumber(strokeWidth)}" stroke-dasharray="${formatNumber(strokeWidth * 4)} ${formatNumber(strokeWidth * 3)}"/>`
    })
    .join("")

  if (!keepoutPaths && !keepoutCircles) return ""
  const color = getLayerColor({
    layerName: "Keepout",
    layerColors: context.layerColors,
  })
  return `<g id="pads-Keepout" data-gerber-layer="Keepout" color="${color}" fill="currentColor" stroke="currentColor">${keepoutPaths}${keepoutCircles}</g>`
}

const renderPlacements = (context: RenderContext): string => {
  const markerRadius = context.minimumFeatureSize * 3.5
  const fontSize = context.minimumFeatureSize * 6
  const topPlacements: string[] = []
  const bottomPlacements: string[] = []

  for (const placement of context.geometry.placements.slice(0, 1500)) {
    if (!isFinitePoint(placement.location)) continue
    const element = `<g data-kind="placement" data-reference="${escapeXml(placement.reference)}" transform="translate(${formatNumber(placement.location.x)} ${formatNumber(placement.location.y)}) rotate(${formatNumber(placement.rotation)})"><path d="M ${formatNumber(-markerRadius)} 0 L ${formatNumber(markerRadius)} 0 M 0 ${formatNumber(-markerRadius)} L 0 ${formatNumber(markerRadius)}" fill="none" stroke="currentColor" stroke-width="${formatNumber(context.minimumFeatureSize)}"/><text x="${formatNumber(markerRadius * 1.4)}" y="${formatNumber(-markerRadius)}" transform="scale(1,-1)" fill="currentColor" stroke="none" font-family="monospace" font-size="${formatNumber(fontSize)}">${escapeXml(placement.reference)}</text></g>`
    ;(placement.bottomLayer ? bottomPlacements : topPlacements).push(element)
  }

  const renderPlacementLayer = ({
    layerName,
    elements,
  }: {
    layerName: "F_Silkscreen" | "B_Silkscreen"
    elements: string[]
  }): string => {
    if (elements.length === 0 || !shouldRenderLayer(context, layerName)) {
      return ""
    }
    const color = getLayerColor({
      layerName,
      layerColors: context.layerColors,
    })
    return `<g id="pads-${layerName}-placements" data-gerber-layer="${layerName}" color="${color}" fill="currentColor" stroke="currentColor"${context.boardClipAttribute}>${elements.join("")}</g>`
  }

  return (
    renderPlacementLayer({
      layerName: "F_Silkscreen",
      elements: topPlacements,
    }) +
    renderPlacementLayer({
      layerName: "B_Silkscreen",
      elements: bottomPlacements,
    })
  )
}

const renderTexts = (context: RenderContext): string => {
  if (!shouldRenderLayer(context, "F_Silkscreen")) return ""
  const textElements = context.geometry.texts
    .slice(0, 2000)
    .map((text) => {
      if (!isFinitePoint(text.location)) return ""
      const fontSize = Math.max(
        Math.abs(text.height),
        context.minimumFeatureSize * 5,
      )
      const strokeWidth = Math.max(
        Math.abs(text.strokeWidth),
        context.minimumFeatureSize * 0.5,
      )
      const mirrorScale = text.mirrored ? -1 : 1
      return `<text data-kind="board-text" data-pads-layer="${escapeXml(String(text.layer ?? ""))}" x="0" y="0" transform="translate(${formatNumber(text.location.x)} ${formatNumber(text.location.y)}) rotate(${formatNumber(text.rotation)}) scale(${mirrorScale},-1)" fill="currentColor" stroke="currentColor" stroke-width="${formatNumber(strokeWidth * 0.15)}" font-family="monospace" font-size="${formatNumber(fontSize)}">${escapeXml(text.content)}</text>`
    })
    .join("")

  if (!textElements) return ""
  const color = getLayerColor({
    layerName: "F_Silkscreen",
    layerColors: context.layerColors,
  })
  return `<g id="pads-F_Silkscreen-text" data-gerber-layer="F_Silkscreen" color="${color}" fill="currentColor" stroke="currentColor"${context.boardClipAttribute}>${textElements}</g>`
}

const renderOutline = (context: RenderContext): string => {
  if (!shouldRenderLayer(context, "Edge_Cuts")) return ""
  const outlineElements = context.geometry.paths
    .filter((path) => path.kind === "outline")
    .map((path) => {
      const pathData = getPathData(path)
      if (!pathData) return ""
      const strokeWidth = getRenderedStrokeWidth({
        sourceWidth: path.width,
        minimumFeatureSize: context.minimumFeatureSize,
        kind: path.kind,
      })
      return `<path ${getMetadataAttributes(path)} d="${pathData}" fill="none" stroke="currentColor" stroke-width="${formatNumber(strokeWidth)}"/>`
    })
    .join("")

  if (!outlineElements) return ""
  const color = getLayerColor({
    layerName: "Edge_Cuts",
    layerColors: context.layerColors,
  })
  return `<g id="pads-Edge_Cuts" data-gerber-layer="Edge_Cuts" color="${color}" fill="currentColor" stroke="currentColor">${outlineElements}</g>`
}

const renderUnassignedVertices = (context: RenderContext): string => {
  if (!shouldRenderLayer(context, "Debug_Vertices")) return ""
  const pointRadius = context.minimumFeatureSize * 0.8
  const elements: string[] = []
  for (const point of context.geometry.unassignedVertices) {
    if (
      elements.length >= 2500 ||
      !isFinitePoint(point) ||
      !pointInsideBounds({ point, bounds: context.bounds })
    ) {
      continue
    }
    elements.push(
      `<circle data-kind="unassigned-vertex" cx="${formatNumber(point.x)}" cy="${formatNumber(point.y)}" r="${formatNumber(pointRadius)}"/>`,
    )
  }

  if (elements.length === 0) return ""
  const color = getLayerColor({
    layerName: "Debug_Vertices",
    layerColors: context.layerColors,
  })
  return `<g id="pads-Debug_Vertices" data-gerber-layer="Debug_Vertices" color="${color}" fill="currentColor" fill-opacity="0.4"${context.boardClipAttribute}>${elements.join("")}</g>`
}

const renderUnverifiedConnections = (context: RenderContext): string => {
  if (!shouldRenderLayer(context, "Debug_Connections")) return ""
  const strokeWidth = context.minimumFeatureSize * 0.75
  const connectionElements = context.geometry.unverifiedConnections
    .filter((path) =>
      path.points.every((point) =>
        pointInsideBounds({ point, bounds: context.bounds }),
      ),
    )
    .map((path) => {
      const pathData = getPathData(path)
      return pathData
        ? `<path data-kind="unverified-connection" d="${pathData}" fill="none" stroke="currentColor" stroke-width="${formatNumber(strokeWidth)}" stroke-dasharray="${formatNumber(strokeWidth * 5)} ${formatNumber(strokeWidth * 4)}"/>`
        : ""
    })
    .join("")
  const pointRadius = context.minimumFeatureSize * 1.1
  const viaElements = context.geometry.unverifiedViaLocations
    .filter((point) => pointInsideBounds({ point, bounds: context.bounds }))
    .map(
      (point) =>
        `<circle data-kind="unverified-via-location" cx="${formatNumber(point.x)}" cy="${formatNumber(point.y)}" r="${formatNumber(pointRadius)}"/>`,
    )
    .join("")
  if (!connectionElements && !viaElements) return ""

  const color = getLayerColor({
    layerName: "Debug_Connections",
    layerColors: context.layerColors,
  })
  return `<g id="pads-Debug_Connections" data-gerber-layer="Debug_Connections" color="${color}" fill="currentColor" fill-opacity="0.55" stroke="currentColor"${context.boardClipAttribute}>${connectionElements}${viaElements}</g>`
}

const renderBinarySectionSummary = ({
  sections,
  bounds,
  minimumFeatureSize,
}: {
  sections: PadsBinarySectionSummary[]
  bounds: GeometryBounds
  minimumFeatureSize: number
}): string => {
  if (sections.length === 0) return ""

  const panelWidth = (bounds.maximumX - bounds.minimumX) * 0.28
  const padding = minimumFeatureSize * 8
  const rowHeight = minimumFeatureSize * 7
  const panelHeight = padding * 2 + rowHeight * sections.length
  const panelX = bounds.maximumX - panelWidth
  const panelY = -bounds.maximumY
  const fontSize = minimumFeatureSize * 4
  const rows = sections
    .map(
      (section, sectionIndex) =>
        `<text x="${formatNumber(panelX + padding)}" y="${formatNumber(panelY + padding + rowHeight * (sectionIndex + 1))}" fill="#d1d5db" font-family="monospace" font-size="${formatNumber(fontSize)}">S${String(section.index).padStart(2, "0")} · ${section.recordCount} × ${formatNumber(section.bytesPerRecord)} B</text>`,
    )
    .join("")

  return `<g data-kind="binary-section-summary"><rect x="${formatNumber(panelX)}" y="${formatNumber(panelY)}" width="${formatNumber(panelWidth)}" height="${formatNumber(panelHeight)}" fill="#111111" fill-opacity="0.92"/><text x="${formatNumber(panelX + padding)}" y="${formatNumber(panelY + padding)}" fill="#f3f4f6" font-family="monospace" font-size="${formatNumber(fontSize)}" font-weight="700">BINARY SECTIONS</text>${rows}</g>`
}

const getDocument = (input: PadsSvgInput): PadsDocument =>
  typeof input === "string" || input instanceof Uint8Array
    ? parsePads(input)
    : input

export const generateSvgFromPadsGeometry = (
  geometry: PadsBoardGeometry,
  options: GeneratePadsSvgOptions = {},
): string => {
  const bounds = getBounds(geometry)
  const boundsWidth = Math.max(bounds.maximumX - bounds.minimumX, 1)
  const boundsHeight = Math.max(bounds.maximumY - bounds.minimumY, 1)
  const totalWidth = Math.max(1, options.width ?? 1200)
  const totalHeight = Math.max(
    1,
    options.height ??
      Math.min(2400, Math.max(240, (totalWidth * boundsHeight) / boundsWidth)),
  )
  const minimumFeatureSize = Math.max(
    boundsWidth / totalWidth,
    boundsHeight / totalHeight,
  )
  const layerColors = { ...DEFAULT_GERBER_LAYER_COLORS }
  for (const [layerName, layerColor] of Object.entries(
    options.gerberLayerColors ?? {},
  )) {
    if (layerColor) layerColors[layerName] = layerColor
  }
  const boardColor = options.boardColor ?? "#666666"
  const drillColor = options.drillColor ?? "#111111"
  const backgroundColor = options.backgroundColor ?? "#1b1b1b"
  const outlinePaths = geometry.paths.filter(
    (path) => path.kind === "outline" && path.points.length >= 3,
  )
  const boardClipAttribute =
    outlinePaths.length > 0 ? ' clip-path="url(#pads-board-outline)"' : ""
  const { apertures, apertureByCircle } = getViaApertures(
    geometry,
    minimumFeatureSize,
  )
  const context: RenderContext = {
    geometry,
    bounds,
    minimumFeatureSize,
    boardClipAttribute,
    drillColor,
    layerColors,
    visibleGerberLayers: options.visibleGerberLayers
      ? new Set(options.visibleGerberLayers)
      : undefined,
  }
  const outlineClipPaths = outlinePaths
    .map((path) => {
      const pathData = getPathData({ ...path, closed: true })
      return pathData ? `<path d="${pathData}"/>` : ""
    })
    .join("")
  const metadata = {
    sourceFormat: geometry.sourceFormat,
    version: geometry.version,
    layerCount: geometry.layerCount,
    diagnostics: geometry.diagnostics,
    visibleGerberLayers: options.visibleGerberLayers,
    counts: {
      paths: geometry.paths.length,
      circles: geometry.circles.length,
      placements: geometry.placements.length,
      texts: geometry.texts.length,
      unassignedVertices: geometry.unassignedVertices.length,
      unverifiedConnections: geometry.unverifiedConnections.length,
      unverifiedViaLocations: geometry.unverifiedViaLocations.length,
    },
  }

  return [
    '<svg version="1.1" xmlns="http://www.w3.org/2000/svg" ',
    'xmlns:xlink="http://www.w3.org/1999/xlink" ',
    'stroke-linecap="round" stroke-linejoin="round" stroke-width="0" ',
    'fill-rule="evenodd" clip-rule="evenodd" ',
    `viewBox="${formatNumber(bounds.minimumX)} ${formatNumber(-bounds.maximumY)} ${formatNumber(boundsWidth)} ${formatNumber(boundsHeight)}" `,
    `width="${formatNumber(totalWidth)}" height="${formatNumber(totalHeight)}" preserveAspectRatio="xMidYMid meet">`,
    `<title>PADS ${escapeXml(geometry.version)} Gerber-style board visualization</title>`,
    `<metadata>${escapeXml(JSON.stringify(metadata))}</metadata>`,
    "<defs>",
    outlineClipPaths
      ? `<clipPath id="pads-board-outline">${outlineClipPaths}</clipPath>`
      : "",
    renderApertureDefinitions(apertures),
    "</defs>",
    `<rect data-kind="negative-space" x="${formatNumber(bounds.minimumX)}" y="${formatNumber(-bounds.maximumY)}" width="${formatNumber(boundsWidth)}" height="${formatNumber(boundsHeight)}" fill="${escapeXml(backgroundColor)}"/>`,
    '<g transform="scale(1,-1)">',
    `<g id="pads-FR4"${boardClipAttribute}><rect x="${formatNumber(bounds.minimumX)}" y="${formatNumber(bounds.minimumY)}" width="${formatNumber(boundsWidth)}" height="${formatNumber(boundsHeight)}" fill="${escapeXml(boardColor)}"/></g>`,
    renderCopperPaths(context),
    renderCopperCircles({ context, apertureByCircle }),
    renderDrills({ context, apertureByCircle }),
    renderDrawingGeometry(context),
    renderKeepouts(context),
    options.showPlacements === false ? "" : renderPlacements(context),
    options.showText === false ? "" : renderTexts(context),
    options.showUnassignedVertices === true
      ? renderUnassignedVertices(context)
      : "",
    options.showUnverifiedConnections === true
      ? renderUnverifiedConnections(context)
      : "",
    renderOutline(context),
    "</g>",
    options.showBinarySectionSummary === true
      ? renderBinarySectionSummary({
          sections: geometry.binarySections,
          bounds,
          minimumFeatureSize,
        })
      : "",
    "</svg>",
  ].join("")
}

export const generateSvgFromPads = (
  input: PadsSvgInput,
  options: GeneratePadsSvgOptions = {},
): string =>
  generateSvgFromPadsGeometry(
    extractPadsBoardGeometry(getDocument(input)),
    options,
  )

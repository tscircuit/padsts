import {
  extractPadsBoardGeometry,
  type PadsBinarySectionSummary,
  type PadsBoardGeometry,
  type PadsGeometryCircle,
  type PadsGeometryHole,
  type PadsGeometryPad,
  type PadsGeometryPath,
  type PadsGeometryPathSegment,
  type PadsGeometryPoint,
  type PadsGeometryViaPad,
} from "../geometry"
import { type PadsDocument, parsePads } from "../parse-pads"
import { getPadsNanometersPerSourceUnit } from "../units"

export interface PadsSvgBoardViewBox {
  /** Minimum X coordinate in the PADS board coordinate system. */
  x: number
  /** Minimum Y coordinate in the PADS board coordinate system. */
  y: number
  width: number
  height: number
}

export interface GeneratePadsSvgOptions {
  width?: number
  height?: number
  /**
   * Optional zoom window in normalized nanometer coordinates by default.
   * `x` and `y` identify the lower-left corner before the renderer's global
   * SVG Y-axis flip.
   */
  viewBox?: PadsSvgBoardViewBox
  /**
   * Interpret `viewBox` in the document's original PADS coordinate units
   * instead of normalized nanometers.
   */
  viewBoxUnits?: "normalized" | "source"
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
  /**
   * Clip fabrication artwork to the decoded board outline. Disable this for
   * inspection windows that intentionally target staged or off-board parts.
   */
  clipArtworkToBoardOutline?: boolean
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
  artworkClipAttribute: string
  drillColor: string
  layerColors: Record<string, string>
  visibleGerberLayers?: Set<string>
}

interface ViaAperture {
  id: string
  radius: number
  drillRadius: number
  shape: "circle" | "square"
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
  F_Fab: "#d9a441",
  B_Fab: "#b88c3b",
  F_Mask: "#b35bb3",
  B_Mask: "#8f478f",
  F_Paste: "#aab7c4",
  B_Paste: "#8493a3",
  Drill_Drawing: "#81a1c1",
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
    const pathExtentPoints: PadsGeometryPoint[] = []
    for (const point of path.points) {
      if (isFinitePoint(point)) pathExtentPoints.push(point)
    }
    for (const segment of path.segments ?? []) {
      if (segment.kind !== "arc" || !isFinitePoint(segment.center)) continue
      pathExtentPoints.push(
        ...getArcExtentPoints(segment).filter(isFinitePoint),
      )
    }

    const halfStrokeWidth = Math.abs(path.width) / 2
    for (const point of pathExtentPoints) {
      points.push(point)
      if (
        !Number.isFinite(halfStrokeWidth) ||
        halfStrokeWidth <= 0 ||
        halfStrokeWidth >= 1e12
      ) {
        continue
      }
      points.push(
        {
          x: point.x - halfStrokeWidth,
          y: point.y - halfStrokeWidth,
        },
        {
          x: point.x + halfStrokeWidth,
          y: point.y + halfStrokeWidth,
        },
      )
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
  for (const pad of geometry.pads) {
    if (!isFinitePoint(pad.center)) continue
    const halfExtent = Math.hypot(pad.width, pad.height) / 2
    if (!Number.isFinite(halfExtent) || halfExtent <= 0) continue
    physicalPoints.push(
      {
        x: pad.center.x - halfExtent,
        y: pad.center.y - halfExtent,
      },
      {
        x: pad.center.x + halfExtent,
        y: pad.center.y + halfExtent,
      },
    )
  }
  for (const hole of geometry.holes) {
    if (!isFinitePoint(hole.center)) continue
    const halfExtent = Math.hypot(hole.width, hole.height) / 2
    if (!Number.isFinite(halfExtent) || halfExtent <= 0) continue
    physicalPoints.push(
      {
        x: hole.center.x - halfExtent,
        y: hole.center.y - halfExtent,
      },
      {
        x: hole.center.x + halfExtent,
        y: hole.center.y + halfExtent,
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

const getRequestedBounds = (viewBox: PadsSvgBoardViewBox): GeometryBounds => {
  const values = [viewBox.x, viewBox.y, viewBox.width, viewBox.height]
  if (
    !values.every(Number.isFinite) ||
    viewBox.width <= 0 ||
    viewBox.height <= 0
  ) {
    throw new RangeError(
      "SVG board-coordinate viewBox requires finite x/y and positive finite width/height",
    )
  }

  const maximumX = viewBox.x + viewBox.width
  const maximumY = viewBox.y + viewBox.height
  if (!Number.isFinite(maximumX) || !Number.isFinite(maximumY)) {
    throw new RangeError("SVG board-coordinate viewBox exceeds numeric range")
  }

  return {
    minimumX: viewBox.x,
    minimumY: viewBox.y,
    maximumX,
    maximumY,
  }
}

const normalizeRequestedViewBox = ({
  geometry,
  viewBox,
  viewBoxUnits,
}: {
  geometry: PadsBoardGeometry
  viewBox: PadsSvgBoardViewBox
  viewBoxUnits: NonNullable<GeneratePadsSvgOptions["viewBoxUnits"]>
}): PadsSvgBoardViewBox => {
  if (viewBoxUnits === "normalized") return viewBox

  const scale = getPadsNanometersPerSourceUnit(geometry.sourceUnits)
  if (scale === undefined) {
    throw new RangeError(
      "Cannot use source-coordinate SVG viewBox when PADS source units are unknown",
    )
  }

  return {
    x: viewBox.x * scale,
    y: viewBox.y * scale,
    width: viewBox.width * scale,
    height: viewBox.height * scale,
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

const getCopperMaskId = (layerName: string): string =>
  `pads-${layerName.replace(/[^A-Za-z0-9_.:-]+/gu, "-")}-polarity-mask`

const getCopperMaskAttribute = (
  context: RenderContext,
  layerName: string,
): string => {
  const hasNegativeGeometry =
    context.geometry.paths.some((path) => {
      if (path.kind !== "copper" || path.polarity !== "negative") return false
      return (
        (path.gerberLayer ??
          getGerberCopperLayerName({
            geometry: context.geometry,
            layer: path.layer,
          })) === layerName
      )
    }) ||
    context.geometry.circles.some((circle) => {
      if (circle.kind !== "copper" || circle.polarity !== "negative") {
        return false
      }
      return (
        (circle.gerberLayer ??
          getGerberCopperLayerName({
            geometry: context.geometry,
            layer: circle.layer,
          })) === layerName
      )
    })
  return hasNegativeGeometry
    ? ` mask="url(#${getCopperMaskId(layerName)})"`
    : ""
}

const getSvgEntityId = (id: string): string =>
  `pads-entity-${id.replace(/[^A-Za-z0-9_.:-]+/gu, "-")}`

const getMetadataAttributes = ({
  id,
  source,
  kind,
  layer,
  gerberLayer,
  name,
  netName,
  reference,
  decalName,
  sourcePieceKind,
  polarity,
  pinNumber,
  restrictions,
  groupId,
}: {
  id?: string
  source?: { sourceId: string }
  kind: string
  layer?: number | string
  gerberLayer?: string
  name?: string
  netName?: string
  reference?: string
  decalName?: string
  sourcePieceKind?: string
  polarity?: "positive" | "negative"
  pinNumber?: string
  restrictions?: string
  groupId?: string
}): string =>
  [
    id ? `id="${escapeXml(getSvgEntityId(id))}"` : "",
    source ? `data-source-id="${escapeXml(source.sourceId)}"` : "",
    `data-kind="${escapeXml(kind)}"`,
    layer !== undefined ? `data-pads-layer="${escapeXml(String(layer))}"` : "",
    gerberLayer ? `data-gerber-layer-name="${escapeXml(gerberLayer)}"` : "",
    name ? `data-name="${escapeXml(name)}"` : "",
    netName ? `data-net="${escapeXml(netName)}"` : "",
    reference ? `data-reference="${escapeXml(reference)}"` : "",
    decalName ? `data-decal="${escapeXml(decalName)}"` : "",
    sourcePieceKind
      ? `data-source-piece-kind="${escapeXml(sourcePieceKind)}"`
      : "",
    polarity ? `data-polarity="${polarity}"` : "",
    pinNumber ? `data-pin="${escapeXml(pinNumber)}"` : "",
    restrictions ? `data-restrictions="${escapeXml(restrictions)}"` : "",
    groupId ? `data-group="${escapeXml(groupId)}"` : "",
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
    if (
      (path.kind !== "route" && path.kind !== "copper") ||
      path.polarity === "negative"
    ) {
      continue
    }
    const layerName =
      path.gerberLayer ??
      getGerberCopperLayerName({
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

      return `<g id="pads-${layerName}" data-gerber-layer="${layerName}" color="${color}" fill="currentColor" stroke="currentColor"${getCopperMaskAttribute(context, layerName)}${context.artworkClipAttribute}>${pathElements}</g>`
    })
    .join("")
}

const getViaDrillRadius = (circle: PadsGeometryCircle): number | undefined => {
  if (
    circle.drillRadius !== undefined &&
    Number.isFinite(circle.drillRadius) &&
    circle.drillRadius > 0
  ) {
    return Math.abs(circle.drillRadius)
  }
  return undefined
}

const getViaApertures = (
  geometry: PadsBoardGeometry,
  minimumFeatureSize: number,
): {
  apertures: ViaAperture[]
  apertureByKey: Map<string, ViaAperture>
} => {
  const apertureByKey = new Map<string, ViaAperture>()

  for (const circle of geometry.circles) {
    if (circle.kind !== "via") continue
    const drillRadius = getViaDrillRadius(circle)
    if (drillRadius === undefined) continue
    for (const pad of getViaCopperPads({ circle, geometry })) {
      const radius = Math.max(Math.abs(pad.radius), minimumFeatureSize * 1.8)
      const apertureKey = getViaApertureKey({
        shape: pad.shape,
        radius,
        drillRadius,
      })
      if (!apertureByKey.has(apertureKey)) {
        apertureByKey.set(apertureKey, {
          id: `pads-via-aperture-${apertureByKey.size + 1}`,
          radius,
          drillRadius,
          shape: pad.shape,
        })
      }
    }
  }

  return { apertures: [...apertureByKey.values()], apertureByKey }
}

const renderApertureDefinitions = (apertures: ViaAperture[]): string =>
  apertures
    .map((aperture) =>
      aperture.shape === "square"
        ? `<rect id="${aperture.id}" x="${formatNumber(-aperture.radius)}" y="${formatNumber(-aperture.radius)}" width="${formatNumber(aperture.radius * 2)}" height="${formatNumber(aperture.radius * 2)}"/>`
        : `<circle id="${aperture.id}" cx="0" cy="0" r="${formatNumber(aperture.radius)}"/>`,
    )
    .join("")

const renderCopperPolarityMasks = (context: RenderContext): string => {
  const negativePathsByLayer = new Map<string, PadsGeometryPath[]>()
  const negativeCirclesByLayer = new Map<string, PadsGeometryCircle[]>()
  for (const path of context.geometry.paths) {
    if (path.kind !== "copper" || path.polarity !== "negative") continue
    const layerName =
      path.gerberLayer ??
      getGerberCopperLayerName({
        geometry: context.geometry,
        layer: path.layer,
      })
    const paths = negativePathsByLayer.get(layerName) ?? []
    paths.push(path)
    negativePathsByLayer.set(layerName, paths)
  }
  for (const circle of context.geometry.circles) {
    if (circle.kind !== "copper" || circle.polarity !== "negative") continue
    const layerName =
      circle.gerberLayer ??
      getGerberCopperLayerName({
        geometry: context.geometry,
        layer: circle.layer,
      })
    const circles = negativeCirclesByLayer.get(layerName) ?? []
    circles.push(circle)
    negativeCirclesByLayer.set(layerName, circles)
  }

  const layerNames = new Set([
    ...negativePathsByLayer.keys(),
    ...negativeCirclesByLayer.keys(),
  ])
  const width = context.bounds.maximumX - context.bounds.minimumX
  const height = context.bounds.maximumY - context.bounds.minimumY
  return [...layerNames]
    .map((layerName) => {
      const pathElements = (negativePathsByLayer.get(layerName) ?? [])
        .map((path) => {
          const pathData = getPathData(path)
          if (!pathData) return ""
          const strokeWidth = getRenderedStrokeWidth({
            sourceWidth: path.width,
            minimumFeatureSize: context.minimumFeatureSize,
            kind: path.kind,
          })
          return `<path ${getMetadataAttributes(path)} d="${pathData}" fill="${path.closed ? "black" : "none"}" stroke="black" stroke-width="${formatNumber(strokeWidth)}"/>`
        })
        .join("")
      const circleElements = (negativeCirclesByLayer.get(layerName) ?? [])
        .map(
          (circle) =>
            `<circle ${getMetadataAttributes(circle)} cx="${formatNumber(circle.center.x)}" cy="${formatNumber(circle.center.y)}" r="${formatNumber(Math.abs(circle.radius))}" fill="black" stroke="black" stroke-width="${formatNumber(Math.max(Math.abs(circle.width), context.minimumFeatureSize))}"/>`,
        )
        .join("")
      return `<mask id="${getCopperMaskId(layerName)}" maskUnits="userSpaceOnUse" x="${formatNumber(context.bounds.minimumX)}" y="${formatNumber(context.bounds.minimumY)}" width="${formatNumber(width)}" height="${formatNumber(height)}"><rect x="${formatNumber(context.bounds.minimumX)}" y="${formatNumber(context.bounds.minimumY)}" width="${formatNumber(width)}" height="${formatNumber(height)}" fill="white"/>${pathElements}${circleElements}</mask>`
    })
    .join("")
}

const getViaCopperPads = ({
  circle,
  geometry,
}: {
  circle: PadsGeometryCircle
  geometry: PadsBoardGeometry
}): PadsGeometryViaPad[] => {
  if (circle.copperPads !== undefined) {
    return circle.copperPads.filter(
      (pad) =>
        Number.isFinite(pad.layer) &&
        pad.layer >= 1 &&
        pad.layer <= geometry.layerCount &&
        Number.isFinite(pad.radius) &&
        pad.radius > 0,
    )
  }

  if (
    circle.kind !== "via" ||
    circle.startLayer === undefined ||
    circle.endLayer === undefined ||
    !Number.isFinite(circle.startLayer) ||
    !Number.isFinite(circle.endLayer)
  ) {
    const fallbackLayer =
      typeof circle.layer === "number" && Number.isFinite(circle.layer)
        ? Math.trunc(circle.layer)
        : 1
    return [
      {
        layer: fallbackLayer,
        radius: circle.radius,
        shape: circle.shape ?? "circle",
      },
    ]
  }

  const firstLayer = Math.max(
    1,
    Math.min(Math.trunc(circle.startLayer), Math.trunc(circle.endLayer)),
  )
  const lastLayer = Math.min(
    geometry.layerCount,
    Math.max(Math.trunc(circle.startLayer), Math.trunc(circle.endLayer)),
  )
  const pads: PadsGeometryViaPad[] = []
  for (let layer = firstLayer; layer <= lastLayer; layer++) {
    pads.push({
      layer,
      radius: circle.radius,
      shape: circle.shape ?? "circle",
    })
  }
  return pads.length > 0
    ? pads
    : [
        {
          layer:
            typeof circle.layer === "number" && Number.isFinite(circle.layer)
              ? Math.trunc(circle.layer)
              : 1,
          radius: circle.radius,
          shape: circle.shape ?? "circle",
        },
      ]
}

const getViaApertureKey = ({
  shape,
  radius,
  drillRadius,
}: {
  shape: PadsGeometryViaPad["shape"]
  radius: number
  drillRadius: number
}): string => `${shape}:${formatNumber(radius)}:${formatNumber(drillRadius)}`

interface CopperCircleFlash {
  circle: PadsGeometryCircle
  viaPad?: PadsGeometryViaPad
  aperture?: ViaAperture
}

const renderCopperCircles = ({
  context,
  apertureByKey,
}: {
  context: RenderContext
  apertureByKey: Map<string, ViaAperture>
}): string => {
  const flashesByLayer = new Map<string, CopperCircleFlash[]>()
  for (const circle of context.geometry.circles) {
    if (
      (circle.kind !== "via" && circle.kind !== "copper") ||
      circle.polarity === "negative"
    ) {
      continue
    }
    if (circle.kind === "copper") {
      const layerName =
        circle.gerberLayer ??
        getGerberCopperLayerName({
          geometry: context.geometry,
          layer: circle.layer,
        })
      if (!shouldRenderLayer(context, layerName)) continue
      const layerFlashes = flashesByLayer.get(layerName) ?? []
      layerFlashes.push({ circle })
      flashesByLayer.set(layerName, layerFlashes)
      continue
    }

    const renderedApertureIds = new Set<string>()
    const drillRadius = getViaDrillRadius(circle)
    if (drillRadius === undefined) continue
    for (const viaPad of getViaCopperPads({
      circle,
      geometry: context.geometry,
    })) {
      const layerName = getGerberCopperLayerName({
        geometry: context.geometry,
        layer: viaPad.layer,
      })
      if (!shouldRenderLayer(context, layerName)) continue
      const radius = Math.max(
        Math.abs(viaPad.radius),
        context.minimumFeatureSize * 1.8,
      )
      const aperture = apertureByKey.get(
        getViaApertureKey({
          shape: viaPad.shape,
          radius,
          drillRadius,
        }),
      )
      if (!aperture || renderedApertureIds.has(aperture.id)) continue
      renderedApertureIds.add(aperture.id)
      const layerFlashes = flashesByLayer.get(layerName) ?? []
      layerFlashes.push({ circle, viaPad, aperture })
      flashesByLayer.set(layerName, layerFlashes)
    }
  }

  return [...flashesByLayer.entries()]
    .map(([layerName, flashes]) => {
      if (!shouldRenderLayer(context, layerName)) return ""
      const color = getLayerColor({
        layerName,
        layerColors: context.layerColors,
      })
      const circleElements = flashes
        .map(({ circle, viaPad, aperture }) => {
          const attributes = getMetadataAttributes(circle)
          if (circle.kind === "via") {
            if (!aperture || !viaPad) return ""
            const layerSpanAttributes =
              circle.startLayer !== undefined && circle.endLayer !== undefined
                ? ` data-start-layer="${formatNumber(circle.startLayer)}" data-end-layer="${formatNumber(circle.endLayer)}"`
                : ""
            return `<use ${attributes}${layerSpanAttributes} data-pad-layer="${formatNumber(viaPad.layer)}" xlink:href="#${aperture.id}" href="#${aperture.id}" x="${formatNumber(circle.center.x)}" y="${formatNumber(circle.center.y)}"/>`
          }

          const radius = Math.max(
            Math.abs(circle.radius),
            context.minimumFeatureSize,
          )
          return `<circle ${attributes} cx="${formatNumber(circle.center.x)}" cy="${formatNumber(circle.center.y)}" r="${formatNumber(radius)}" fill="currentColor" stroke="currentColor"/>`
        })
        .join("")

      return `<g id="pads-${layerName}-flashes" data-gerber-layer="${layerName}" color="${color}" fill="currentColor" stroke="currentColor"${getCopperMaskAttribute(context, layerName)}${context.artworkClipAttribute}>${circleElements}</g>`
    })
    .join("")
}

const getPadMetadataAttributes = (pad: PadsGeometryPad): string =>
  [
    pad.id ? `id="${escapeXml(getSvgEntityId(pad.id))}"` : "",
    pad.source ? `data-source-id="${escapeXml(pad.source.sourceId)}"` : "",
    'data-kind="component-pad"',
    `data-pads-layer="${formatNumber(pad.layer)}"`,
    `data-reference="${escapeXml(pad.reference)}"`,
    `data-pin="${escapeXml(pad.pinNumber)}"`,
    `data-decal="${escapeXml(pad.decalName)}"`,
  ].join(" ")

const getChamferedPadPathData = (pad: PadsGeometryPad): string => {
  const halfWidth = pad.width / 2
  const halfHeight = pad.height / 2
  const corner = Math.min(
    Math.abs(pad.cornerRadius ?? 0),
    halfWidth,
    halfHeight,
  )
  return [
    `M ${formatNumber(-halfWidth + corner)} ${formatNumber(-halfHeight)}`,
    `L ${formatNumber(halfWidth - corner)} ${formatNumber(-halfHeight)}`,
    `L ${formatNumber(halfWidth)} ${formatNumber(-halfHeight + corner)}`,
    `L ${formatNumber(halfWidth)} ${formatNumber(halfHeight - corner)}`,
    `L ${formatNumber(halfWidth - corner)} ${formatNumber(halfHeight)}`,
    `L ${formatNumber(-halfWidth + corner)} ${formatNumber(halfHeight)}`,
    `L ${formatNumber(-halfWidth)} ${formatNumber(halfHeight - corner)}`,
    `L ${formatNumber(-halfWidth)} ${formatNumber(-halfHeight + corner)}`,
    "Z",
  ].join(" ")
}

const renderFootprintPads = (context: RenderContext): string => {
  const padsByLayer = new Map<string, PadsGeometryPad[]>()
  for (const pad of context.geometry.pads) {
    if (
      !isFinitePoint(pad.center) ||
      !Number.isFinite(pad.width) ||
      !Number.isFinite(pad.height) ||
      pad.width <= 0 ||
      pad.height <= 0
    ) {
      continue
    }
    const layerName = getGerberCopperLayerName({
      geometry: context.geometry,
      layer: pad.layer,
    })
    if (!shouldRenderLayer(context, layerName)) continue
    const layerPads = padsByLayer.get(layerName) ?? []
    layerPads.push(pad)
    padsByLayer.set(layerName, layerPads)
  }

  return [...padsByLayer.entries()]
    .map(([layerName, pads]) => {
      const color = getLayerColor({
        layerName,
        layerColors: context.layerColors,
      })
      const padElements = pads
        .map((pad) => {
          const attributes = getPadMetadataAttributes(pad)
          if (pad.shape === "circle") {
            return `<circle ${attributes} cx="${formatNumber(pad.center.x)}" cy="${formatNumber(pad.center.y)}" r="${formatNumber(Math.min(pad.width, pad.height) / 2)}"/>`
          }

          if (pad.chamfered && (pad.cornerRadius ?? 0) > 0) {
            return `<path ${attributes} data-corner-radius="${formatNumber(pad.cornerRadius ?? 0)}" data-chamfered="true" d="${getChamferedPadPathData(pad)}" transform="translate(${formatNumber(pad.center.x)} ${formatNumber(pad.center.y)}) rotate(${formatNumber(pad.rotation)})"/>`
          }

          const cornerRadius =
            pad.shape === "oval"
              ? Math.min(pad.width, pad.height) / 2
              : Math.min(
                  Math.abs(pad.cornerRadius ?? 0),
                  pad.width / 2,
                  pad.height / 2,
                )
          return `<rect ${attributes}${(pad.cornerRadius ?? 0) > 0 ? ` data-corner-radius="${formatNumber(pad.cornerRadius ?? 0)}"` : ""} x="${formatNumber(-pad.width / 2)}" y="${formatNumber(-pad.height / 2)}" width="${formatNumber(pad.width)}" height="${formatNumber(pad.height)}"${cornerRadius > 0 ? ` rx="${formatNumber(cornerRadius)}" ry="${formatNumber(cornerRadius)}"` : ""} transform="translate(${formatNumber(pad.center.x)} ${formatNumber(pad.center.y)}) rotate(${formatNumber(pad.rotation)})"/>`
        })
        .join("")
      return `<g id="pads-${layerName}-component-pads" data-gerber-layer="${layerName}" color="${color}" fill="currentColor" stroke="none"${getCopperMaskAttribute(context, layerName)}${context.artworkClipAttribute}>${padElements}</g>`
    })
    .join("")
}

const holeIntersectsVisibleCopperLayer = ({
  hole,
  visibleCopperLayers,
}: {
  hole: PadsGeometryHole
  visibleCopperLayers: Set<number>
}): boolean => {
  const firstLayer = Math.min(hole.startLayer, hole.endLayer)
  const lastLayer = Math.max(hole.startLayer, hole.endLayer)
  return [...visibleCopperLayers].some(
    (layer) => layer >= firstLayer && layer <= lastLayer,
  )
}

const renderDrills = ({ context }: { context: RenderContext }): string => {
  if (!shouldRenderLayer(context, "Drill")) return ""
  const visibleCopperLayers = new Set<number>()
  if (context.visibleGerberLayers) {
    for (let layer = 1; layer <= context.geometry.layerCount; layer++) {
      const layerName = getGerberCopperLayerName({
        geometry: context.geometry,
        layer,
      })
      if (context.visibleGerberLayers.has(layerName)) {
        visibleCopperLayers.add(layer)
      }
    }
  }
  const filterDrillsByCopperLayer =
    context.visibleGerberLayers !== undefined && visibleCopperLayers.size > 0
  const viaDrillElements = context.geometry.circles
    .filter((circle) => circle.kind === "via")
    .filter((circle) => {
      if (!filterDrillsByCopperLayer) return true
      if (
        circle.startLayer !== undefined &&
        circle.endLayer !== undefined &&
        Number.isFinite(circle.startLayer) &&
        Number.isFinite(circle.endLayer)
      ) {
        const firstLayer = Math.min(
          Math.trunc(circle.startLayer),
          Math.trunc(circle.endLayer),
        )
        const lastLayer = Math.max(
          Math.trunc(circle.startLayer),
          Math.trunc(circle.endLayer),
        )
        return [...visibleCopperLayers].some(
          (layer) => layer >= firstLayer && layer <= lastLayer,
        )
      }
      return getViaCopperPads({
        circle,
        geometry: context.geometry,
      }).some((pad) => visibleCopperLayers.has(pad.layer))
    })
    .map((circle) => {
      const drillRadius = getViaDrillRadius(circle)
      if (drillRadius === undefined) return ""
      const layerSpanAttributes =
        circle.startLayer !== undefined && circle.endLayer !== undefined
          ? ` data-start-layer="${formatNumber(circle.startLayer)}" data-end-layer="${formatNumber(circle.endLayer)}"`
          : ""
      const identityAttributes = [
        circle.id
          ? ` id="${escapeXml(getSvgEntityId(`${circle.id}:drill`))}"`
          : "",
        circle.source
          ? ` data-source-id="${escapeXml(circle.source.sourceId)}"`
          : "",
      ].join("")
      return `<circle${identityAttributes} data-kind="drill"${layerSpanAttributes} cx="${formatNumber(circle.center.x)}" cy="${formatNumber(circle.center.y)}" r="${formatNumber(drillRadius)}"/>`
    })
    .join("")

  const componentDrillElements = context.geometry.holes
    .filter(
      (hole) =>
        isFinitePoint(hole.center) &&
        Number.isFinite(hole.width) &&
        Number.isFinite(hole.height) &&
        hole.width > 0 &&
        hole.height > 0,
    )
    .filter(
      (hole) =>
        !filterDrillsByCopperLayer ||
        holeIntersectsVisibleCopperLayer({
          hole,
          visibleCopperLayers,
        }),
    )
    .map((hole) => {
      const layerSpanAttributes = ` data-start-layer="${formatNumber(hole.startLayer)}" data-end-layer="${formatNumber(hole.endLayer)}"`
      const metadataAttributes = `${hole.id ? ` id="${escapeXml(getSvgEntityId(hole.id))}"` : ""}${hole.source ? ` data-source-id="${escapeXml(hole.source.sourceId)}"` : ""} data-reference="${escapeXml(hole.reference)}" data-pin="${escapeXml(hole.pinNumber)}" data-decal="${escapeXml(hole.decalName)}" data-plated="${hole.plated ? "true" : "false"}"`
      if (Math.abs(hole.width - hole.height) < 1e-6) {
        return `<circle data-kind="component-drill"${layerSpanAttributes}${metadataAttributes} cx="${formatNumber(hole.center.x)}" cy="${formatNumber(hole.center.y)}" r="${formatNumber(hole.width / 2)}"/>`
      }

      const cornerRadius = Math.min(hole.width, hole.height) / 2
      return `<rect data-kind="component-drill" data-slot="true"${layerSpanAttributes}${metadataAttributes} x="${formatNumber(-hole.width / 2)}" y="${formatNumber(-hole.height / 2)}" width="${formatNumber(hole.width)}" height="${formatNumber(hole.height)}" rx="${formatNumber(cornerRadius)}" ry="${formatNumber(cornerRadius)}" transform="translate(${formatNumber(hole.center.x)} ${formatNumber(hole.center.y)}) rotate(${formatNumber(hole.rotation)})"/>`
    })
    .join("")
  const drillElements = viaDrillElements + componentDrillElements
  if (!drillElements) return ""
  return `<g id="pads-Drill" data-gerber-layer="Drill" fill="${escapeXml(context.drillColor)}" stroke="none"${context.artworkClipAttribute}>${drillElements}</g>`
}

const renderDrawingGeometry = (context: RenderContext): string => {
  const drawingPathsByLayer = new Map<string, PadsGeometryPath[]>()
  const drawingCirclesByLayer = new Map<string, PadsGeometryCircle[]>()
  for (const path of context.geometry.paths) {
    if (path.kind !== "drawing") continue
    const layerName = path.gerberLayer ?? "Dwgs_User"
    const layerPaths = drawingPathsByLayer.get(layerName) ?? []
    layerPaths.push(path)
    drawingPathsByLayer.set(layerName, layerPaths)
  }
  for (const circle of context.geometry.circles) {
    if (circle.kind !== "drawing") continue
    const layerName = circle.gerberLayer ?? "Dwgs_User"
    const layerCircles = drawingCirclesByLayer.get(layerName) ?? []
    layerCircles.push(circle)
    drawingCirclesByLayer.set(layerName, layerCircles)
  }

  const layerNames = new Set([
    ...drawingPathsByLayer.keys(),
    ...drawingCirclesByLayer.keys(),
  ])
  return [...layerNames]
    .map((layerName) => {
      if (!shouldRenderLayer(context, layerName)) return ""
      const drawingPaths = (drawingPathsByLayer.get(layerName) ?? [])
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
      const drawingCircles = (drawingCirclesByLayer.get(layerName) ?? [])
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
      const color = getLayerColor({
        layerName,
        layerColors: context.layerColors,
      })
      return `<g id="pads-${escapeXml(layerName)}-drawings" data-gerber-layer="${escapeXml(layerName)}" color="${color}" fill="currentColor" stroke="currentColor"${context.artworkClipAttribute}>${drawingPaths}${drawingCircles}</g>`
    })
    .join("")
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
    const element = `<g${placement.id ? ` id="${escapeXml(getSvgEntityId(placement.id))}"` : ""}${placement.source ? ` data-source-id="${escapeXml(placement.source.sourceId)}"` : ""} data-kind="placement" data-reference="${escapeXml(placement.reference)}" transform="translate(${formatNumber(placement.location.x)} ${formatNumber(placement.location.y)}) rotate(${formatNumber(placement.rotation)})"><path d="M ${formatNumber(-markerRadius)} 0 L ${formatNumber(markerRadius)} 0 M 0 ${formatNumber(-markerRadius)} L 0 ${formatNumber(markerRadius)}" fill="none" stroke="currentColor" stroke-width="${formatNumber(context.minimumFeatureSize)}"/><text x="${formatNumber(markerRadius * 1.4)}" y="${formatNumber(-markerRadius)}" transform="scale(1,-1)" fill="currentColor" stroke="none" font-family="monospace" font-size="${formatNumber(fontSize)}">${escapeXml(placement.reference)}</text></g>`
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
    return `<g id="pads-${layerName}-placements" data-gerber-layer="${layerName}" color="${color}" fill="currentColor" stroke="currentColor"${context.artworkClipAttribute}>${elements.join("")}</g>`
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
      return `<text${text.id ? ` id="${escapeXml(getSvgEntityId(text.id))}"` : ""}${text.source ? ` data-source-id="${escapeXml(text.source.sourceId)}"` : ""} data-kind="board-text" data-pads-layer="${escapeXml(String(text.layer ?? ""))}" x="0" y="0" transform="translate(${formatNumber(text.location.x)} ${formatNumber(text.location.y)}) rotate(${formatNumber(text.rotation)}) scale(${mirrorScale},-1)" fill="currentColor" stroke="currentColor" stroke-width="${formatNumber(strokeWidth * 0.15)}" font-family="monospace" font-size="${formatNumber(fontSize)}">${escapeXml(text.content)}</text>`
    })
    .join("")

  if (!textElements) return ""
  const color = getLayerColor({
    layerName: "F_Silkscreen",
    layerColors: context.layerColors,
  })
  return `<g id="pads-F_Silkscreen-text" data-gerber-layer="F_Silkscreen" color="${color}" fill="currentColor" stroke="currentColor"${context.artworkClipAttribute}>${textElements}</g>`
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
      `<circle${point.id ? ` id="${escapeXml(getSvgEntityId(point.id))}"` : ""}${point.source ? ` data-source-id="${escapeXml(point.source.sourceId)}"` : ""} data-kind="unassigned-vertex" cx="${formatNumber(point.x)}" cy="${formatNumber(point.y)}" r="${formatNumber(pointRadius)}"/>`,
    )
  }

  if (elements.length === 0) return ""
  const color = getLayerColor({
    layerName: "Debug_Vertices",
    layerColors: context.layerColors,
  })
  return `<g id="pads-Debug_Vertices" data-gerber-layer="Debug_Vertices" color="${color}" fill="currentColor" fill-opacity="0.4"${context.artworkClipAttribute}>${elements.join("")}</g>`
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
        ? `<path ${getMetadataAttributes(path)} data-debug-kind="unverified-connection" d="${pathData}" fill="none" stroke="currentColor" stroke-width="${formatNumber(strokeWidth)}" stroke-dasharray="${formatNumber(strokeWidth * 5)} ${formatNumber(strokeWidth * 4)}"/>`
        : ""
    })
    .join("")
  const pointRadius = context.minimumFeatureSize * 3
  const pointStrokeWidth = context.minimumFeatureSize
  const viaElements = context.geometry.unverifiedViaLocations
    .filter((point) => pointInsideBounds({ point, bounds: context.bounds }))
    .map(
      (point) =>
        `<circle${point.id ? ` id="${escapeXml(getSvgEntityId(point.id))}"` : ""}${point.source ? ` data-source-id="${escapeXml(point.source.sourceId)}"` : ""} data-kind="unverified-via-location" cx="${formatNumber(point.x)}" cy="${formatNumber(point.y)}" r="${formatNumber(pointRadius)}" fill="none" stroke="currentColor" stroke-width="${formatNumber(pointStrokeWidth)}"/>`,
    )
    .join("")
  if (!connectionElements && !viaElements) return ""

  const color = getLayerColor({
    layerName: "Debug_Connections",
    layerColors: context.layerColors,
  })
  return `<g id="pads-Debug_Connections" data-gerber-layer="Debug_Connections" color="${color}" fill="currentColor" fill-opacity="0.55" stroke="currentColor"${context.artworkClipAttribute}>${connectionElements}${viaElements}</g>`
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
  const boardViewBoxUnits = options.viewBoxUnits ?? "normalized"
  const normalizedBoardViewBox = options.viewBox
    ? normalizeRequestedViewBox({
        geometry,
        viewBox: options.viewBox,
        viewBoxUnits: boardViewBoxUnits,
      })
    : undefined
  const bounds = normalizedBoardViewBox
    ? getRequestedBounds(normalizedBoardViewBox)
    : getBounds(geometry)
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
  const outlineClipAttribute =
    outlinePaths.length > 0 ? ' clip-path="url(#pads-board-outline)"' : ""
  const artworkClipAttribute =
    options.clipArtworkToBoardOutline === false ? "" : outlineClipAttribute
  const { apertures, apertureByKey } = getViaApertures(
    geometry,
    minimumFeatureSize,
  )
  const context: RenderContext = {
    geometry,
    bounds,
    minimumFeatureSize,
    artworkClipAttribute,
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
    sourceUnits: geometry.sourceUnits,
    coordinateUnit: geometry.coordinateUnit,
    layerCount: geometry.layerCount,
    diagnostics: geometry.diagnostics,
    issues: geometry.issues,
    coverage: geometry.coverage,
    visibleGerberLayers: options.visibleGerberLayers,
    boardViewBox: options.viewBox,
    boardViewBoxUnits: options.viewBox ? boardViewBoxUnits : undefined,
    normalizedBoardViewBox,
    clipArtworkToBoardOutline: options.clipArtworkToBoardOutline,
    counts: {
      paths: geometry.paths.length,
      circles: geometry.circles.length,
      pads: geometry.pads.length,
      holes: geometry.holes.length,
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
    renderCopperPolarityMasks(context),
    renderApertureDefinitions(apertures),
    "</defs>",
    `<rect data-kind="negative-space" x="${formatNumber(bounds.minimumX)}" y="${formatNumber(-bounds.maximumY)}" width="${formatNumber(boundsWidth)}" height="${formatNumber(boundsHeight)}" fill="${escapeXml(backgroundColor)}"/>`,
    '<g transform="scale(1,-1)">',
    `<g id="pads-FR4"${outlineClipAttribute}><rect x="${formatNumber(bounds.minimumX)}" y="${formatNumber(bounds.minimumY)}" width="${formatNumber(boundsWidth)}" height="${formatNumber(boundsHeight)}" fill="${escapeXml(boardColor)}"/></g>`,
    renderCopperPaths(context),
    renderCopperCircles({ context, apertureByKey }),
    renderFootprintPads(context),
    renderDrills({ context }),
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

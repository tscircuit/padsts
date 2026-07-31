import {
  createPadsConversionReport,
  type PadsConversionReport,
} from "./conversion-report"
import type { PadsDiagnostic } from "./diagnostics"
import {
  extractPadsBoardGeometry,
  type PadsBoardGeometry,
  type PadsGeometryPath,
} from "./geometry"
import { type PadsDocument, parsePads } from "./parse-pads"

export type PadsCircuitJsonLayer =
  | "top"
  | "bottom"
  | `inner${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`

export type PadsCircuitJsonElement = Record<string, unknown> & {
  type: string
}

export type PadsCircuitJson = PadsCircuitJsonElement[]

export interface PadsCircuitJsonConversionResult {
  circuitJson: PadsCircuitJson
  report: PadsConversionReport
}

const nmToMm = (value: number): number => value / 1_000_000

const toCircuitJsonPoint = ({ x, y }: { x: number; y: number }) => ({
  x: nmToMm(x),
  y: nmToMm(y),
})

const toStableCircuitJsonId = (
  prefix: string,
  sourceId: string | undefined,
  fallbackIndex: number,
): string =>
  `${prefix}_${(sourceId ?? String(fallbackIndex)).replace(/[^A-Za-z0-9_]+/gu, "_")}`

const getCircuitJsonLayer = (
  layer: number | string | undefined,
  layerCount: number,
): PadsCircuitJsonLayer | undefined => {
  const numericLayer = Number(layer)
  if (!Number.isFinite(numericLayer)) return undefined
  const normalizedLayer = Math.trunc(numericLayer)
  if (normalizedLayer <= 1) return "top"
  if (normalizedLayer >= layerCount) return "bottom"
  const innerLayer = normalizedLayer - 1
  return innerLayer >= 1 && innerLayer <= 8
    ? (`inner${innerLayer}` as PadsCircuitJsonLayer)
    : undefined
}

const getPathLayer = (
  path: PadsGeometryPath,
  geometry: PadsBoardGeometry,
): PadsCircuitJsonLayer | undefined => {
  if (path.gerberLayer === "F_Cu" || path.gerberLayer === "F_Silkscreen") {
    return "top"
  }
  if (path.gerberLayer === "B_Cu" || path.gerberLayer === "B_Silkscreen") {
    return "bottom"
  }
  const internalMatch = /^In([1-8])_Cu$/u.exec(path.gerberLayer ?? "")
  if (internalMatch?.[1]) {
    return `inner${Number(internalMatch[1])}` as PadsCircuitJsonLayer
  }
  return getCircuitJsonLayer(path.layer, geometry.layerCount)
}

const getOutline = (
  geometry: PadsBoardGeometry,
): PadsGeometryPath | undefined =>
  geometry.paths
    .filter(
      (path) =>
        path.kind === "outline" &&
        path.closed &&
        path.points.length >= 3 &&
        !path.segments?.some((segment) => segment.kind === "arc"),
    )
    .sort((first, second) => second.points.length - first.points.length)[0]

const getComponentBounds = (
  geometry: PadsBoardGeometry,
  reference: string,
):
  | {
      minimumX: number
      minimumY: number
      maximumX: number
      maximumY: number
    }
  | undefined => {
  const points = [
    ...geometry.pads
      .filter((pad) => pad.reference === reference)
      .flatMap((pad) => [
        {
          x: pad.center.x - pad.width / 2,
          y: pad.center.y - pad.height / 2,
        },
        {
          x: pad.center.x + pad.width / 2,
          y: pad.center.y + pad.height / 2,
        },
      ]),
    ...geometry.holes
      .filter((hole) => hole.reference === reference)
      .flatMap((hole) => [
        {
          x: hole.center.x - hole.width / 2,
          y: hole.center.y - hole.height / 2,
        },
        {
          x: hole.center.x + hole.width / 2,
          y: hole.center.y + hole.height / 2,
        },
      ]),
    ...geometry.paths
      .filter((path) => path.reference === reference)
      .flatMap((path) => path.points),
    ...geometry.circles
      .filter((circle) => circle.reference === reference)
      .flatMap((circle) => [
        {
          x: circle.center.x - circle.radius,
          y: circle.center.y - circle.radius,
        },
        {
          x: circle.center.x + circle.radius,
          y: circle.center.y + circle.radius,
        },
      ]),
  ].filter(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))
  if (points.length === 0) return undefined
  return {
    minimumX: Math.min(...points.map(({ x }) => x)),
    minimumY: Math.min(...points.map(({ y }) => y)),
    maximumX: Math.max(...points.map(({ x }) => x)),
    maximumY: Math.max(...points.map(({ y }) => y)),
  }
}

const createSkippedDiagnostic = ({
  code,
  message,
  path,
}: {
  code: string
  message: string
  path?: PadsGeometryPath
}): PadsDiagnostic => ({
  code,
  severity: "warning",
  category: "unsupported",
  message,
  ...(path?.source ? { source: path.source } : {}),
  ...(path?.id ? { entityIds: [path.id] } : {}),
})

export const convertPadsToCircuitJson = (
  source: string | Uint8Array | PadsDocument,
  { strict = false }: { strict?: boolean } = {},
): PadsCircuitJsonConversionResult => {
  const document =
    typeof source === "string" || source instanceof Uint8Array
      ? parsePads(source)
      : source
  const geometry = extractPadsBoardGeometry(document)
  const circuitJson: PadsCircuitJson = []
  const conversionDiagnostics: PadsDiagnostic[] = []
  const boardId = "pcb_board_pads"
  const outline = getOutline(geometry)

  if (outline) {
    const minimumX = Math.min(...outline.points.map(({ x }) => x))
    const minimumY = Math.min(...outline.points.map(({ y }) => y))
    const maximumX = Math.max(...outline.points.map(({ x }) => x))
    const maximumY = Math.max(...outline.points.map(({ y }) => y))
    circuitJson.push({
      type: "pcb_board",
      pcb_board_id: boardId,
      shape: "polygon",
      center: {
        x: nmToMm((minimumX + maximumX) / 2),
        y: nmToMm((minimumY + maximumY) / 2),
      },
      width: nmToMm(maximumX - minimumX),
      height: nmToMm(maximumY - minimumY),
      num_layers: geometry.layerCount,
      outline: outline.points.map(toCircuitJsonPoint),
      material: "fr4",
    })
  } else {
    conversionDiagnostics.push(
      createSkippedDiagnostic({
        code: "circuit-json-board-outline-unavailable",
        message:
          "Circuit JSON board output requires a closed, line-segment-only board outline",
      }),
    )
  }

  const componentIdByReference = new Map<string, string>()
  for (const [index, placement] of geometry.placements.entries()) {
    const bounds = getComponentBounds(geometry, placement.reference)
    if (!bounds) {
      conversionDiagnostics.push({
        code: "circuit-json-component-bounds-unavailable",
        severity: "warning",
        category: "unsupported",
        message: `Skipped ${placement.reference} because no decoded footprint geometry establishes its dimensions`,
        ...(placement.source ? { source: placement.source } : {}),
        ...(placement.id ? { entityIds: [placement.id] } : {}),
      })
      continue
    }
    const pcbComponentId = toStableCircuitJsonId(
      "pcb_component",
      placement.source?.sourceId,
      index,
    )
    componentIdByReference.set(placement.reference, pcbComponentId)
    circuitJson.push({
      type: "pcb_component",
      pcb_component_id: pcbComponentId,
      source_component_id: `source_component_${placement.reference}`,
      center: toCircuitJsonPoint(placement.location),
      layer: placement.bottomLayer ? "bottom" : "top",
      rotation: placement.rotation,
      width: nmToMm(bounds.maximumX - bounds.minimumX),
      height: nmToMm(bounds.maximumY - bounds.minimumY),
      positioned_relative_to_pcb_board_id: outline ? boardId : undefined,
    })
  }

  for (const [index, pad] of geometry.pads.entries()) {
    const layer = getCircuitJsonLayer(pad.layer, geometry.layerCount)
    if (!layer) continue
    const base = {
      type: "pcb_smtpad",
      pcb_smtpad_id: toStableCircuitJsonId(
        "pcb_smtpad",
        pad.source?.sourceId,
        index,
      ),
      pcb_component_id: componentIdByReference.get(pad.reference),
      x: nmToMm(pad.center.x),
      y: nmToMm(pad.center.y),
      layer,
    }
    if (pad.shape === "circle") {
      circuitJson.push({
        ...base,
        shape: "circle",
        radius: nmToMm(Math.min(pad.width, pad.height) / 2),
      })
    } else if (pad.shape === "oval") {
      circuitJson.push({
        ...base,
        shape: pad.rotation === 0 ? "pill" : "rotated_pill",
        width: nmToMm(pad.width),
        height: nmToMm(pad.height),
        radius: nmToMm(Math.min(pad.width, pad.height) / 2),
        ...(pad.rotation === 0 ? {} : { ccw_rotation: pad.rotation }),
      })
    } else {
      circuitJson.push({
        ...base,
        shape: pad.rotation === 0 ? "rect" : "rotated_rect",
        width: nmToMm(pad.width),
        height: nmToMm(pad.height),
        ...(pad.cornerRadius
          ? { rect_border_radius: nmToMm(pad.cornerRadius) }
          : {}),
        ...(pad.rotation === 0 ? {} : { ccw_rotation: pad.rotation }),
      })
    }
  }

  for (const [index, hole] of geometry.holes.entries()) {
    const pcbComponentId = componentIdByReference.get(hole.reference)
    const circular = Math.abs(hole.width - hole.height) < 1e-6
    if (!hole.plated) {
      circuitJson.push(
        circular
          ? {
              type: "pcb_hole",
              pcb_hole_id: toStableCircuitJsonId(
                "pcb_hole",
                hole.source?.sourceId,
                index,
              ),
              pcb_component_id: pcbComponentId,
              hole_shape: "circle",
              hole_diameter: nmToMm(hole.width),
              x: nmToMm(hole.center.x),
              y: nmToMm(hole.center.y),
            }
          : {
              type: "pcb_hole",
              pcb_hole_id: toStableCircuitJsonId(
                "pcb_hole",
                hole.source?.sourceId,
                index,
              ),
              pcb_component_id: pcbComponentId,
              hole_shape: "rotated_pill",
              hole_width: nmToMm(hole.width),
              hole_height: nmToMm(hole.height),
              ccw_rotation: hole.rotation,
              x: nmToMm(hole.center.x),
              y: nmToMm(hole.center.y),
            },
      )
      continue
    }
    const layers = Array.from(
      { length: Math.max(0, hole.endLayer - hole.startLayer + 1) },
      (_, layerOffset) =>
        getCircuitJsonLayer(hole.startLayer + layerOffset, geometry.layerCount),
    ).filter((layer): layer is PadsCircuitJsonLayer => layer !== undefined)
    circuitJson.push(
      circular
        ? {
            type: "pcb_plated_hole",
            pcb_plated_hole_id: toStableCircuitJsonId(
              "pcb_plated_hole",
              hole.source?.sourceId,
              index,
            ),
            pcb_component_id: pcbComponentId,
            shape: "circle",
            x: nmToMm(hole.center.x),
            y: nmToMm(hole.center.y),
            hole_diameter: nmToMm(hole.width),
            outer_diameter: nmToMm(hole.width),
            layers,
          }
        : {
            type: "pcb_plated_hole",
            pcb_plated_hole_id: toStableCircuitJsonId(
              "pcb_plated_hole",
              hole.source?.sourceId,
              index,
            ),
            pcb_component_id: pcbComponentId,
            shape: "oval",
            x: nmToMm(hole.center.x),
            y: nmToMm(hole.center.y),
            hole_width: nmToMm(hole.width),
            hole_height: nmToMm(hole.height),
            outer_width: nmToMm(hole.width),
            outer_height: nmToMm(hole.height),
            ccw_rotation: hole.rotation,
            layers,
          },
    )
  }

  for (const [index, circle] of geometry.circles.entries()) {
    if (circle.kind !== "via" || circle.drillRadius === undefined) continue
    const startLayer = Math.trunc(circle.startLayer ?? 1)
    const endLayer = Math.trunc(circle.endLayer ?? geometry.layerCount)
    const layers = Array.from(
      { length: Math.max(0, endLayer - startLayer + 1) },
      (_, layerOffset) =>
        getCircuitJsonLayer(startLayer + layerOffset, geometry.layerCount),
    ).filter((layer): layer is PadsCircuitJsonLayer => layer !== undefined)
    const outerRadius = Math.max(
      circle.radius,
      ...(circle.copperPads ?? []).map(({ radius }) => radius),
    )
    circuitJson.push({
      type: "pcb_via",
      pcb_via_id: toStableCircuitJsonId(
        "pcb_via",
        circle.source?.sourceId,
        index,
      ),
      x: nmToMm(circle.center.x),
      y: nmToMm(circle.center.y),
      outer_diameter: nmToMm(outerRadius * 2),
      hole_diameter: nmToMm(circle.drillRadius * 2),
      layers,
    })
  }

  for (const [index, path] of geometry.paths.entries()) {
    if (path.kind !== "route") continue
    const layer = getPathLayer(path, geometry)
    if (
      !layer ||
      path.points.length < 2 ||
      path.segments?.some((segment) => segment.kind === "arc")
    ) {
      conversionDiagnostics.push(
        createSkippedDiagnostic({
          code: "circuit-json-route-not-exactly-representable",
          message:
            "Skipped a route whose layer or circular-arc geometry is not exactly representable by the current adapter",
          path,
        }),
      )
      continue
    }
    circuitJson.push({
      type: "pcb_trace",
      pcb_trace_id: toStableCircuitJsonId(
        "pcb_trace",
        path.source?.sourceId,
        index,
      ),
      route: path.points.map((point) => ({
        route_type: "wire",
        ...toCircuitJsonPoint(point),
        width: nmToMm(path.width),
        layer,
      })),
    })
  }

  for (const [index, path] of geometry.paths.entries()) {
    if (
      path.kind !== "drawing" ||
      (path.gerberLayer !== "F_Silkscreen" &&
        path.gerberLayer !== "B_Silkscreen") ||
      path.segments?.some((segment) => segment.kind === "arc")
    ) {
      continue
    }
    const reference = path.reference
    const pcbComponentId = reference
      ? componentIdByReference.get(reference)
      : undefined
    if (!pcbComponentId) continue
    circuitJson.push({
      type: "pcb_silkscreen_path",
      pcb_silkscreen_path_id: toStableCircuitJsonId(
        "pcb_silkscreen_path",
        path.source?.sourceId,
        index,
      ),
      pcb_component_id: pcbComponentId,
      layer: path.gerberLayer === "B_Silkscreen" ? "bottom" : "top",
      route: path.points.map(toCircuitJsonPoint),
      stroke_width: nmToMm(path.width),
    })
  }

  const baseReport = createPadsConversionReport(document, { strict: false })
  const report: PadsConversionReport = {
    ...baseReport,
    strict,
    lossless:
      baseReport.lossless &&
      conversionDiagnostics.length === 0 &&
      Boolean(outline),
    diagnostics: [...baseReport.diagnostics, ...conversionDiagnostics],
  }
  if (strict && !report.lossless) {
    report.diagnostics.push({
      code: "strict-circuit-json-conversion-would-be-lossy",
      severity: "error",
      category: "coverage",
      message:
        "Strict Circuit JSON conversion refused source data that cannot be represented exactly",
    })
  }
  return { circuitJson, report }
}

export const toCircuitJson = (
  source: string | Uint8Array | PadsDocument,
): PadsCircuitJson => convertPadsToCircuitJson(source).circuitJson

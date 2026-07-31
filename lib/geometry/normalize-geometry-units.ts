import type { PadsAsciiUnits } from "../ascii"
import {
  getPadsNanometersPerSourceUnit,
  PADS_INTERNAL_COORDINATE_UNIT,
} from "../units"
import type {
  PadsBoardGeometry,
  PadsGeometryArcSegment,
  PadsGeometryPoint,
} from "./pads-board-geometry"

const scalePoint = (
  point: PadsGeometryPoint,
  scale: number,
): PadsGeometryPoint => ({
  ...point,
  x: point.x * scale,
  y: point.y * scale,
})

const scaleArc = (
  segment: PadsGeometryArcSegment,
  scale: number,
): PadsGeometryArcSegment => ({
  ...segment,
  start: scalePoint(segment.start, scale),
  end: scalePoint(segment.end, scale),
  center: scalePoint(segment.center, scale),
  radius: segment.radius * scale,
})

export const normalizeGeometryUnits = ({
  geometry,
  sourceUnits,
}: {
  geometry: PadsBoardGeometry
  sourceUnits: Exclude<PadsAsciiUnits, "unknown">
}): PadsBoardGeometry => {
  const scale = getPadsNanometersPerSourceUnit(sourceUnits)
  if (scale === undefined) return geometry

  return {
    ...geometry,
    sourceUnits,
    coordinateUnit: PADS_INTERNAL_COORDINATE_UNIT,
    paths: geometry.paths.map((path) => ({
      ...path,
      points: path.points.map((point) => scalePoint(point, scale)),
      ...(path.segments
        ? {
            segments: path.segments.map((segment) =>
              segment.kind === "arc"
                ? scaleArc(segment, scale)
                : {
                    ...segment,
                    start: scalePoint(segment.start, scale),
                    end: scalePoint(segment.end, scale),
                  },
            ),
          }
        : {}),
      width: path.width * scale,
    })),
    circles: geometry.circles.map((circle) => ({
      ...circle,
      center: scalePoint(circle.center, scale),
      radius: circle.radius * scale,
      ...(circle.drillRadius === undefined
        ? {}
        : { drillRadius: circle.drillRadius * scale }),
      ...(circle.copperPads
        ? {
            copperPads: circle.copperPads.map((pad) => ({
              ...pad,
              radius: pad.radius * scale,
            })),
          }
        : {}),
      width: circle.width * scale,
    })),
    texts: geometry.texts.map((text) => ({
      ...text,
      location: scalePoint(text.location, scale),
      height: text.height * scale,
      strokeWidth: text.strokeWidth * scale,
    })),
    placements: geometry.placements.map((placement) => ({
      ...placement,
      location: scalePoint(placement.location, scale),
    })),
    pads: geometry.pads.map((pad) => ({
      ...pad,
      center: scalePoint(pad.center, scale),
      width: pad.width * scale,
      height: pad.height * scale,
      ...(pad.cornerRadius === undefined
        ? {}
        : { cornerRadius: pad.cornerRadius * scale }),
    })),
    holes: geometry.holes.map((hole) => ({
      ...hole,
      center: scalePoint(hole.center, scale),
      width: hole.width * scale,
      height: hole.height * scale,
    })),
    unassignedVertices: geometry.unassignedVertices.map((point) =>
      scalePoint(point, scale),
    ),
    unverifiedConnections: geometry.unverifiedConnections.map((path) => ({
      ...path,
      points: path.points.map((point) => scalePoint(point, scale)),
      ...(path.segments
        ? {
            segments: path.segments.map((segment) =>
              segment.kind === "arc"
                ? scaleArc(segment, scale)
                : {
                    ...segment,
                    start: scalePoint(segment.start, scale),
                    end: scalePoint(segment.end, scale),
                  },
            ),
          }
        : {}),
      width: path.width * scale,
    })),
    unverifiedViaLocations: geometry.unverifiedViaLocations.map((point) =>
      scalePoint(point, scale),
    ),
  }
}

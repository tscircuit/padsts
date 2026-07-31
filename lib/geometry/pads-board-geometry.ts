import type { PadsAsciiUnits } from "../ascii"
import type { PadsDiagnostic } from "../diagnostics"
import type { PadsFormat } from "../parse-pads"
import type { PadsSourceProvenance } from "../source-provenance"
import type { PadsInternalCoordinateUnit } from "../units"

export interface PadsGeometryPoint {
  x: number
  y: number
  id?: string
  source?: PadsSourceProvenance
}

export interface PadsGeometryLineSegment {
  kind: "line"
  start: PadsGeometryPoint
  end: PadsGeometryPoint
}

export interface PadsGeometryArcSegment {
  kind: "arc"
  start: PadsGeometryPoint
  end: PadsGeometryPoint
  center: PadsGeometryPoint
  radius: number
  startAngle: number
  deltaAngle: number
}

export type PadsGeometryPathSegment =
  | PadsGeometryLineSegment
  | PadsGeometryArcSegment

export type PadsGeometryPathKind =
  | "outline"
  | "route"
  | "copper"
  | "keepout"
  | "drawing"

export interface PadsGeometryPath {
  id?: string
  source?: PadsSourceProvenance
  kind: PadsGeometryPathKind
  points: PadsGeometryPoint[]
  segments?: PadsGeometryPathSegment[]
  closed: boolean
  width: number
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
}

export type PadsGeometryCircleKind = "via" | "copper" | "keepout" | "drawing"

export interface PadsGeometryViaPad {
  layer: number
  radius: number
  shape: "circle" | "square"
}

export interface PadsGeometryCircle {
  id?: string
  source?: PadsSourceProvenance
  kind: PadsGeometryCircleKind
  center: PadsGeometryPoint
  radius: number
  drillRadius?: number
  shape?: "circle" | "square"
  copperPads?: PadsGeometryViaPad[]
  startLayer?: number
  endLayer?: number
  width: number
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
}

export interface PadsGeometryText {
  id?: string
  source?: PadsSourceProvenance
  content: string
  location: PadsGeometryPoint
  height: number
  strokeWidth: number
  rotation: number
  mirrored: boolean
  layer?: number | string
}

export interface PadsGeometryPlacement {
  id?: string
  source?: PadsSourceProvenance
  reference: string
  footprintName?: string
  location: PadsGeometryPoint
  rotation: number
  bottomLayer: boolean
}

export interface PadsGeometryPad {
  id?: string
  source?: PadsSourceProvenance
  center: PadsGeometryPoint
  width: number
  height: number
  shape: "circle" | "square" | "rect" | "oval"
  cornerRadius?: number
  chamfered?: boolean
  rotation: number
  layer: number
  reference: string
  pinNumber: string
  decalName: string
}

export interface PadsGeometryHole {
  id?: string
  source?: PadsSourceProvenance
  center: PadsGeometryPoint
  width: number
  height: number
  rotation: number
  plated: boolean
  startLayer: number
  endLayer: number
  reference: string
  pinNumber: string
  decalName: string
}

export interface PadsGeometryLayerInfo {
  number: number
  name: string
  type?: string
  role?:
    | "copper"
    | "solder-mask"
    | "paste-mask"
    | "silkscreen"
    | "assembly"
    | "drill"
    | "mechanical"
    | "unassigned"
  side?: "top" | "bottom" | "internal" | "none"
}

export interface PadsBinarySectionSummary {
  index: number
  recordCount: number
  byteLength: number
  bytesPerRecord: number
}

export interface PadsGeometryCoverage {
  normalizedEntityCount: number
  entitiesWithProvenance: number
  entitiesWithoutProvenance: number
  binarySectionCount: number
  binaryByteLength: number
}

export interface PadsBoardGeometry {
  sourceFormat: PadsFormat
  version: string
  sourceUnits: PadsAsciiUnits
  coordinateUnit: PadsInternalCoordinateUnit
  layerCount: number
  layers: PadsGeometryLayerInfo[]
  paths: PadsGeometryPath[]
  circles: PadsGeometryCircle[]
  texts: PadsGeometryText[]
  placements: PadsGeometryPlacement[]
  pads: PadsGeometryPad[]
  holes: PadsGeometryHole[]
  unassignedVertices: PadsGeometryPoint[]
  unverifiedConnections: PadsGeometryPath[]
  unverifiedViaLocations: PadsGeometryPoint[]
  binarySections: PadsBinarySectionSummary[]
  diagnostics: string[]
  issues?: PadsDiagnostic[]
  coverage?: PadsGeometryCoverage
}

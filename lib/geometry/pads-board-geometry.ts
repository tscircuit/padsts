import type { PadsFormat } from "../parse-pads"

export interface PadsGeometryPoint {
  x: number
  y: number
}

export type PadsGeometryPathKind =
  | "outline"
  | "route"
  | "copper"
  | "keepout"
  | "drawing"

export interface PadsGeometryPath {
  kind: PadsGeometryPathKind
  points: PadsGeometryPoint[]
  closed: boolean
  width: number
  layer?: number | string
  name?: string
  netName?: string
}

export type PadsGeometryCircleKind = "via" | "copper" | "keepout" | "drawing"

export interface PadsGeometryCircle {
  kind: PadsGeometryCircleKind
  center: PadsGeometryPoint
  radius: number
  width: number
  layer?: number | string
  name?: string
  netName?: string
}

export interface PadsGeometryText {
  content: string
  location: PadsGeometryPoint
  height: number
  strokeWidth: number
  rotation: number
  mirrored: boolean
  layer?: number | string
}

export interface PadsGeometryPlacement {
  reference: string
  footprintName?: string
  location: PadsGeometryPoint
  rotation: number
  bottomLayer: boolean
}

export interface PadsGeometryLayerInfo {
  number: number
  name: string
}

export interface PadsBinarySectionSummary {
  index: number
  recordCount: number
  byteLength: number
  bytesPerRecord: number
}

export interface PadsBoardGeometry {
  sourceFormat: PadsFormat
  version: string
  layerCount: number
  layers: PadsGeometryLayerInfo[]
  paths: PadsGeometryPath[]
  circles: PadsGeometryCircle[]
  texts: PadsGeometryText[]
  placements: PadsGeometryPlacement[]
  unassignedVertices: PadsGeometryPoint[]
  binarySections: PadsBinarySectionSummary[]
  diagnostics: string[]
}

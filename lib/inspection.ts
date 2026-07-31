import type { PadsAsciiDocument } from "./ascii"
import {
  getPadsBinarySectionDefinition,
  type PadsBinaryDecodeStatus,
  type PadsBinaryDocument,
} from "./binary"
import type { PadsDiagnostic } from "./diagnostics"
import {
  extractPadsBoardGeometry,
  type PadsBoardGeometry,
  type PadsGeometryPoint,
} from "./geometry"
import { type PadsDocument, parsePads } from "./parse-pads"
import { convertPadsCoordinateToNanometers } from "./units"

export interface PadsInspectionEntityCounts {
  paths: number
  circles: number
  texts: number
  placements: number
  pads: number
  holes: number
  unresolvedVertices: number
  unverifiedConnections: number
  unverifiedViaLocations: number
}

export interface PadsInspectionBounds {
  minimumX: number
  minimumY: number
  maximumX: number
  maximumY: number
  width: number
  height: number
}

export interface PadsInspectionSection {
  id: string
  name: string
  recordCount: number
  byteLength: number
  status: "decoded" | "partial" | "opaque" | "unknown"
  confidence?: string
  notes?: string
}

export interface PadsInspectionCoverage {
  normalizedEntityCount: number
  entitiesWithProvenance: number
  entitiesWithoutProvenance: number
  sourceRecordCount: number
  decodedSourceRecords: number
  partiallyDecodedSourceRecords: number
  skippedSourceRecords: number
  malformedSourceRecords: number
  binaryByteLength: number
  decodedBinaryBytes: number
  partiallyDecodedBinaryBytes: number
  opaqueBinaryBytes: number
}

export interface PadsInspection {
  schemaVersion: "1"
  format: "ascii" | "binary"
  version: string
  units: string
  coordinateUnit: string
  origin?: { x: number; y: number }
  layerCount: number
  layers: PadsBoardGeometry["layers"]
  sections: PadsInspectionSection[]
  entityCounts: PadsInspectionEntityCounts
  bounds?: PadsInspectionBounds
  coverage: PadsInspectionCoverage
  diagnostics: PadsDiagnostic[]
}

const getPoints = (geometry: PadsBoardGeometry): PadsGeometryPoint[] => [
  ...geometry.paths.flatMap((path) => path.points),
  ...geometry.circles.map((circle) => circle.center),
  ...geometry.texts.map((text) => text.location),
  ...geometry.placements.map((placement) => placement.location),
  ...geometry.pads.map((pad) => pad.center),
  ...geometry.holes.map((hole) => hole.center),
]

const getBounds = (
  geometry: PadsBoardGeometry,
): PadsInspectionBounds | undefined => {
  const points = getPoints(geometry).filter(
    ({ x, y }) => Number.isFinite(x) && Number.isFinite(y),
  )
  if (points.length === 0) return undefined
  const minimumX = Math.min(...points.map(({ x }) => x))
  const minimumY = Math.min(...points.map(({ y }) => y))
  const maximumX = Math.max(...points.map(({ x }) => x))
  const maximumY = Math.max(...points.map(({ y }) => y))
  return {
    minimumX,
    minimumY,
    maximumX,
    maximumY,
    width: maximumX - minimumX,
    height: maximumY - minimumY,
  }
}

const getAsciiSections = (
  document: PadsAsciiDocument,
): PadsInspectionSection[] =>
  document.sections.map((section, index) => ({
    id: `ascii-section:${index}`,
    name: section.name,
    recordCount: section.records.length,
    byteLength: new TextEncoder().encode(section.getString()).byteLength,
    status: section.kind === "section" ? "partial" : "unknown",
    notes:
      section.kind === "section"
        ? "Typed records are preserved; semantic decoding varies by record."
        : "Unknown section is preserved losslessly.",
  }))

const getBinarySections = (
  document: PadsBinaryDocument,
): PadsInspectionSection[] =>
  document.sections
    .filter((section) => section.index > 0 && section.bytes.byteLength > 0)
    .map((section) => {
      const definition = getPadsBinarySectionDefinition(
        document.version,
        section.index,
      )
      return {
        id: `binary-section:${section.index}`,
        name: definition.name,
        recordCount: section.recordCount,
        byteLength: section.bytes.byteLength,
        status: definition.status,
        confidence: definition.confidence,
        notes: definition.notes,
      }
    })

const countBinaryBytesByStatus = (
  sections: PadsInspectionSection[],
  status: PadsBinaryDecodeStatus,
): number =>
  sections
    .filter((section) => section.status === status)
    .reduce((total, section) => total + section.byteLength, 0)

const getDocumentDiagnostics = (document: PadsDocument): PadsDiagnostic[] => {
  if (document.kind === "ascii") return document.diagnostics
  return document.diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    severity: "warning",
    category: "validation",
    message: diagnostic.message,
    source: {
      format: "binary",
      sourceId: `binary:container:${diagnostic.offset}`,
      sectionIndex: 0,
      span: {
        startOffset: diagnostic.offset,
        endOffset: diagnostic.offset + 1,
      },
    },
  }))
}

const getAsciiCoverage = (
  document: PadsAsciiDocument,
  geometry: PadsBoardGeometry,
): Omit<
  PadsInspectionCoverage,
  | "binaryByteLength"
  | "decodedBinaryBytes"
  | "partiallyDecodedBinaryBytes"
  | "opaqueBinaryBytes"
> => {
  const sourceRecordCount = document.coverage.recordCount
  const malformedSourceRecords = document.diagnostics.filter(
    ({ category }) => category === "malformed",
  ).length
  const sourceIds = new Set(
    [
      ...geometry.paths,
      ...geometry.circles,
      ...geometry.texts,
      ...geometry.placements,
      ...geometry.pads,
      ...geometry.holes,
    ]
      .map((entity) => entity.source?.sourceId)
      .filter((sourceId): sourceId is string => sourceId !== undefined),
  )
  const decodedSourceRecords = Math.min(sourceRecordCount, sourceIds.size)
  return {
    normalizedEntityCount: geometry.coverage?.normalizedEntityCount ?? 0,
    entitiesWithProvenance: geometry.coverage?.entitiesWithProvenance ?? 0,
    entitiesWithoutProvenance:
      geometry.coverage?.entitiesWithoutProvenance ?? 0,
    sourceRecordCount,
    decodedSourceRecords,
    partiallyDecodedSourceRecords: 0,
    skippedSourceRecords: Math.max(
      0,
      sourceRecordCount - decodedSourceRecords - malformedSourceRecords,
    ),
    malformedSourceRecords,
  }
}

export const inspectPads = (
  source: string | Uint8Array | PadsDocument,
): PadsInspection => {
  const document =
    typeof source === "string" || source instanceof Uint8Array
      ? parsePads(source)
      : source
  const geometry = extractPadsBoardGeometry(document)
  const sections =
    document.kind === "ascii"
      ? getAsciiSections(document)
      : getBinarySections(document)
  const asciiCoverage =
    document.kind === "ascii"
      ? getAsciiCoverage(document, geometry)
      : {
          normalizedEntityCount: geometry.coverage?.normalizedEntityCount ?? 0,
          entitiesWithProvenance:
            geometry.coverage?.entitiesWithProvenance ?? 0,
          entitiesWithoutProvenance:
            geometry.coverage?.entitiesWithoutProvenance ?? 0,
          sourceRecordCount: document.sections.reduce(
            (total, section) => total + section.recordCount,
            0,
          ),
          decodedSourceRecords: 0,
          partiallyDecodedSourceRecords: document.sections
            .filter((section) => section.bytes.byteLength > 0)
            .filter(
              (section) =>
                getPadsBinarySectionDefinition(document.version, section.index)
                  .status === "partial",
            )
            .reduce((total, section) => total + section.recordCount, 0),
          skippedSourceRecords: 0,
          malformedSourceRecords: 0,
        }
  if (document.kind === "binary") {
    asciiCoverage.skippedSourceRecords = Math.max(
      0,
      asciiCoverage.sourceRecordCount -
        asciiCoverage.decodedSourceRecords -
        asciiCoverage.partiallyDecodedSourceRecords -
        asciiCoverage.malformedSourceRecords,
    )
  }
  const binaryByteLength =
    document.kind === "binary"
      ? sections.reduce((total, section) => total + section.byteLength, 0)
      : 0
  const diagnostics = [
    ...getDocumentDiagnostics(document),
    ...(geometry.issues ?? []),
  ]
  if (document.kind === "binary") {
    for (const section of sections) {
      if (section.status === "opaque") {
        diagnostics.push({
          code: "binary-unsupported-section",
          severity: "warning",
          category: "unsupported",
          message: `Binary section ${section.id} (${section.byteLength} bytes) is preserved but not semantically decoded`,
          source: {
            format: "binary",
            sourceId: section.id,
            sectionIndex: Number(section.id.split(":")[1]),
            span: { startOffset: 0, endOffset: section.byteLength },
          },
        })
      }
    }
  }

  return {
    schemaVersion: "1",
    format: document.kind,
    version:
      document.kind === "binary"
        ? `0x${document.version.toString(16)}`
        : document.version,
    units: geometry.sourceUnits,
    coordinateUnit: geometry.coordinateUnit,
    ...(document.kind === "ascii" && document.boardSetup.origin
      ? {
          origin: {
            x: convertPadsCoordinateToNanometers(
              document.boardSetup.origin.x,
              document.units,
            ),
            y: convertPadsCoordinateToNanometers(
              document.boardSetup.origin.y,
              document.units,
            ),
          },
        }
      : {}),
    layerCount: geometry.layerCount,
    layers: geometry.layers,
    sections,
    entityCounts: {
      paths: geometry.paths.length,
      circles: geometry.circles.length,
      texts: geometry.texts.length,
      placements: geometry.placements.length,
      pads: geometry.pads.length,
      holes: geometry.holes.length,
      unresolvedVertices: geometry.unassignedVertices.length,
      unverifiedConnections: geometry.unverifiedConnections.length,
      unverifiedViaLocations: geometry.unverifiedViaLocations.length,
    },
    bounds: getBounds(geometry),
    coverage: {
      ...asciiCoverage,
      binaryByteLength,
      decodedBinaryBytes:
        document.kind === "binary"
          ? countBinaryBytesByStatus(sections, "decoded")
          : 0,
      partiallyDecodedBinaryBytes:
        document.kind === "binary"
          ? countBinaryBytesByStatus(sections, "partial")
          : 0,
      opaqueBinaryBytes:
        document.kind === "binary"
          ? countBinaryBytesByStatus(sections, "opaque")
          : 0,
    },
    diagnostics,
  }
}

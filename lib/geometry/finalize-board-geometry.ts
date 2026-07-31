import type { PadsDiagnostic, PadsDiagnosticCategory } from "../diagnostics"
import type { PadsSourceProvenance } from "../source-provenance"
import type { PadsBoardGeometry } from "./pads-board-geometry"

const slugifyDiagnosticCode = (message: string): string => {
  const normalizedMessage = message
    .replace(/^\d+\s+/u, "")
    .replace(/\([^)]*\)/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .split("-")
    .slice(0, 7)
    .join("-")
  return `geometry-${normalizedMessage || "diagnostic"}`
}

const getDiagnosticCategory = (message: string): PadsDiagnosticCategory => {
  if (
    /malformed|could not|rejected|missing|invalid|unmatched/iu.test(message)
  ) {
    return "malformed"
  }
  if (/candidate|inferred|identify|unverified/iu.test(message)) {
    return "inferred"
  }
  if (/approx/iu.test(message)) return "approximate"
  return "unsupported"
}

const toStructuredDiagnostic = (message: string): PadsDiagnostic => ({
  code: slugifyDiagnosticCode(message),
  severity: "warning",
  category: getDiagnosticCategory(message),
  message,
})

const getStableEntityId = ({
  kind,
  index,
  source,
}: {
  kind: string
  index: number
  source?: PadsSourceProvenance
}): string =>
  source ? `${kind}:${index}:${source.sourceId}` : `${kind}:${index}`

export const finalizePadsBoardGeometry = (
  geometry: PadsBoardGeometry,
): PadsBoardGeometry => {
  const paths = geometry.paths.map((path, index) => ({
    ...path,
    id:
      path.id ??
      getStableEntityId({ kind: "path", index, source: path.source }),
  }))
  const circles = geometry.circles.map((circle, index) => ({
    ...circle,
    id:
      circle.id ??
      getStableEntityId({ kind: "circle", index, source: circle.source }),
  }))
  const texts = geometry.texts.map((text, index) => ({
    ...text,
    id:
      text.id ??
      getStableEntityId({ kind: "text", index, source: text.source }),
  }))
  const placements = geometry.placements.map((placement, index) => ({
    ...placement,
    id:
      placement.id ??
      getStableEntityId({
        kind: "placement",
        index,
        source: placement.source,
      }),
  }))
  const pads = geometry.pads.map((pad, index) => ({
    ...pad,
    id: pad.id ?? getStableEntityId({ kind: "pad", index, source: pad.source }),
  }))
  const holes = geometry.holes.map((hole, index) => ({
    ...hole,
    id:
      hole.id ??
      getStableEntityId({ kind: "hole", index, source: hole.source }),
  }))
  const unassignedVertices = geometry.unassignedVertices.map(
    (point, index) => ({
      ...point,
      id:
        point.id ??
        getStableEntityId({
          kind: "unassigned-vertex",
          index,
          source: point.source,
        }),
    }),
  )
  const unverifiedConnections = geometry.unverifiedConnections.map(
    (path, index) => ({
      ...path,
      id:
        path.id ??
        getStableEntityId({
          kind: "unverified-connection",
          index,
          source: path.source,
        }),
    }),
  )
  const unverifiedViaLocations = geometry.unverifiedViaLocations.map(
    (point, index) => ({
      ...point,
      id:
        point.id ??
        getStableEntityId({
          kind: "unverified-via-location",
          index,
          source: point.source,
        }),
    }),
  )
  const issues =
    geometry.issues ??
    geometry.diagnostics.map((message) => toStructuredDiagnostic(message))
  const normalizedEntityCount =
    paths.length +
    circles.length +
    texts.length +
    placements.length +
    pads.length +
    holes.length
  const entitiesWithProvenance = [
    ...paths,
    ...circles,
    ...texts,
    ...placements,
    ...pads,
    ...holes,
  ].filter((entity) => entity.source !== undefined).length

  return {
    ...geometry,
    paths,
    circles,
    texts,
    placements,
    pads,
    holes,
    unassignedVertices,
    unverifiedConnections,
    unverifiedViaLocations,
    issues,
    coverage: {
      normalizedEntityCount,
      entitiesWithProvenance,
      entitiesWithoutProvenance: normalizedEntityCount - entitiesWithProvenance,
      binarySectionCount: geometry.binarySections.length,
      binaryByteLength: geometry.binarySections.reduce(
        (total, section) => total + section.byteLength,
        0,
      ),
    },
  }
}

import type {
  PadsBinaryDirectoryEntry,
  PadsBinaryDocument,
  PadsBinarySection,
} from "../binary"
import type {
  PadsBinarySectionSummary,
  PadsBoardGeometry,
  PadsGeometryCircle,
  PadsGeometryLayerInfo,
  PadsGeometryPath,
  PadsGeometryPlacement,
  PadsGeometryPoint,
  PadsGeometryText,
} from "./pads-board-geometry"

const ANGLE_SCALE = 1_800_000

class BinarySectionReader {
  readonly bytes: Uint8Array

  constructor(bytes: Uint8Array) {
    this.bytes = bytes
  }

  readUint8(offset: number): number | undefined {
    return this.bytes[offset]
  }

  readUint16(offset: number): number | undefined {
    const firstByte = this.bytes[offset]
    const secondByte = this.bytes[offset + 1]
    if (firstByte === undefined || secondByte === undefined) return undefined
    return firstByte + secondByte * 0x100
  }

  readUint32(offset: number): number | undefined {
    const firstByte = this.bytes[offset]
    const secondByte = this.bytes[offset + 1]
    const thirdByte = this.bytes[offset + 2]
    const fourthByte = this.bytes[offset + 3]
    if (
      firstByte === undefined ||
      secondByte === undefined ||
      thirdByte === undefined ||
      fourthByte === undefined
    ) {
      return undefined
    }

    return (
      firstByte +
      secondByte * 0x100 +
      thirdByte * 0x10000 +
      fourthByte * 0x1000000
    )
  }

  readInt32(offset: number): number | undefined {
    const unsignedNumber = this.readUint32(offset)
    if (unsignedNumber === undefined) return undefined
    return unsignedNumber > 0x7fffffff
      ? unsignedNumber - 0x1_0000_0000
      : unsignedNumber
  }

  readFixedString(offset: number, maximumLength: number): string {
    const availableEnd = Math.min(offset + maximumLength, this.bytes.length)
    if (offset < 0 || offset >= availableEnd) return ""

    let stringEnd = offset
    while (
      stringEnd < availableEnd &&
      this.bytes[stringEnd] !== 0 &&
      this.bytes[stringEnd] !== 0xff
    ) {
      stringEnd++
    }

    return new TextDecoder()
      .decode(this.bytes.slice(offset, stringEnd))
      .trimEnd()
  }
}

const getSection = (
  document: PadsBinaryDocument,
  index: number,
): PadsBinarySection | undefined => document.getSection(index)

const getBytesPerRecord = (entry: PadsBinaryDirectoryEntry): number =>
  entry.recordCount > 0 ? entry.byteLength / entry.recordCount : 0

const getOrigin = (document: PadsBinaryDocument): PadsGeometryPoint => {
  const setupSection = getSection(document, 1)
  if (!setupSection) return { x: 0, y: 0 }
  const setupReader = new BinarySectionReader(setupSection.bytes)
  return {
    x: setupReader.readInt32(60) ?? 0,
    y: setupReader.readInt32(64) ?? 0,
  }
}

const toBoardPoint = ({
  x,
  y,
  origin,
}: {
  x: number
  y: number
  origin: PadsGeometryPoint
}): PadsGeometryPoint => ({
  x: x - origin.x,
  y: y - origin.y,
})

const readLineVertices = ({
  document,
  origin,
}: {
  document: PadsBinaryDocument
  origin: PadsGeometryPoint
}): PadsGeometryPoint[] => {
  const vertexSection = getSection(document, 12)
  if (!vertexSection) return []

  const vertexReader = new BinarySectionReader(vertexSection.bytes)
  const vertexCount = Math.min(
    vertexSection.recordCount,
    Math.floor(vertexSection.bytes.length / 12),
  )
  const vertices: PadsGeometryPoint[] = []
  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex++) {
    const recordOffset = vertexIndex * 12
    const x = vertexReader.readInt32(recordOffset)
    const y = vertexReader.readInt32(recordOffset + 4)
    if (x === undefined || y === undefined) continue
    vertices.push(toBoardPoint({ x, y, origin }))
  }
  return vertices
}

const addDecodedOutline = ({
  document,
  vertices,
  paths,
  diagnostics,
}: {
  document: PadsBinaryDocument
  vertices: PadsGeometryPoint[]
  paths: PadsGeometryPath[]
  diagnostics: string[]
}): void => {
  if (document.version !== 0x2026) {
    diagnostics.push(
      `native binary outline records are not decoded for version 0x${document.version.toString(16)}`,
    )
    return
  }

  const outlineSection = getSection(document, 21)
  if (!outlineSection) return
  const outlineReader = new BinarySectionReader(outlineSection.bytes)
  let vertexIndex = 0

  for (
    let recordIndex = 0;
    recordIndex < outlineSection.recordCount;
    recordIndex++
  ) {
    const recordOffset = recordIndex * 16
    const vertexCount = outlineReader.readUint32(recordOffset)
    const sentinel = outlineReader.readUint32(recordOffset + 12)
    if (
      vertexCount === undefined ||
      sentinel !== 0xffffffff ||
      vertexCount === 0 ||
      vertexCount > 10_000 ||
      vertexIndex + vertexCount > vertices.length
    ) {
      continue
    }

    const outlinePoints = vertices.slice(vertexIndex, vertexIndex + vertexCount)
    vertexIndex += vertexCount
    if (outlinePoints.length < 3) continue

    paths.push({
      kind: "drawing",
      points: outlinePoints,
      closed: true,
      width: 0,
      layer: 1,
      name: `binary-section21-candidate-${recordIndex}`,
    })
  }

  if (paths.some((path) => path.name?.startsWith("binary-section21-"))) {
    diagnostics.push(
      "version 0x2026 section 21 candidate paths are shown as unverified drawings",
    )
  }
}

const resolvePoolString = ({
  stringPool,
  byteOffset,
}: {
  stringPool: Uint8Array
  byteOffset: number
}): string => {
  if (byteOffset < 0 || byteOffset >= stringPool.length) return ""
  let stringEnd = byteOffset
  while (stringEnd < stringPool.length && stringPool[stringEnd] !== 0) {
    const characterCode = stringPool[stringEnd]
    if (
      characterCode === undefined ||
      characterCode < 0x20 ||
      characterCode >= 0x7f
    ) {
      return ""
    }
    stringEnd++
  }
  return new TextDecoder().decode(stringPool.slice(byteOffset, stringEnd))
}

const addTextRecords = ({
  document,
  origin,
  texts,
}: {
  document: PadsBinaryDocument
  origin: PadsGeometryPoint
  texts: PadsGeometryText[]
}): void => {
  const textSection = getSection(document, 8)
  const stringPoolSection = getSection(document, 57)
  if (!textSection || !stringPoolSection) return

  const textReader = new BinarySectionReader(textSection.bytes)
  const recordSize = getBytesPerRecord(textSection.directoryEntry)
  if (!Number.isInteger(recordSize) || recordSize < 72) return

  for (
    let recordIndex = 0;
    recordIndex < textSection.recordCount;
    recordIndex++
  ) {
    const recordOffset = recordIndex * recordSize
    const stringOffset = textReader.readUint32(recordOffset)
    const height = textReader.readInt32(recordOffset + 28)
    const strokeWidth = textReader.readInt32(recordOffset + 32)
    const x = textReader.readInt32(recordOffset + 44)
    const y = textReader.readInt32(recordOffset + 48)
    const rawRotation = textReader.readInt32(recordOffset + 52)
    const layer = textReader.readUint8(recordOffset + 56)
    if (
      stringOffset === undefined ||
      height === undefined ||
      strokeWidth === undefined ||
      x === undefined ||
      y === undefined ||
      rawRotation === undefined ||
      layer === undefined
    ) {
      continue
    }

    const content = resolvePoolString({
      stringPool: stringPoolSection.bytes,
      byteOffset: stringOffset,
    })
    if (!content) continue

    texts.push({
      content,
      location: toBoardPoint({ x, y, origin }),
      height: Math.abs(height),
      strokeWidth: Math.abs(strokeWidth),
      rotation: rawRotation / ANGLE_SCALE,
      mirrored: false,
      layer,
    })
  }
}

const detectRouteMarkerOffset = (
  vertexSection: PadsBinarySection,
): number | undefined => {
  const recordSize = getBytesPerRecord(vertexSection.directoryEntry)
  if (!Number.isInteger(recordSize) || recordSize < 18) return undefined

  const sampleCount = Math.min(vertexSection.recordCount, 100)
  let bestOffset: number | undefined
  let bestHitCount = 0
  for (
    let candidateOffset = 8;
    candidateOffset < 28 && candidateOffset + 8 < recordSize;
    candidateOffset++
  ) {
    let hitCount = 0
    for (let recordIndex = 0; recordIndex < sampleCount; recordIndex++) {
      if (
        vertexSection.bytes[recordIndex * recordSize + candidateOffset] === 0x80
      ) {
        hitCount++
      }
    }
    if (hitCount > bestHitCount) {
      bestOffset = candidateOffset
      bestHitCount = hitCount
    }
  }

  return bestHitCount >= sampleCount / 2 ? bestOffset : undefined
}

const addRouteGeometry = ({
  document,
  origin,
  paths,
  circles,
  diagnostics,
}: {
  document: PadsBinaryDocument
  origin: PadsGeometryPoint
  paths: PadsGeometryPath[]
  circles: PadsGeometryCircle[]
  diagnostics: string[]
}): void => {
  if (document.version === 0x2021) {
    diagnostics.push("native binary routes are not decoded for version 0x2021")
    return
  }

  const connectionSection = getSection(document, 24)
  const vertexSection = getSection(document, 60)
  if (!connectionSection || !vertexSection) return

  const markerOffset = detectRouteMarkerOffset(vertexSection)
  if (markerOffset === undefined) {
    diagnostics.push("could not identify the native route vertex marker")
    return
  }

  const connectionRecordSize = getBytesPerRecord(
    connectionSection.directoryEntry,
  )
  const vertexRecordSize = getBytesPerRecord(vertexSection.directoryEntry)
  if (connectionRecordSize !== 68 || !Number.isInteger(vertexRecordSize)) {
    diagnostics.push("native route record sizes are not recognized")
    return
  }

  const connectionReader = new BinarySectionReader(connectionSection.bytes)
  const vertexReader = new BinarySectionReader(vertexSection.bytes)
  const readRouteVertex = (
    recordIndex: number,
  ): PadsGeometryPoint | undefined => {
    if (recordIndex < 0 || recordIndex >= vertexSection.recordCount) {
      return undefined
    }
    const recordOffset = recordIndex * vertexRecordSize
    if (vertexReader.readUint8(recordOffset + markerOffset) !== 0x80) {
      return undefined
    }
    const x = vertexReader.readInt32(recordOffset + markerOffset + 1)
    const y = vertexReader.readInt32(recordOffset + markerOffset + 5)
    if (x === undefined || y === undefined) return undefined
    return toBoardPoint({ x, y, origin })
  }

  for (
    let recordIndex = 0;
    recordIndex < connectionSection.recordCount;
    recordIndex++
  ) {
    const recordOffset = recordIndex * connectionRecordSize
    if (connectionReader.readUint32(recordOffset + 20) !== 0xfe000000) {
      continue
    }

    const startIndex = connectionReader.readInt32(recordOffset + 8)
    const endIndex = connectionReader.readInt32(recordOffset + 12)
    const width = connectionReader.readInt32(recordOffset + 24) ?? 0
    if (startIndex === undefined || endIndex === undefined) continue

    const startPoint = readRouteVertex(startIndex)
    const endPoint = readRouteVertex(endIndex)
    if (!startPoint || !endPoint) continue

    paths.push({
      kind: "route",
      points: [startPoint, endPoint],
      closed: false,
      width: Math.abs(width),
      layer: 0,
    })
  }

  const viaSection = getSection(document, 59)
  if (!viaSection) return
  const viaRecordSize = getBytesPerRecord(viaSection.directoryEntry)
  if (!Number.isInteger(viaRecordSize)) return

  const viaReader = new BinarySectionReader(viaSection.bytes)
  for (
    let recordIndex = 0;
    recordIndex < viaSection.recordCount;
    recordIndex++
  ) {
    const recordOffset = recordIndex * viaRecordSize
    if (viaReader.readUint8(recordOffset + markerOffset) !== 0x80) continue
    const x = viaReader.readInt32(recordOffset + markerOffset + 1)
    const y = viaReader.readInt32(recordOffset + markerOffset + 5)
    if (x === undefined || y === undefined) continue
    circles.push({
      kind: "via",
      center: toBoardPoint({ x, y, origin }),
      radius: 100_000,
      width: 25_000,
      layer: 0,
    })
  }
}

const addPlacementGeometry = ({
  document,
  origin,
  placements,
  diagnostics,
}: {
  document: PadsBinaryDocument
  origin: PadsGeometryPoint
  placements: PadsGeometryPlacement[]
  diagnostics: string[]
}): void => {
  if (document.version === 0x2021) {
    diagnostics.push(
      "native binary version 0x2021 placement Y coordinates are not decoded",
    )
    return
  }

  const placementSection = getSection(document, 22)
  if (!placementSection) return
  const recordSize = getBytesPerRecord(placementSection.directoryEntry)
  if (!Number.isInteger(recordSize) || recordSize < 72) return

  const placementReader = new BinarySectionReader(placementSection.bytes)
  for (
    let recordIndex = 0;
    recordIndex < placementSection.recordCount;
    recordIndex++
  ) {
    const recordOffset = recordIndex * recordSize
    const reference = placementReader.readFixedString(recordOffset + 44, 16)
    const x = placementReader.readInt32(recordOffset + 60)
    const y = placementReader.readInt32(recordOffset + 64)
    const rawRotation = placementReader.readInt32(recordOffset + 68)
    if (
      !/^[A-Za-z0-9]/u.test(reference) ||
      x === undefined ||
      y === undefined ||
      rawRotation === undefined
    ) {
      continue
    }

    placements.push({
      reference,
      location: toBoardPoint({ x, y, origin }),
      rotation: rawRotation / ANGLE_SCALE,
      bottomLayer: false,
    })
  }
}

const getLayerCount = (document: PadsBinaryDocument): number => {
  const setupSection = getSection(document, 1)
  if (!setupSection) return 2
  const setupReader = new BinarySectionReader(setupSection.bytes)
  const layerCount = setupReader.readUint32(16)
  return layerCount && layerCount <= 64 ? layerCount : 2
}

const getSectionSummaries = (
  document: PadsBinaryDocument,
): PadsBinarySectionSummary[] =>
  document.directoryEntries
    .filter((entry) => entry.index > 0 && entry.byteLength > 0)
    .map((entry) => ({
      index: entry.index,
      recordCount: entry.recordCount,
      byteLength: entry.byteLength,
      bytesPerRecord: getBytesPerRecord(entry),
    }))

const getLayerInfo = (layerCount: number): PadsGeometryLayerInfo[] =>
  Array.from({ length: layerCount }, (_, layerIndex) => ({
    number: layerIndex + 1,
    name:
      layerIndex === 0
        ? "TOP"
        : layerIndex === layerCount - 1
          ? "BOTTOM"
          : `LAYER ${layerIndex + 1}`,
  }))

export const extractBinaryBoardGeometry = (
  document: PadsBinaryDocument,
): PadsBoardGeometry => {
  const origin = getOrigin(document)
  const paths: PadsGeometryPath[] = []
  const circles: PadsGeometryCircle[] = []
  const texts: PadsGeometryText[] = []
  const placements: PadsGeometryPlacement[] = []
  const diagnostics: string[] = []
  const vertices = readLineVertices({ document, origin })

  addDecodedOutline({ document, vertices, paths, diagnostics })
  addRouteGeometry({ document, origin, paths, circles, diagnostics })
  addTextRecords({ document, origin, texts })
  addPlacementGeometry({ document, origin, placements, diagnostics })

  const layerCount = getLayerCount(document)
  return {
    sourceFormat: "binary",
    version: `0x${document.version.toString(16)}`,
    layerCount,
    layers: getLayerInfo(layerCount),
    paths,
    circles,
    texts,
    placements,
    unassignedVertices: vertices,
    binarySections: getSectionSummaries(document),
    diagnostics,
  }
}

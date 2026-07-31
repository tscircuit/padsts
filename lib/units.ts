import type { PadsAsciiUnits } from "./ascii"

export type PadsInternalCoordinateUnit = "nanometer"

export const PADS_INTERNAL_COORDINATE_UNIT: PadsInternalCoordinateUnit =
  "nanometer"

const NANOMETERS_PER_SOURCE_UNIT: Record<
  Exclude<PadsAsciiUnits, "unknown">,
  number
> = {
  BASIC: 2 / 3,
  MILS: 25_400,
  INCHES: 25_400_000,
  METRIC: 1_000_000,
}

const MAXIMUM_ABSOLUTE_SOURCE_COORDINATE: Record<
  Exclude<PadsAsciiUnits, "unknown">,
  number
> = {
  BASIC: 2_133_600_000,
  MILS: 56_000,
  INCHES: 56,
  METRIC: 1_422.4,
}

export const getPadsNanometersPerSourceUnit = (
  sourceUnits: PadsAsciiUnits,
): number | undefined =>
  sourceUnits === "unknown"
    ? undefined
    : NANOMETERS_PER_SOURCE_UNIT[sourceUnits]

export const convertPadsCoordinateToNanometers = (
  coordinate: number,
  sourceUnits: PadsAsciiUnits,
): number => {
  const scale = getPadsNanometersPerSourceUnit(sourceUnits)
  if (scale === undefined) {
    throw new RangeError(`Cannot convert unknown PADS coordinate units`)
  }
  const convertedCoordinate = coordinate * scale
  if (!Number.isFinite(convertedCoordinate)) {
    throw new RangeError(`PADS coordinate is not finite after unit conversion`)
  }
  return convertedCoordinate
}

export const convertNanometersToPadsCoordinate = (
  coordinate: number,
  targetUnits: PadsAsciiUnits,
): number => {
  const scale = getPadsNanometersPerSourceUnit(targetUnits)
  if (scale === undefined) {
    throw new RangeError(`Cannot convert unknown PADS coordinate units`)
  }
  const convertedCoordinate = coordinate / scale
  if (!Number.isFinite(convertedCoordinate)) {
    throw new RangeError(`PADS coordinate is not finite after unit conversion`)
  }
  return convertedCoordinate
}

export const isPadsSourceCoordinateInRange = (
  coordinate: number,
  sourceUnits: PadsAsciiUnits,
): boolean => {
  if (!Number.isFinite(coordinate) || sourceUnits === "unknown") return false
  return Math.abs(coordinate) <= MAXIMUM_ABSOLUTE_SOURCE_COORDINATE[sourceUnits]
}

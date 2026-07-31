import type { PadsSourceProvenance } from "../source-provenance"
import type { PadsAsciiUnits } from "./pads-ascii-document"
import type { PadsAsciiSection } from "./pads-ascii-section"

export interface PadsAsciiBoardSetup {
  units: PadsAsciiUnits
  coordinatePrecision?: number
  origin?: { x: number; y: number }
  maximumLayer?: number
  defaultTraceWidth?: number
  viaGrid?: { x: number; y: number }
  userGrid?: { x: number; y: number }
  jobName?: string
  settings: Record<string, string[][]>
  sourceRecords: PadsSourceProvenance[]
}

const getCoordinatePrecision = (units: PadsAsciiUnits): number | undefined => {
  if (units === "BASIC") return 1
  if (units === "MILS") return 0.01
  if (units === "INCHES") return 0.00001
  if (units === "METRIC") return 0.0001
  return undefined
}

const toFiniteNumber = (value: string | undefined): number | undefined => {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : undefined
}

const getPair = (values: string[] | undefined) => {
  const x = toFiniteNumber(values?.[0])
  const y = toFiniteNumber(values?.[1] ?? values?.[0])
  return x !== undefined && y !== undefined ? { x, y } : undefined
}

export const parsePadsAsciiBoardSetup = (
  sections: PadsAsciiSection[],
  units: PadsAsciiUnits,
): PadsAsciiBoardSetup => {
  const settings: Record<string, string[][]> = {}
  const sourceRecords: PadsSourceProvenance[] = []
  for (const section of sections) {
    if (section.name !== "PCB") continue
    for (const record of section.records) {
      if (record.kind !== "data") continue
      const [keyToken, ...valueTokens] = record.tokens
      const key = keyToken?.value.toUpperCase()
      if (!key) continue
      const values = valueTokens.map(({ value }) => value)
      const existingValues = settings[key] ?? []
      existingValues.push(values)
      settings[key] = existingValues
      sourceRecords.push(record.provenance)
    }
  }

  const origin = getPair(settings.ORIGIN?.[0])
  const maximumLayerValue =
    toFiniteNumber(settings.MAXIMUMLAYER?.[0]?.[0]) ??
    toFiniteNumber(settings.MAXLAYER?.[0]?.[0])
  const defaultTraceWidth = toFiniteNumber(settings.LINEWIDTH?.[0]?.[0])
  const viaGrid = getPair(settings.PSVIAGRID?.[0])
  const userGrid = getPair(settings.USERGRID?.[0])
  const jobName = settings.JOBNAME?.[0]?.join(" ")

  return {
    units,
    coordinatePrecision: getCoordinatePrecision(units),
    ...(origin ? { origin } : {}),
    ...(maximumLayerValue !== undefined
      ? { maximumLayer: Math.trunc(maximumLayerValue) }
      : {}),
    ...(defaultTraceWidth !== undefined ? { defaultTraceWidth } : {}),
    ...(viaGrid ? { viaGrid } : {}),
    ...(userGrid ? { userGrid } : {}),
    ...(jobName ? { jobName } : {}),
    settings,
    sourceRecords,
  }
}

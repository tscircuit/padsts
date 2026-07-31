#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises"
import { convertPadsToCircuitJson } from "./circuit-json"
import { createPadsConversionReport, validatePads } from "./conversion-report"
import { inspectPads, type PadsInspection } from "./inspection"
import { type GeneratePadsSvgOptions, generateSvgFromPads } from "./svg"

export interface PadsCliIo {
  readFile(path: string): Promise<Uint8Array>
  writeFile(path: string, bytes: string | Uint8Array): Promise<void>
  stdout(message: string): void
  stderr(message: string): void
}

const defaultIo: PadsCliIo = {
  readFile: async (path) => new Uint8Array(await readFile(path)),
  writeFile: async (path, bytes) => writeFile(path, bytes),
  stdout: (message) => process.stdout.write(message),
  stderr: (message) => process.stderr.write(message),
}

const usage = `Usage:
  padsts inspect <file> [--json]
  padsts validate <file> [--strict] [--json]
  padsts to-svg <file> [-o <output.svg>] [--layers <a,b>] [--viewbox <x,y,w,h>] [--viewbox-source-units] [--debug]
  padsts to-circuit-json <file> [-o <output.json>] [--strict]
  padsts report <file> [--strict]
`

const getOption = (args: string[], name: string): string | undefined => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

const requireFile = (args: string[]): string => {
  const optionsWithValues = new Set(["-o", "--layers", "--viewbox"])
  for (let argumentIndex = 0; argumentIndex < args.length; argumentIndex++) {
    const argument = args[argumentIndex]
    if (argument === undefined) continue
    if (optionsWithValues.has(argument)) {
      argumentIndex++
      continue
    }
    if (!argument.startsWith("-")) return argument
  }
  throw new Error("A PADS input file is required")
}

const formatInspection = (inspection: PadsInspection): string => {
  const entityCounts = Object.entries(inspection.entityCounts)
    .map(([name, count]) => `${name}=${count}`)
    .join(", ")
  const coverage = inspection.coverage
  return [
    `Format: ${inspection.format}`,
    `Version: ${inspection.version}`,
    `Units: ${inspection.units} → ${inspection.coordinateUnit}`,
    `Layers: ${inspection.layerCount}`,
    `Sections: ${inspection.sections.length}`,
    `Entities: ${entityCounts}`,
    `Coverage: source records ${coverage.decodedSourceRecords} decoded, ${coverage.partiallyDecodedSourceRecords} partial, ${coverage.skippedSourceRecords} skipped, ${coverage.malformedSourceRecords} malformed`,
    `Binary bytes: ${coverage.decodedBinaryBytes} decoded, ${coverage.partiallyDecodedBinaryBytes} partial, ${coverage.opaqueBinaryBytes} opaque`,
    `Diagnostics: ${inspection.diagnostics.length}`,
    ...inspection.diagnostics.map(
      ({ code, severity, message }) => `  [${severity}] ${code}: ${message}`,
    ),
    "",
  ].join("\n")
}

const parseViewBox = (
  serializedViewBox: string | undefined,
): GeneratePadsSvgOptions["viewBox"] => {
  if (!serializedViewBox) return undefined
  const values = serializedViewBox.split(",").map(Number)
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
    throw new Error("--viewbox must be four comma-separated numbers: x,y,w,h")
  }
  const [x, y, width, height] = values
  if (
    x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined
  ) {
    throw new Error("--viewbox must be four comma-separated numbers: x,y,w,h")
  }
  return { x, y, width, height }
}

export const runPadsCli = async (
  args: string[],
  io: PadsCliIo = defaultIo,
): Promise<number> => {
  const [command, ...commandArgs] = args
  if (!command || command === "--help" || command === "-h") {
    io.stdout(usage)
    return 0
  }

  try {
    const inputPath = requireFile(commandArgs)
    const sourceBytes = await io.readFile(inputPath)

    if (command === "inspect") {
      const inspection = inspectPads(sourceBytes)
      io.stdout(
        commandArgs.includes("--json")
          ? `${JSON.stringify(inspection, null, 2)}\n`
          : formatInspection(inspection),
      )
      return 0
    }

    if (command === "validate") {
      const strict = commandArgs.includes("--strict")
      const result = validatePads(sourceBytes, { strict })
      if (commandArgs.includes("--json")) {
        io.stdout(`${JSON.stringify(result, null, 2)}\n`)
      } else {
        io.stdout(
          `${result.valid ? "Valid" : "Invalid"} PADS input (${result.report.diagnostics.length} diagnostics, lossless=${result.report.lossless})\n`,
        )
        for (const diagnostic of result.report.diagnostics) {
          io.stdout(
            `[${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}\n`,
          )
        }
      }
      return result.exitCode
    }

    if (command === "to-svg") {
      const outputPath = getOption(commandArgs, "-o")
      const layers = getOption(commandArgs, "--layers")
      const debug = commandArgs.includes("--debug")
      const options: GeneratePadsSvgOptions = {
        viewBox: parseViewBox(getOption(commandArgs, "--viewbox")),
        viewBoxUnits: commandArgs.includes("--viewbox-source-units")
          ? "source"
          : "normalized",
        visibleGerberLayers: layers
          ?.split(",")
          .map((layer) => layer.trim())
          .filter(Boolean),
        showBinarySectionSummary: debug,
        showUnassignedVertices: debug,
        showUnverifiedConnections: debug,
      }
      const svg = generateSvgFromPads(sourceBytes, options)
      if (outputPath) {
        await io.writeFile(outputPath, svg)
      } else {
        io.stdout(svg)
      }
      return 0
    }

    if (command === "to-circuit-json") {
      const result = convertPadsToCircuitJson(sourceBytes, {
        strict: commandArgs.includes("--strict"),
      })
      const serializedCircuitJson = `${JSON.stringify(result.circuitJson, null, 2)}\n`
      const outputPath = getOption(commandArgs, "-o")
      if (outputPath) {
        await io.writeFile(outputPath, serializedCircuitJson)
      } else {
        io.stdout(serializedCircuitJson)
      }
      return result.report.strict && !result.report.lossless ? 1 : 0
    }

    if (command === "report") {
      const report = createPadsConversionReport(sourceBytes, {
        strict: commandArgs.includes("--strict"),
      })
      io.stdout(`${JSON.stringify(report, null, 2)}\n`)
      return report.strict && !report.lossless ? 1 : 0
    }

    io.stderr(`Unknown command ${JSON.stringify(command)}\n${usage}`)
    return 2
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }
}

if (import.meta.main) {
  process.exitCode = await runPadsCli(process.argv.slice(2))
}

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { convertPadsToCircuitJson, toCircuitJson } from "../lib"

const fixture = readFileSync(
  join(import.meta.dir, "fixtures/placed-decals.asc"),
  "utf8",
)

describe("Circuit JSON conversion", () => {
  test("maps verified board, component, pad, hole, via, and trace geometry in millimeters", () => {
    const circuitJson = toCircuitJson(fixture)
    const board = circuitJson.find(({ type }) => type === "pcb_board")
    const components = circuitJson.filter(
      ({ type }) => type === "pcb_component",
    )
    const pads = circuitJson.filter(({ type }) => type === "pcb_smtpad")

    expect(board).toMatchObject({
      type: "pcb_board",
      num_layers: 2,
      shape: "polygon",
      width: 12.7,
      height: 7.62,
    })
    expect(components).toHaveLength(2)
    expect(pads).toHaveLength(8)
    expect(pads[0]).toMatchObject({
      type: "pcb_smtpad",
      layer: "top",
      shape: "circle",
    })
    expect(Number(pads[0]?.x)).toBeCloseTo(2.254727)
    expect(Number(pads[0]?.y)).toBeCloseTo(4.250205)
    expect(
      circuitJson.every((element) =>
        Object.values(element).every(
          (value) => typeof value !== "number" || Number.isFinite(value),
        ),
      ),
    ).toBe(true)
  })

  test("preserves source identity in stable output IDs and reports strict loss", () => {
    const result = convertPadsToCircuitJson(fixture, { strict: true })
    const ids = result.circuitJson.flatMap((element) =>
      Object.entries(element)
        .filter(([name]) => name.endsWith("_id"))
        .map(([, value]) => value),
    )

    expect(ids.some((id) => String(id).includes("ascii_"))).toBe(true)
    expect(result.report.lossless).toBe(false)
    expect(result.report.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "strict-circuit-json-conversion-would-be-lossy",
        severity: "error",
      }),
    )
  })
})

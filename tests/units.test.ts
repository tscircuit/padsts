import { describe, expect, test } from "bun:test"
import {
  convertNanometersToPadsCoordinate,
  convertPadsCoordinateToNanometers,
  isPadsSourceCoordinateInRange,
  PADS_INTERNAL_COORDINATE_UNIT,
  type PadsAsciiUnits,
} from "../lib"

describe("PADS coordinate units", () => {
  test("normalizes every declared ASCII unit to nanometers", () => {
    expect(PADS_INTERNAL_COORDINATE_UNIT).toBe("nanometer")
    expect(convertPadsCoordinateToNanometers(3, "BASIC")).toBe(2)
    expect(convertPadsCoordinateToNanometers(1, "MILS")).toBe(25_400)
    expect(convertPadsCoordinateToNanometers(1, "INCHES")).toBe(25_400_000)
    expect(convertPadsCoordinateToNanometers(1, "METRIC")).toBe(1_000_000)
  })

  test("round-trips negative and large coordinates in every unit system", () => {
    const samples: [PadsAsciiUnits, number[]][] = [
      ["BASIC", [-2_133_600_000, -3, 0, 3, 2_133_600_000]],
      ["MILS", [-56_000, -0.01, 0, 0.01, 56_000]],
      ["INCHES", [-56, -0.00001, 0, 0.00001, 56]],
      ["METRIC", [-1_422.4, -0.0001, 0, 0.0001, 1_422.4]],
    ]

    for (const [units, coordinates] of samples) {
      for (const coordinate of coordinates) {
        const nanometers = convertPadsCoordinateToNanometers(coordinate, units)
        expect(
          convertNanometersToPadsCoordinate(nanometers, units),
        ).toBeCloseTo(coordinate, 10)
        expect(isPadsSourceCoordinateInRange(coordinate, units)).toBe(true)
      }
    }
  })

  test("rejects unknown, non-finite, and out-of-range coordinates", () => {
    expect(() => convertPadsCoordinateToNanometers(1, "unknown")).toThrow(
      RangeError,
    )
    expect(() => convertNanometersToPadsCoordinate(1, "unknown")).toThrow(
      RangeError,
    )
    expect(isPadsSourceCoordinateInRange(Number.NaN, "BASIC")).toBe(false)
    expect(isPadsSourceCoordinateInRange(2_133_600_001, "BASIC")).toBe(false)
    expect(isPadsSourceCoordinateInRange(56.00001, "INCHES")).toBe(false)
  })
})

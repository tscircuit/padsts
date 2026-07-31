import { describe, expect, test } from "bun:test"
import { type PadsCliIo, runPadsCli } from "../lib/cli"

const sourceBytes = new TextEncoder().encode(
  [
    "!PADS-POWERPCB-V9.5-MILS! DESIGN DATABASE ASCII FILE 1.0",
    "*PCB*",
    "UNITS 0",
    "*END*",
    "",
  ].join("\n"),
)

const createIo = () => {
  let stdout = ""
  let stderr = ""
  const writes = new Map<string, string | Uint8Array>()
  const io: PadsCliIo = {
    readFile: async () => sourceBytes,
    writeFile: async (path, bytes) => {
      writes.set(path, bytes)
    },
    stdout: (message) => {
      stdout += message
    },
    stderr: (message) => {
      stderr += message
    },
  }
  return {
    io,
    writes,
    get stdout() {
      return stdout
    },
    get stderr() {
      return stderr
    },
  }
}

describe("padsts CLI", () => {
  test("prints machine-readable inspection JSON", async () => {
    const state = createIo()
    expect(await runPadsCli(["inspect", "board.asc", "--json"], state.io)).toBe(
      0,
    )
    expect(JSON.parse(state.stdout)).toMatchObject({
      format: "ascii",
      units: "MILS",
    })
    expect(state.stderr).toBe("")
  })

  test("writes an SVG with explicit board coordinates and layers", async () => {
    const state = createIo()
    expect(
      await runPadsCli(
        [
          "to-svg",
          "board.asc",
          "-o",
          "board.svg",
          "--viewbox",
          "0,0,1000000,500000",
          "--layers",
          "F_Cu,Edge_Cuts",
        ],
        state.io,
      ),
    ).toBe(0)
    expect(state.writes.get("board.svg")).toContain(
      'viewBox="0 -500000 1000000 500000"',
    )
  })

  test("accepts SVG viewboxes in the source file units", async () => {
    const state = createIo()
    expect(
      await runPadsCli(
        [
          "to-svg",
          "board.asc",
          "-o",
          "board.svg",
          "--viewbox",
          "10,20,30,40",
          "--viewbox-source-units",
        ],
        state.io,
      ),
    ).toBe(0)
    expect(state.writes.get("board.svg")).toContain(
      `viewBox="${10 * 25_400} ${-(20 + 40) * 25_400} ${30 * 25_400} ${40 * 25_400}"`,
    )
  })

  test("does not confuse option values before the input with the input path", async () => {
    let requestedPath = ""
    const state = createIo()
    state.io.readFile = async (path) => {
      requestedPath = path
      return sourceBytes
    }
    expect(
      await runPadsCli(
        ["to-svg", "-o", "board.svg", "--layers", "F_Cu", "board.asc"],
        state.io,
      ),
    ).toBe(0)
    expect(requestedPath).toBe("board.asc")
  })

  test("uses distinct validation and usage exit codes", async () => {
    const strictState = createIo()
    expect(
      await runPadsCli(["validate", "board.asc", "--strict"], strictState.io),
    ).toBe(1)

    const usageState = createIo()
    expect(await runPadsCli(["unknown", "board.asc"], usageState.io)).toBe(2)
    expect(usageState.stderr).toContain("Unknown command")
  })
})

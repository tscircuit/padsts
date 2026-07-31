import { describe, expect, test } from "bun:test"
import {
  convertPadsCoordinateToNanometers,
  detectPadsFormat,
  extractPadsBoardGeometry,
  generateSvgFromPads,
  PadsAsciiUnknownSection,
  parsePads,
  parsePadsAscii,
} from "../lib"

const fixtureUrl = new URL("./fixtures/minimal.asc", import.meta.url)
const basic = (coordinate: number): number =>
  convertPadsCoordinateToNanometers(coordinate, "BASIC")
const mils = (coordinate: number): number =>
  convertPadsCoordinateToNanometers(coordinate, "MILS")

describe("PADS ASCII", () => {
  test("parses typed board setup fields while retaining every setting", () => {
    const sourceText = [
      "!PADS-POWERPCB-V9.5-MILS! DESIGN DATABASE ASCII FILE 1.0",
      "*PCB*",
      "ORIGIN -12.5 20",
      "MAXIMUMLAYER 6",
      "LINEWIDTH 8",
      "PSVIAGRID 5 10",
      "USERGRID 2.5 2.5",
      'JOBNAME "RK3326 reference"',
      "FUTURE_SETUP 1 2 3",
      "*END*",
      "",
    ].join("\n")
    const setup = parsePadsAscii(sourceText).boardSetup

    expect(setup).toMatchObject({
      units: "MILS",
      coordinatePrecision: 0.01,
      origin: { x: -12.5, y: 20 },
      maximumLayer: 6,
      defaultTraceWidth: 8,
      viaGrid: { x: 5, y: 10 },
      userGrid: { x: 2.5, y: 2.5 },
      jobName: "RK3326 reference",
      settings: {
        FUTURE_SETUP: [["1", "2", "3"]],
      },
    })
    expect(setup.sourceRecords).toHaveLength(7)
  })

  test("parses sections and round-trips the original source", async () => {
    const sourceText = await Bun.file(fixtureUrl).text()
    const document = parsePadsAscii(sourceText)

    expect(document.kind).toBe("ascii")
    expect(document.version).toBe("V9.5")
    expect(document.units).toBe("BASIC")
    expect(document.sections.map((section) => section.name)).toEqual([
      "PADS-POWERPCB-V9.5-BASIC",
      "PCB",
      "FUTURE_RECORDS",
      "END",
    ])
    expect(document.getSection("FUTURE_RECORDS")).toBeInstanceOf(
      PadsAsciiUnknownSection,
    )
    expect(document.getString()).toBe(sourceText)
  })

  test("detects and parses ASCII bytes", async () => {
    const sourceBytes = new Uint8Array(await Bun.file(fixtureUrl).arrayBuffer())

    expect(detectPadsFormat(sourceBytes)).toBe("ascii")
    expect(parsePads(sourceBytes).kind).toBe("ascii")
  })

  test("preserves mixed line endings and a preamble", () => {
    const sourceText = "\r\n*PADS-POWERPCB-V9.5-METRIC*\r\n*PCB*\nBODY\r*END*"
    const document = parsePadsAscii(sourceText)

    expect(document.preambleText).toBe("\r\n")
    expect(document.units).toBe("METRIC")
    expect(document.getString()).toBe(sourceText)
  })

  test("parses the standard bang header and annotated section headers", () => {
    const sourceText =
      "!PADS-POWERPCB-V2005.0-BASIC! DESIGN DATABASE ASCII FILE 1.0\n" +
      "*PCB*        GENERAL PARAMETERS OF THE PCB DESIGN\n" +
      "UNITS 1\n" +
      "*END*     OF ASCII OUTPUT FILE\n"
    const document = parsePadsAscii(sourceText)

    expect(document.version).toBe("V2005.0")
    expect(document.units).toBe("BASIC")
    expect(document.sections.map((section) => section.name)).toEqual([
      "PADS-POWERPCB-V2005.0-BASIC",
      "PCB",
      "END",
    ])
    expect(document.getString()).toBe(sourceText)
  })

  test("keeps nested route markers inside their top-level section", () => {
    const sourceText = [
      "!PADS-POWERPCB-V9.5-MILS! DESIGN DATABASE ASCII FILE 1.0",
      "*ROUTE*",
      "*REMARK* route fields",
      '*SIGNAL* "NET WITH SPACES"',
      '"U1.1" "" "U2.1"',
      "*END*",
      "",
    ].join("\n")
    const document = parsePadsAscii(sourceText)
    const routeSection = document.getSection("ROUTE")

    expect(document.sections.map((section) => section.name)).toEqual([
      "PADS-POWERPCB-V9.5-MILS",
      "ROUTE",
      "END",
    ])
    expect(routeSection?.records.map((record) => record.kind)).toEqual([
      "remark",
      "nested-header",
      "data",
    ])
    expect(
      routeSection?.records[1]?.tokens.map((token) => token.value),
    ).toEqual(["*SIGNAL*", "NET WITH SPACES"])
    expect(
      routeSection?.records[2]?.tokens.map((token) => token.value),
    ).toEqual(["U1.1", "", "U2.1"])
    expect(routeSection?.records[2]?.tokens[1]).toMatchObject({
      quoted: true,
      rawText: '""',
    })
    expect(document.coverage.recordsByKind).toMatchObject({
      remark: 1,
      "nested-header": 1,
      data: 1,
    })
    expect(document.getString()).toBe(sourceText)
  })

  test("re-emits edited ASCII records without changing unrelated text", async () => {
    const sourceText = await Bun.file(fixtureUrl).text()
    const document = parsePadsAscii(sourceText)
    const pcbSection = document.getSection("PCB")
    const unitsRecord = pcbSection?.records.find(
      (record) => record.tokens[0]?.value === "UNITS",
    )
    expect(pcbSection).toBeDefined()
    expect(unitsRecord).toBeDefined()

    const editedSection = pcbSection?.withRecords(
      pcbSection.records.map((record) =>
        record === unitsRecord ? record.withTokens(["UNITS", "1"]) : record,
      ),
    )
    const editedDocument =
      pcbSection && editedSection
        ? document.replaceSection(pcbSection, editedSection)
        : document

    expect(editedDocument.getString()).toBe(
      sourceText.replace("UNITS 0", "UNITS 1"),
    )
    expect(parsePadsAscii(editedDocument.getString()).getString()).toBe(
      editedDocument.getString(),
    )
    expect(document.getString()).toBe(sourceText)
  })

  test("diagnoses a missing ASCII terminator without blocking inspection", () => {
    const document = parsePadsAscii(
      "*PADS-POWERPCB-V9.5-BASIC*\n*PCB*\nUNITS 0\n",
    )

    expect(document.diagnostics).toEqual([
      expect.objectContaining({
        code: "ascii-missing-end",
        severity: "warning",
        category: "validation",
      }),
    ])
  })

  test("omits layer-0 ratlines and thermal flags from fabrication geometry", () => {
    const sourceText = [
      "!PADS-POWERPCB-V9.5-BASIC! DESIGN DATABASE ASCII FILE 1.0",
      "*ROUTE*",
      "*SIGNAL* UNROUTED",
      "U1.1 U2.1",
      "0 0 0 10 1792 THERMAL",
      "100 100 65 10 1792 THERMAL",
      "",
      "*SIGNAL* ROUTED",
      "U1.2 U2.2",
      "0 0 1 10 0",
      "100 0 65 10 0",
      "*END*",
      "",
    ].join("\n")
    const geometry = extractPadsBoardGeometry(parsePadsAscii(sourceText))

    expect(geometry.paths).toHaveLength(1)
    expect(geometry.paths[0]).toMatchObject({
      kind: "route",
      layer: 1,
      points: [
        { x: 0, y: 0 },
        { x: basic(100), y: 0 },
      ],
    })
    expect(geometry.circles).toEqual([])
    expect(geometry.diagnostics).toContain(
      "1 unrouted ASCII connections omitted from fabrication geometry",
    )
  })

  test("decodes clockwise and counter-clockwise route arc centers", () => {
    const sourceText = [
      "!PADS-POWERPCB-V9.5-MILS! DESIGN DATABASE ASCII FILE 1.0",
      "*PCB*",
      "MAXIMUMLAYER 2",
      "*ROUTE*",
      "*SIGNAL* CW_ARC",
      "U1.1 U2.1",
      "0 0 1 10 0",
      "50 0 1 10 4096 CW",
      "100 0 65 10 0",
      "",
      "*SIGNAL* CCW_ARC",
      "U1.2 U2.2",
      "0 100 1 12 0",
      "50 100 1 12 4096 CCW",
      "100 100 65 12 0",
      "*END*",
      "",
    ].join("\n")
    const geometry = extractPadsBoardGeometry(parsePadsAscii(sourceText))

    expect(geometry.paths).toHaveLength(2)
    expect(geometry.paths[0]).toMatchObject({
      kind: "route",
      layer: 1,
      netName: "CW_ARC",
      width: mils(10),
      points: [
        { x: 0, y: 0 },
        { x: mils(100), y: 0 },
      ],
      segments: [
        {
          kind: "arc",
          start: { x: 0, y: 0 },
          end: { x: mils(100), y: 0 },
          center: { x: mils(50), y: 0 },
          radius: mils(50),
          startAngle: 180,
          deltaAngle: -180,
        },
      ],
    })
    expect(geometry.paths[1]).toMatchObject({
      kind: "route",
      layer: 1,
      netName: "CCW_ARC",
      width: mils(12),
      segments: [
        {
          kind: "arc",
          center: { x: mils(50), y: mils(100) },
          radius: mils(50),
          startAngle: 180,
          deltaAngle: 180,
        },
      ],
    })
    expect(geometry.diagnostics).toEqual([])
  })

  test("does not approximate malformed route arcs as straight copper", () => {
    const sourceText = [
      "!PADS-POWERPCB-V9.5-MILS! DESIGN DATABASE ASCII FILE 1.0",
      "*ROUTE*",
      "*SIGNAL* MALFORMED_ARC",
      "U1.1 U2.1",
      "0 0 1 10 0",
      "50 0 1 10 4096 CW",
      "100 10 65 10 0",
      "*END*",
      "",
    ].join("\n")
    const geometry = extractPadsBoardGeometry(parsePadsAscii(sourceText))

    expect(geometry.paths).toEqual([])
    expect(geometry.diagnostics).toContain(
      "1 ASCII route arc records could not be decoded",
    )
  })

  test("resolves routed vias from round and square pad-stack definitions", () => {
    const sourceText = [
      "!PADS-POWERPCB-V9.5-MILS! DESIGN DATABASE ASCII FILE 1.0",
      "*PCB*",
      "MAXIMUMLAYER 4",
      "*VIA*",
      "ROUNDVIA 20 5",
      "-2 40 R",
      "-1 60 R",
      "0 50 R",
      "2 70 S",
      "3 80 RA 60",
      "SQUAREVIA 10 4 2 3",
      "-2 30 S",
      "-1 70 SA 50",
      "0 40 R",
      "3 90 RT 45 120 15 4",
      "*ROUTE*",
      "*SIGNAL* ROUND_NET",
      "U1.1 U2.1",
      "0 0 1 8 0",
      "100 0 2 8 256 ROUNDVIA",
      "",
      "*SIGNAL* SQUARE_NET",
      "U1.2 U2.2",
      "0 100 2 8 0",
      "100 100 3 8 256 SQUAREVIA",
      "",
      "V 200 200 ROUNDVIA 1 4",
      "V 300 300 MISSINGVIA 1 4",
      "*END*",
      "",
    ].join("\n")
    const document = parsePadsAscii(sourceText)
    const geometry = extractPadsBoardGeometry(document)
    const svg = generateSvgFromPads(document)
    const bottomCopperSvg = generateSvgFromPads(document, {
      visibleGerberLayers: ["B_Cu"],
    })
    const firstInnerCopperSvg = generateSvgFromPads(document, {
      visibleGerberLayers: ["In1_Cu"],
    })

    expect(geometry.circles).toHaveLength(3)
    expect(geometry.circles[0]).toMatchObject({
      kind: "via",
      center: { x: mils(100), y: 0 },
      radius: mils(35),
      drillRadius: mils(10),
      shape: "circle",
      copperPads: [
        { layer: 1, radius: mils(20), shape: "circle" },
        { layer: 2, radius: mils(35), shape: "square" },
        { layer: 4, radius: mils(25), shape: "circle" },
      ],
      startLayer: 1,
      endLayer: 4,
      width: mils(25),
      name: "ROUNDVIA",
      netName: "ROUND_NET",
    })
    expect(geometry.circles[1]).toMatchObject({
      kind: "via",
      center: { x: mils(100), y: mils(100) },
      radius: mils(15),
      drillRadius: mils(5),
      shape: "square",
      copperPads: [{ layer: 2, radius: mils(15), shape: "square" }],
      startLayer: 2,
      endLayer: 3,
      width: mils(10),
      name: "SQUAREVIA",
      netName: "SQUARE_NET",
    })
    expect(
      geometry.unverifiedViaLocations.map(({ x, y }) => ({ x, y })),
    ).toEqual([{ x: mils(300), y: mils(300) }])
    expect(geometry.diagnostics).toContain(
      "1 ASCII via instances reference missing pad-stack definitions (MISSINGVIA)",
    )
    expect(geometry.diagnostics).toContain(
      "1 ASCII via layer pads use unsupported conductive shapes (RT)",
    )
    expect(svg).toContain('<rect id="pads-via-aperture-')
    expect(svg.match(/data-name="ROUNDVIA"/gu)).toHaveLength(6)
    expect(svg.match(/data-name="SQUAREVIA"/gu)).toHaveLength(1)
    expect(svg).toContain(`cx="${mils(100)}" cy="0" r="${mils(10)}"/>`)
    expect(svg).toContain(
      `cx="${mils(100)}" cy="${mils(100)}" r="${mils(5)}"/>`,
    )
    expect(bottomCopperSvg.match(/data-name="ROUNDVIA"/gu)).toHaveLength(2)
    expect(bottomCopperSvg).not.toContain('data-name="SQUAREVIA"')
    expect(bottomCopperSvg).not.toContain(
      `cx="${mils(100)}" cy="${mils(100)}" r="${mils(5)}"/>`,
    )
    expect(firstInnerCopperSvg.match(/data-pad-layer="2"/gu)).toHaveLength(3)
    expect(firstInnerCopperSvg.match(/data-name="ROUNDVIA"/gu)).toHaveLength(2)
    expect(firstInnerCopperSvg.match(/data-name="SQUAREVIA"/gu)).toHaveLength(1)
  })

  test("accepts numeric footprint names in part placements", () => {
    const sourceText = [
      "!PADS-POWERPCB-V9.5-BASIC! DESIGN DATABASE ASCII FILE 1.0",
      "*PART*",
      "C6 0402 1250 -2500 90.000 U N 0 -1 0 -1 2",
      "*END*",
      "",
    ].join("\n")
    const geometry = extractPadsBoardGeometry(parsePadsAscii(sourceText))

    expect(geometry.placements).toMatchObject([
      {
        reference: "C6",
        footprintName: "0402",
        location: { x: basic(1250), y: basic(-2500) },
        rotation: 90,
        bottomLayer: false,
      },
    ])
  })

  test("resolves and transforms basic placed part-decal pads", () => {
    const sourceText = [
      "!PADS-POWERPCB-V9.5-MILS! DESIGN DATABASE ASCII FILE 1.0",
      "*PCB*",
      "MAXIMUMLAYER 2",
      "*PARTDECAL*",
      "TEST_DECAL I 0 0 0 2 1 0 0",
      "T-10 0 -10 0 1",
      "T10 0 10 0 2",
      "PAD 0 3",
      "-2 8 RF 0 12 2 0 0 N",
      "-1 0 R",
      "0 0 R",
      "*PARTTYPE*",
      "TEST_TYPE TEST_DECAL I UND 0 0 0 0 Y",
      "*PART*",
      "U1 TEST_TYPE 100 200 90 U N 0 -1 0 -1 0",
      "U2 TEST_TYPE 300 200 0 U M 0 -1 0 -1 0",
      "*END*",
      "",
    ].join("\n")
    const document = parsePadsAscii(sourceText)
    const geometry = extractPadsBoardGeometry(document)
    const svg = generateSvgFromPads(document)

    expect(
      geometry.placements.map((placement) => placement.footprintName),
    ).toEqual(["TEST_DECAL", "TEST_DECAL"])
    expect(geometry.pads).toMatchObject([
      {
        center: { x: mils(100), y: mils(192) },
        width: mils(12),
        height: mils(8),
        shape: "rect",
        rotation: 90,
        layer: 1,
        reference: "U1",
        pinNumber: "1",
        decalName: "TEST_DECAL",
      },
      {
        center: { x: mils(100), y: mils(212) },
        width: mils(12),
        height: mils(8),
        shape: "rect",
        rotation: 90,
        layer: 1,
        reference: "U1",
        pinNumber: "2",
        decalName: "TEST_DECAL",
      },
      {
        center: { x: mils(308), y: mils(200) },
        width: mils(12),
        height: mils(8),
        shape: "rect",
        rotation: 180,
        layer: 2,
        reference: "U2",
        pinNumber: "1",
        decalName: "TEST_DECAL",
      },
      {
        center: { x: mils(288), y: mils(200) },
        width: mils(12),
        height: mils(8),
        shape: "rect",
        rotation: 180,
        layer: 2,
        reference: "U2",
        pinNumber: "2",
        decalName: "TEST_DECAL",
      },
    ])
    expect(geometry.diagnostics).toEqual([])
    expect(svg.match(/data-kind="component-pad"/gu)).toHaveLength(4)
    expect(svg).toContain('id="pads-F_Cu-component-pads"')
    expect(svg).toContain('id="pads-B_Cu-component-pads"')
  })

  test("decodes pre-corner-radius part-decal drills", () => {
    const sourceText = [
      "!PADS-POWERPCB-V2007.0-MILS! DESIGN DATABASE ASCII FILE 1.0",
      "*PCB*",
      "MAXIMUMLAYER 2",
      "*PARTDECAL*",
      "OLD_DRILL I 0 0 0 2 2 0 0",
      "T-10 0 -10 0 1",
      "T10 0 10 0 2",
      "PAD 1 3",
      "-2 24 S 12 P",
      "-1 24 R",
      "0 24 S",
      "PAD 2 3",
      "-2 18 RF 30 42 6 10 N",
      "-1 18 R",
      "0 18 RF 30 42 6",
      "*PARTTYPE*",
      "OLD_TYPE OLD_DRILL I UND 0 0 0 0 Y",
      "*PART*",
      "J1 OLD_TYPE 100 200 0 U N 0 -1 0 -1 0",
      "*END*",
      "",
    ].join("\n")
    const geometry = extractPadsBoardGeometry(parsePadsAscii(sourceText))

    expect(geometry.pads).toHaveLength(2)
    expect(geometry.pads.every((pad) => pad.cornerRadius === undefined)).toBe(
      true,
    )
    expect(geometry.holes).toHaveLength(2)
    expect(geometry.holes.map((hole) => hole.width)).toEqual([
      mils(12),
      mils(10),
    ])
    expect(geometry.holes.map((hole) => hole.plated)).toEqual([true, false])
    expect(geometry.diagnostics).toEqual([])
  })
})

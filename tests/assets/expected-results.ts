import type { PadsAsciiUnits } from "../../lib"

export type PadsFixtureRepresentative =
  | {
      kind: "path"
      pathKind: "outline" | "route"
      name?: string
      netName?: string
      pointIndex: number
      x: number
      y: number
    }
  | {
      kind: "placement"
      reference: string
      x: number
      y: number
    }
  | {
      kind: "unassigned-vertex"
      id: string
      x: number
      y: number
    }

export interface PadsFixtureExpectedResults {
  units: PadsAsciiUnits
  layerCount: number
  bounds?: [
    minimumX: number,
    minimumY: number,
    maximumX: number,
    maximumY: number,
  ]
  representative: PadsFixtureRepresentative
  counts: {
    components: number
    pads: number
    holes: number
    nets: number
    traces: number
    vias: number
    texts: number
    outlines: number
    pours: number
  }
  diagnosticCount: number
  diagnosticCodes: Record<string, number>
  coverage: {
    sourceRecords: number
    partiallyDecodedRecords: number
    skippedRecords: number
    binaryBytes: number
    partiallyDecodedBytes: number
    opaqueBytes: number
  }
}

export const expectedResultsByAssetId: Record<
  string,
  PadsFixtureExpectedResults
> = {
  "kicad-synthetic-multilayer-ascii": {
    units: "MILS",
    layerCount: 12,
    bounds: [0, 0, 127_000_000, 127_000_000],
    representative: {
      kind: "path",
      pathKind: "outline",
      name: "BOARD_OUTLINE",
      pointIndex: 0,
      x: 0,
      y: 0,
    },
    counts: {
      components: 0,
      pads: 0,
      holes: 0,
      nets: 0,
      traces: 0,
      vias: 0,
      texts: 0,
      outlines: 1,
      pours: 0,
    },
    diagnosticCount: 1,
    diagnosticCodes: {
      "geometry-ascii-via-instances-reference-missing-pad-stack": 1,
    },
    coverage: {
      sourceRecords: 73,
      partiallyDecodedRecords: 0,
      skippedRecords: 70,
      binaryBytes: 0,
      partiallyDecodedBytes: 0,
      opaqueBytes: 0,
    },
  },
  "kicad-keepout-ascii": {
    units: "MILS",
    layerCount: 2,
    bounds: [0, 0, 25_400_000, 25_400_000],
    representative: {
      kind: "path",
      pathKind: "outline",
      name: "TESTBOARD_OUTLINE",
      pointIndex: 0,
      x: 0,
      y: 0,
    },
    counts: {
      components: 0,
      pads: 0,
      holes: 0,
      nets: 0,
      traces: 0,
      vias: 0,
      texts: 0,
      outlines: 1,
      pours: 0,
    },
    diagnosticCount: 0,
    diagnosticCodes: {},
    coverage: {
      sourceRecords: 56,
      partiallyDecodedRecords: 0,
      skippedRecords: 50,
      binaryBytes: 0,
      partiallyDecodedBytes: 0,
      opaqueBytes: 0,
    },
  },
  "kicad-synthetic-noncopper-track-ascii": {
    units: "MILS",
    layerCount: 2,
    bounds: [0, 0, 76_200_000, 0],
    representative: {
      kind: "path",
      pathKind: "route",
      netName: "NET_1",
      pointIndex: 1,
      x: 25_400_000,
      y: 0,
    },
    counts: {
      components: 0,
      pads: 0,
      holes: 0,
      nets: 1,
      traces: 3,
      vias: 0,
      texts: 0,
      outlines: 0,
      pours: 0,
    },
    diagnosticCount: 1,
    diagnosticCodes: {
      "geometry-ascii-route-segments-on-non-copper-layers": 1,
    },
    coverage: {
      sourceRecords: 29,
      partiallyDecodedRecords: 0,
      skippedRecords: 26,
      binaryBytes: 0,
      partiallyDecodedBytes: 0,
      opaqueBytes: 0,
    },
  },
  "kicad-lcore2-ascii": {
    units: "BASIC",
    layerCount: 2,
    bounds: [
      -33_513_333.333333332, -45_197_666.666666664, 59_049_000,
      28_433_666.666666664,
    ],
    representative: {
      kind: "placement",
      reference: "C4",
      x: 1_400_000,
      y: -14_200_000,
    },
    counts: {
      components: 30,
      pads: 69,
      holes: 4,
      nets: 14,
      traces: 229,
      vias: 24,
      texts: 17,
      outlines: 1,
      pours: 0,
    },
    diagnosticCount: 0,
    diagnosticCodes: {},
    coverage: {
      sourceRecords: 7_442,
      partiallyDecodedRecords: 0,
      skippedRecords: 7_126,
      binaryBytes: 0,
      partiallyDecodedBytes: 0,
      opaqueBytes: 0,
    },
  },
  "kicad-dexter-motor-control-ascii": {
    units: "BASIC",
    layerCount: 8,
    bounds: [-26_466_800, -10_566_400, 65_024_000, 189_611_000],
    representative: {
      kind: "placement",
      reference: "C26",
      x: 24_384_000,
      y: 32_004_000,
    },
    counts: {
      components: 251,
      pads: 918,
      holes: 95,
      nets: 221,
      traces: 2_850,
      vias: 796,
      texts: 28,
      outlines: 1,
      pours: 0,
    },
    diagnosticCount: 1,
    diagnosticCodes: {
      "geometry-unrouted-ascii-connections-omitted-from-fabrication-geometry": 1,
    },
    coverage: {
      sourceRecords: 33_316,
      partiallyDecodedRecords: 0,
      skippedRecords: 29_760,
      binaryBytes: 0,
      partiallyDecodedBytes: 0,
      opaqueBytes: 0,
    },
  },
  "kicad-dexter-motor-control-binary-v2021": {
    units: "BASIC",
    layerCount: 2,
    representative: {
      kind: "unassigned-vertex",
      id: "unassigned-vertex:0:binary:12:0",
      x: 179_685_046.66666666,
      y: 49_803_952.666666664,
    },
    counts: {
      components: 0,
      pads: 0,
      holes: 0,
      nets: 0,
      traces: 0,
      vias: 0,
      texts: 0,
      outlines: 0,
      pours: 0,
    },
    diagnosticCount: 41,
    diagnosticCodes: {
      "geometry-native-binary-outline-records-are-not-decoded": 1,
      "geometry-native-binary-routes-are-not-decoded-for": 1,
      "geometry-binary-text-candidates-rejected-because-decoded-fields": 1,
      "geometry-native-binary-version-0x2021-placement-y-coordinates": 1,
      "binary-unsupported-section": 37,
    },
    coverage: {
      sourceRecords: 298_405,
      partiallyDecodedRecords: 83_628,
      skippedRecords: 214_777,
      binaryBytes: 837_303,
      partiallyDecodedBytes: 321_124,
      opaqueBytes: 516_179,
    },
  },
  "kicad-ems4-rev2-ascii": {
    units: "BASIC",
    layerCount: 6,
    bounds: [-47_167_800, -60_960_000, 101_600_000, 30_480_000],
    representative: {
      kind: "placement",
      reference: "C12",
      x: -7_112_000,
      y: 11_684_000,
    },
    counts: {
      components: 371,
      pads: 1_279,
      holes: 44,
      nets: 281,
      traces: 5_896,
      vias: 1_074,
      texts: 33,
      outlines: 1,
      pours: 0,
    },
    diagnosticCount: 1,
    diagnosticCodes: {
      "geometry-unrouted-ascii-connections-omitted-from-fabrication-geometry": 1,
    },
    coverage: {
      sourceRecords: 34_667,
      partiallyDecodedRecords: 0,
      skippedRecords: 27_705,
      binaryBytes: 0,
      partiallyDecodedBytes: 0,
      opaqueBytes: 0,
    },
  },
  "kicad-ems4-rev2-binary-v2025": {
    units: "BASIC",
    layerCount: 6,
    bounds: [-27_940_000, -22_982_800, 72_103_000, 23_023_800],
    representative: {
      kind: "placement",
      reference: "C6",
      x: -1_905_000,
      y: -8_255_000,
    },
    counts: {
      components: 364,
      pads: 0,
      holes: 0,
      nets: 0,
      traces: 0,
      vias: 0,
      texts: 0,
      outlines: 0,
      pours: 0,
    },
    diagnosticCount: 41,
    diagnosticCodes: {
      "geometry-native-binary-outline-records-are-not-decoded": 1,
      "geometry-native-binary-route-and-via-candidates-are": 1,
      "geometry-binary-text-candidates-rejected-because-decoded-fields": 1,
      "binary-unsupported-section": 38,
    },
    coverage: {
      sourceRecords: 288_409,
      partiallyDecodedRecords: 58_333,
      skippedRecords: 230_076,
      binaryBytes: 1_190_450,
      partiallyDecodedBytes: 501_281,
      opaqueBytes: 689_169,
    },
  },
  "kicad-lcore2-binary-v2026": {
    units: "BASIC",
    layerCount: 2,
    bounds: [-11_471_530, -18_815_093.333333332, 8_452_370, 142_372_048],
    representative: {
      kind: "placement",
      reference: "H3",
      x: -11_471_530,
      y: -16_383_040,
    },
    counts: {
      components: 19,
      pads: 0,
      holes: 0,
      nets: 0,
      traces: 0,
      vias: 0,
      texts: 0,
      outlines: 0,
      pours: 0,
    },
    diagnosticCount: 39,
    diagnosticCodes: {
      "geometry-version-0x2026-section-21-candidate-paths-are": 1,
      "geometry-native-binary-route-and-via-candidates-are": 1,
      "geometry-binary-text-candidates-rejected-because-decoded-fields": 1,
      "binary-unsupported-section": 36,
    },
    coverage: {
      sourceRecords: 76_681,
      partiallyDecodedRecords: 33_021,
      skippedRecords: 43_660,
      binaryBytes: 144_612,
      partiallyDecodedBytes: 79_941,
      opaqueBytes: 64_671,
    },
  },
  "kicad-tms1mmx19-ascii": {
    units: "BASIC",
    layerCount: 2,
    bounds: [
      -447_930_509.3333333, -439_613_644.6666666, 294_944_800, 177_800_000,
    ],
    representative: {
      kind: "placement",
      reference: "JM3",
      x: 97_989_644,
      y: 88_900_000,
    },
    counts: {
      components: 373,
      pads: 1_760,
      holes: 66,
      nets: 0,
      traces: 0,
      vias: 0,
      texts: 3,
      outlines: 1,
      pours: 0,
    },
    diagnosticCount: 1,
    diagnosticCodes: {
      "geometry-unrouted-ascii-connections-omitted-from-fabrication-geometry": 1,
    },
    coverage: {
      sourceRecords: 23_321,
      partiallyDecodedRecords: 0,
      skippedRecords: 22_347,
      binaryBytes: 0,
      partiallyDecodedBytes: 0,
      opaqueBytes: 0,
    },
  },
  "kicad-tms1mmx19-binary-v2027": {
    units: "BASIC",
    layerCount: 2,
    bounds: [5_100_066, 5_887_720, 293_166_800, 171_912_280],
    representative: {
      kind: "placement",
      reference: "SM4",
      x: 54_989_730,
      y: 105_899_966,
    },
    counts: {
      components: 362,
      pads: 0,
      holes: 0,
      nets: 0,
      traces: 0,
      vias: 0,
      texts: 0,
      outlines: 0,
      pours: 0,
    },
    diagnosticCount: 36,
    diagnosticCodes: {
      "geometry-native-binary-outline-records-are-not-decoded": 1,
      "geometry-native-binary-route-and-via-candidates-are": 1,
      "binary-unsupported-section": 34,
    },
    coverage: {
      sourceRecords: 186_283,
      partiallyDecodedRecords: 44_106,
      skippedRecords: 142_177,
      binaryBytes: 735_671,
      partiallyDecodedBytes: 397_499,
      opaqueBytes: 338_172,
    },
  },
}

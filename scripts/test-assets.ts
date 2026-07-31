import { createHash } from "node:crypto"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export type TestAssetFormat = "ascii" | "binary"

interface DownloadableTestAssetBase {
  id: string
  relativePath: string
  expectedByteLength: number
  gitBlobSha: string
  downloadUrl: string
  sourceUrl: string
  licenseUrl: string
}

export type DownloadableTestAsset =
  | (DownloadableTestAssetBase & {
      format: "ascii"
    })
  | (DownloadableTestAssetBase & {
      format: "binary"
      expectedVersion: 0x2021 | 0x2025 | 0x2026 | 0x2027
    })

export interface ManualTestAsset {
  id: string
  relativePath: string
  format: TestAssetFormat
  sourceUrl: string
  accessNote: string
}

const KICAD_COMMIT = "06bf3c7acd99d850ac9bf94f9182ba8c9e89b620"
const KICAD_RAW_ROOT = `https://raw.githubusercontent.com/KiCad/kicad-source-mirror/${KICAD_COMMIT}`
const KICAD_BLOB_ROOT = `https://github.com/KiCad/kicad-source-mirror/blob/${KICAD_COMMIT}`
const PADS_FIXTURE_PATH = "qa/data/pcbnew/plugins/pads"

export const downloadedTestAssetDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../tests/assets/downloaded",
)

export const downloadableTestAssets: DownloadableTestAsset[] = [
  {
    id: "kicad-synthetic-multilayer-ascii",
    relativePath: "kicad/synthetic-multilayer.asc",
    format: "ascii",
    expectedByteLength: 1079,
    gitBlobSha: "d7fedf81aacaae268308f5246241b13860b79bc6",
    downloadUrl: `${KICAD_RAW_ROOT}/${PADS_FIXTURE_PATH}/synthetic_multilayer.asc`,
    sourceUrl: `${KICAD_BLOB_ROOT}/${PADS_FIXTURE_PATH}/synthetic_multilayer.asc`,
    licenseUrl: `${KICAD_BLOB_ROOT}/LICENSE`,
  },
  {
    id: "kicad-lcore2-ascii",
    relativePath: "kicad/lcore2.asc",
    format: "ascii",
    expectedByteLength: 158111,
    gitBlobSha: "19c44a96bd991438042c2beebd22bb2f7e5331ab",
    downloadUrl: `${KICAD_RAW_ROOT}/${PADS_FIXTURE_PATH}/LCORE_2/LCORE_2.asc`,
    sourceUrl: `${KICAD_BLOB_ROOT}/${PADS_FIXTURE_PATH}/LCORE_2/LCORE_2.asc`,
    licenseUrl: `${KICAD_BLOB_ROOT}/${PADS_FIXTURE_PATH}/LCORE_2/LICENSE`,
  },
  {
    id: "kicad-dexter-motor-control-binary-v2021",
    relativePath: "kicad/dexter-motor-control-v2021.pcb",
    format: "binary",
    expectedVersion: 0x2021,
    expectedByteLength: 944042,
    gitBlobSha: "de19ddaccb97ed48b0f2947957566f8133c45ed4",
    downloadUrl: `${KICAD_RAW_ROOT}/${PADS_FIXTURE_PATH}/Dexter_MotorCtrl/Dexter_MotorCtrl.pcb`,
    sourceUrl: `${KICAD_BLOB_ROOT}/${PADS_FIXTURE_PATH}/Dexter_MotorCtrl/Dexter_MotorCtrl.pcb`,
    licenseUrl: `${KICAD_BLOB_ROOT}/${PADS_FIXTURE_PATH}/Dexter_MotorCtrl/LICENSE`,
  },
  {
    id: "kicad-ems4-rev2-binary-v2025",
    relativePath: "kicad/ems4-rev2-v2025.pcb",
    format: "binary",
    expectedVersion: 0x2025,
    expectedByteLength: 1407741,
    gitBlobSha: "b3241d625e1087736c5941413506119637e5b516",
    downloadUrl: `${KICAD_RAW_ROOT}/${PADS_FIXTURE_PATH}/Ems4_Rev2/Ems4_Rev2.pcb`,
    sourceUrl: `${KICAD_BLOB_ROOT}/${PADS_FIXTURE_PATH}/Ems4_Rev2/Ems4_Rev2.pcb`,
    licenseUrl: `${KICAD_BLOB_ROOT}/${PADS_FIXTURE_PATH}/Ems4_Rev2/LICENSE`,
  },
  {
    id: "kicad-lcore2-binary-v2026",
    relativePath: "kicad/lcore2-v2026.pcb",
    format: "binary",
    expectedVersion: 0x2026,
    expectedByteLength: 253744,
    gitBlobSha: "c2962ad1c6356e4fe9fd6a78efd0c012821c312f",
    downloadUrl: `${KICAD_RAW_ROOT}/${PADS_FIXTURE_PATH}/LCORE_2/LCORE_2.pcb`,
    sourceUrl: `${KICAD_BLOB_ROOT}/${PADS_FIXTURE_PATH}/LCORE_2/LCORE_2.pcb`,
    licenseUrl: `${KICAD_BLOB_ROOT}/${PADS_FIXTURE_PATH}/LCORE_2/LICENSE`,
  },
  {
    id: "kicad-tms1mmx19-binary-v2027",
    relativePath: "kicad/tms1mmx19-v2027.pcb",
    format: "binary",
    expectedVersion: 0x2027,
    expectedByteLength: 911147,
    gitBlobSha: "56cc3347b3ff0b99582193aceda46e4fb2c6290d",
    downloadUrl: `${KICAD_RAW_ROOT}/${PADS_FIXTURE_PATH}/TMS1mmX19/TMS1mmX19.pcb`,
    sourceUrl: `${KICAD_BLOB_ROOT}/${PADS_FIXTURE_PATH}/TMS1mmX19/TMS1mmX19.pcb`,
    licenseUrl: `${KICAD_BLOB_ROOT}/${PADS_FIXTURE_PATH}/TMS1mmX19/LICENSE`,
  },
]

export const manualTestAssets: ManualTestAsset[] = [
  {
    id: "rk3326-lpddr3-target",
    relativePath: "targets/rk3326-lpddr3.pcb",
    format: "binary",
    sourceUrl: "https://www.iteye.com/resource/jorttny-12147534",
    accessNote:
      "The known source requires paid access. Download it with authorization and place it at this path manually.",
  },
]

export const getDownloadedTestAssetPath = ({
  relativePath,
}: {
  relativePath: string
}): string => resolve(downloadedTestAssetDirectory, relativePath)

export const calculateGitBlobSha = (sourceBytes: Uint8Array): string => {
  const hash = createHash("sha1")
  hash.update(`blob ${sourceBytes.byteLength}\0`)
  hash.update(sourceBytes)
  return hash.digest("hex")
}

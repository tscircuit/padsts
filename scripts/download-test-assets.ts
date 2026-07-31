import { mkdir } from "node:fs/promises"
import { dirname, relative } from "node:path"
import {
  calculateGitBlobSha,
  type DownloadableTestAsset,
  downloadableTestAssets,
  downloadedTestAssetDirectory,
  getDownloadedTestAssetPath,
  manualTestAssets,
} from "./test-assets"

const forceDownload = Bun.argv.includes("--force")

const verifyAsset = (
  asset: DownloadableTestAsset,
  sourceBytes: Uint8Array,
): void => {
  if (sourceBytes.byteLength !== asset.expectedByteLength) {
    throw new Error(
      `${asset.id}: expected ${asset.expectedByteLength} bytes, received ${sourceBytes.byteLength}`,
    )
  }

  const gitBlobSha = calculateGitBlobSha(sourceBytes)
  if (gitBlobSha !== asset.gitBlobSha) {
    throw new Error(
      `${asset.id}: expected Git blob ${asset.gitBlobSha}, received ${gitBlobSha}`,
    )
  }
}

const downloadAsset = async (asset: DownloadableTestAsset): Promise<void> => {
  const assetPath = getDownloadedTestAssetPath(asset)
  const assetFile = Bun.file(assetPath)

  if (!forceDownload && (await assetFile.exists())) {
    try {
      verifyAsset(asset, await assetFile.bytes())
      console.log(`verified ${relative(process.cwd(), assetPath)}`)
      return
    } catch {
      console.log(`replacing invalid ${relative(process.cwd(), assetPath)}`)
    }
  }

  const response = await fetch(asset.downloadUrl)
  if (!response.ok) {
    throw new Error(
      `${asset.id}: download failed with ${response.status} ${response.statusText}`,
    )
  }

  const sourceBytes = new Uint8Array(await response.arrayBuffer())
  verifyAsset(asset, sourceBytes)
  await mkdir(dirname(assetPath), { recursive: true })
  await Bun.write(assetPath, sourceBytes)
  console.log(`downloaded ${relative(process.cwd(), assetPath)}`)
}

await mkdir(downloadedTestAssetDirectory, { recursive: true })

for (const asset of downloadableTestAssets) {
  await downloadAsset(asset)
}

for (const asset of manualTestAssets) {
  const assetPath = getDownloadedTestAssetPath(asset)
  const status = (await Bun.file(assetPath).exists()) ? "found" : "not found"
  console.log(
    `${status} manual target ${relative(process.cwd(), assetPath)}\n  ${asset.accessNote}\n  ${asset.sourceUrl}`,
  )
}

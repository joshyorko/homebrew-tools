export type ActionsRuntimeAsset = {
  name: string
  browser_download_url: string
  digest?: string
}

export type ActionsRuntimeRelease = {
  tag_name: string
  draft: boolean
  prerelease: boolean
  assets: ActionsRuntimeAsset[]
}

export function resolveActionsRuntimeRelease(releases: ActionsRuntimeRelease[]) {
  const release = releases.find((candidate) => !candidate.draft && !candidate.prerelease
    && /^actions-runtime-\d+\.\d+\.\d+$/.test(candidate.tag_name))
  if (!release) throw new Error("No stable Actions Runtime release found")
  const version = release.tag_name.slice("actions-runtime-".length)
  const linux = release.assets.find((asset) => asset.name === `${release.tag_name}-linux64`)
  const macosArm = release.assets.find((asset) => asset.name === `${release.tag_name}-macos-arm64`)
  if (!linux || !macosArm) throw new Error("Actions Runtime release is missing required Linux or macOS arm64 assets")
  return { version, upstreamTag: release.tag_name, linux, macosArm }
}

export function verifyActionsRuntimeDigest(asset: ActionsRuntimeAsset, actual: string): string {
  if (!asset.digest || !/^sha256:[a-f0-9]{64}$/.test(asset.digest)) {
    throw new Error(`Actions Runtime asset ${asset.name} has no valid upstream SHA-256 digest`)
  }
  if (asset.digest !== `sha256:${actual}`) throw new Error(`Actions Runtime checksum mismatch for ${asset.name}`)
  return actual
}

export const DEVSY_AMD64_ASSET = "devsy-linux-amd64"
export const DEVSY_ARM64_ASSET = "devsy-linux-arm64"
export const DEVSY_DESKTOP_ASSET = "Devsy_linux_x86_64.AppImage"

export type DevsyReleaseAsset = {
  name: string
  browser_download_url: string
  digest: string | null
}

export type DevsyRelease = {
  draft: boolean
  prerelease: boolean
  tag_name: string
  assets: DevsyReleaseAsset[]
}

export type ResolvedDevsyRelease = {
  version: string
  upstreamTag: string
  amd64: DevsyReleaseAsset
  arm64: DevsyReleaseAsset
  desktop: DevsyReleaseAsset
}

function requireAsset(release: DevsyRelease, name: string): DevsyReleaseAsset {
  const asset = release.assets.find((candidate) => candidate.name === name)

  if (!asset) {
    throw new Error(`Stable Devsy release is missing ${name}`)
  }

  const expectedUrl = `https://github.com/devsy-org/devsy/releases/download/${release.tag_name}/${name}`
  if (asset.browser_download_url !== expectedUrl) {
    throw new Error(`Devsy release asset ${name} has unexpected URL ${asset.browser_download_url}`)
  }

  return asset
}

export function resolveStableDevsyRelease(release: DevsyRelease): ResolvedDevsyRelease {
  if (release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) {
    throw new Error(`Expected a stable semantic Devsy release, received ${release.tag_name}`)
  }

  return {
    version: release.tag_name.slice(1),
    upstreamTag: release.tag_name,
    amd64: requireAsset(release, DEVSY_AMD64_ASSET),
    arm64: requireAsset(release, DEVSY_ARM64_ASSET),
    desktop: requireAsset(release, DEVSY_DESKTOP_ASSET),
  }
}

export function verifyDevsyGithubDigest(asset: DevsyReleaseAsset, sha256: string): void {
  const expected = asset.digest?.match(/^sha256:([a-f0-9]{64})$/)?.[1]

  if (!expected) {
    throw new Error(`Devsy release asset ${asset.name} is missing a GitHub SHA-256 digest`)
  }

  if (sha256 !== expected) {
    throw new Error(`GitHub digest mismatch for ${asset.name}: expected ${expected}, received ${sha256}`)
  }
}

export function renderDevsyFormula(
  baseContents: string,
  update: {
    version: string
    amd64Sha256: string
    arm64Sha256: string
    amd64Url: string
    arm64Url: string
  },
): string {
  return baseContents
    .replace(/version ".*"/, `version "${update.version}"`)
    .replace(
      /url "[^"]*devsy-linux-amd64"\n\s+sha256 "[^"]+"/,
      `url "${update.amd64Url}"\n      sha256 "${update.amd64Sha256}"`,
    )
    .replace(
      /url "[^"]*devsy-linux-arm64"\n\s+sha256 "[^"]+"/,
      `url "${update.arm64Url}"\n      sha256 "${update.arm64Sha256}"`,
    )
}

export function renderDevsyDesktopCask(
  baseContents: string,
  update: {
    version: string
    sha256: string
    downloadUrl: string
  },
  rewriteUrl: (contents: string, downloadUrl: string) => string,
): string {
  return rewriteUrl(
    baseContents
      .replace(/version ".*"/, `version "${update.version}"`)
      .replace(/sha256 x86_64_linux: (?::no_check|".*")/, `sha256 x86_64_linux: "${update.sha256}"`),
    update.downloadUrl,
  )
}

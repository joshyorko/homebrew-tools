export type ReviewAsset = { name: string; browser_download_url: string; digest: string }
export type ReviewRelease = { version: string; tagName: string; assets: ReviewAsset[] }

export function resolveReviewRelease(payload: unknown): ReviewRelease {
  const candidate = payload as { tag_name?: string; draft?: boolean; prerelease?: boolean } | null
  if (!candidate || candidate.draft !== false || candidate.prerelease !== false) throw new Error("Review requires a published stable release")
  const tagName = candidate.tag_name ?? ""
  if (!/^v\d+\.\d+\.\d+$/.test(tagName)) throw new Error("Review requires a stable semantic version tag")
  const release = payload as { assets?: ReviewAsset[] }
  const assets = ["x86_64", "aarch64"].map((arch) => {
    const name = `review-${arch}.tar.gz`
    const asset = release.assets?.find((entry) => entry.name === name)
    if (!asset || asset.browser_download_url !== `https://github.com/joshyorko/review/releases/download/${tagName}/${name}` ||
        !/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? "")) throw new Error(`Missing verified Review asset: ${name}`)
    return asset
  })
  return { version: tagName.slice(1), tagName, assets }
}

export function verifyReviewArtifact(asset: ReviewAsset, sha256: string, manifest: unknown,
  version: string, commit: string): void {
  if (asset.digest !== `sha256:${sha256}`) throw new Error(`Review asset digest mismatch: ${asset.name}`)
  const build = manifest as { version?: string; sha?: string; arch?: string }
  const arch = asset.name === "review-x86_64.tar.gz" ? "x86_64" : "aarch64"
  if (!/^[a-f0-9]{40}$/.test(commit) || build.version !== version || build.sha !== commit || build.arch !== arch) {
    throw new Error(`Review source identity mismatch: ${asset.name}`)
  }
}

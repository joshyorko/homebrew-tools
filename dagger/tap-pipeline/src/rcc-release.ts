const RCC_ASSETS = {
  linuxIntel: "rcc-linux64",
  linuxArm: "rcc-linuxarm64",
  macosIntel: "rcc-macos64",
  macosArm: "rcc-macosarm64",
}

export function resolveRccRelease(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("tag_name" in payload) ||
      typeof payload.tag_name !== "string" || !/^v\d+\.\d+\.\d+$/.test(payload.tag_name) ||
      !("assets" in payload) || !Array.isArray(payload.assets)) {
    throw new Error("Expected a stable RCC release and asset list")
  }

  const tagName = payload.tag_name
  const assets: unknown[] = payload.assets
  const select = (name: string) => {
    const url = `https://github.com/joshyorko/rcc/releases/download/${tagName}/${name}`
    const matches = assets.filter((asset) => asset && typeof asset === "object" && "name" in asset && asset.name === name)
    const [asset] = matches
    if (matches.length !== 1 || !asset || typeof asset !== "object" ||
        !("browser_download_url" in asset) || asset.browser_download_url !== url ||
        !("digest" in asset) || typeof asset.digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(asset.digest)) {
      throw new Error(`Missing or invalid upstream RCC asset: ${name}`)
    }
    return { name, url, sha256: asset.digest.slice("sha256:".length) }
  }

  return {
    version: tagName.slice(1),
    linuxIntel: select(RCC_ASSETS.linuxIntel),
    linuxArm: select(RCC_ASSETS.linuxArm),
    macosIntel: select(RCC_ASSETS.macosIntel),
    macosArm: select(RCC_ASSETS.macosArm),
  }
}

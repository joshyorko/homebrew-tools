import assert from "node:assert/strict"
import test from "node:test"
import { resolveRccRelease } from "../src/rcc-release.ts"

const tag = "v18.19.12"
const asset = (name: string, hash: string) => ({
  name,
  browser_download_url: `https://github.com/joshyorko/rcc/releases/download/${tag}/${name}`,
  digest: `sha256:${hash}`,
})
const armSha = "e161f9d750776c376ef19ba15676b166447bc12096d208de2ecbbe51899cb1d2"
const intelSha = "0a13e78201a71c1bbc19a2ee8ccc86dd60a67ec4ffa8cd3a9a8f254d148849ee"
const arm = asset("rcc-linuxarm64", armSha)
const otherAssets = [
  asset("rcc-linux64", intelSha),
  asset("rcc-macos64", "c".repeat(64)),
  asset("rcc-macosarm64", "d".repeat(64)),
  asset("rccremote-linuxarm64", "e".repeat(64)),
]

test("resolves the four exact RCC assets and preserves their source pins", () => {
  const release = resolveRccRelease({ tag_name: tag, assets: [arm, ...otherAssets] })
  assert.equal(release.version, "18.19.12")
  assert.deepEqual(release.linuxArm, { name: arm.name, url: arm.browser_download_url, sha256: armSha })
  assert.equal(release.linuxIntel.sha256, intelSha)
  assert.equal(release.macosIntel.name, "rcc-macos64")
  assert.equal(release.macosArm.name, "rcc-macosarm64")
})

test("rejects missing, ambiguous, cross-version or unpinned ARM64 assets", () => {
  for (const assets of [
    otherAssets,
    [...otherAssets, arm, arm],
    [...otherAssets, { ...arm, browser_download_url: arm.browser_download_url.replace(tag, "v18.19.11") }],
    [...otherAssets, { ...arm, digest: null }],
  ]) {
    assert.throws(() => resolveRccRelease({ tag_name: tag, assets }), /invalid upstream RCC asset: rcc-linuxarm64/)
  }
})

import test from "node:test"
import assert from "node:assert/strict"
import { resolveReviewRelease, verifyReviewArtifact } from "../src/review-release.ts"
import { AUTO_UPDATE_SLOTS, PACKAGE_REGISTRY } from "../src/library.ts"
const sha = "a".repeat(64)
const commit = "b".repeat(40)
const assets = ["x86_64", "aarch64"].map(arch => ({ name: `review-${arch}.tar.gz`, browser_download_url: `https://github.com/joshyorko/review/releases/download/v0.1.0/review-${arch}.tar.gz`, digest: `sha256:${sha}` }))
const payload = { tag_name: "v0.1.0", draft: false, prerelease: false, assets }
test("Review accepts stable native assets with immutable digests and exact source identities", () => {
  assert.equal(resolveReviewRelease(payload).version, "0.1.0")
  verifyReviewArtifact(assets[0], sha, { version: "0.1.0", sha: commit, arch: "x86_64" }, "0.1.0", commit)
  for (const changed of [{ draft: true }, { prerelease: true }, { tag_name: "v0.1.0-dev" }, { assets: [] }, { assets: assets.map(a => ({ ...a, digest: null })) }]) assert.throws(() => resolveReviewRelease({ ...payload, ...changed }))
  for (const changed of [{ version: "0.2.0" }, { sha: "c".repeat(40) }, { arch: "aarch64" }]) assert.throws(() => verifyReviewArtifact(assets[0], sha, { version: "0.1.0", sha: commit, arch: "x86_64", ...changed }, "0.1.0", commit))
  assert.throws(() => verifyReviewArtifact(assets[0], "c".repeat(64), { version: "0.1.0", sha: commit, arch: "x86_64" }, "0.1.0", commit))
})
test("Review uses hourly formula refresh without duplicating source releases", () => {
  const entry = PACKAGE_REGISTRY.find(entry => entry.id === "review")!
  assert.equal(entry.supportsReleaseBundle, false)
  assert.equal(entry.autoUpdate.kind, "manual")
  assert.deepEqual(AUTO_UPDATE_SLOTS.find(slot => slot.id === "review-hourly")?.packageIds, ["review"])
})

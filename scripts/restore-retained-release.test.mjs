import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { classifyLiveRelease, planAssetRestore, planReleaseRestore, verifyBundle } from "./restore-retained-release.mjs"

const assetBytes = Buffer.from("the exact release asset")
const assetSha256 = sha256For(assetBytes)

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "retained-release-test-"))
  const bundle = join(root, "bundle")
  mkdirSync(join(bundle, "artifacts"), { recursive: true })
  writeFileSync(join(bundle, "release.json"), JSON.stringify({ release_tag: "sample-v1" }))
  writeFileSync(join(bundle, "artifacts", "sample.bin"), assetBytes)
  return { root, bundle }
}

const expected = {
  original_release_id: 123,
  release_tag: "sample-v1",
  tag_commit_sha: "a".repeat(40),
  source_artifact_id: 456,
  source_run_id: 789,
  assets: [{ name: "sample.bin", size: assetBytes.length, sha256: assetSha256 }],
}

test("verifies every expected retained bundle asset before release work", async () => {
  const { root, bundle } = fixture()
  try {
    const receipt = await verifyBundle(bundle, expected, "sample-package")
    assert.equal(receipt.release_tag, "sample-v1")
    assert.equal(receipt.assets[0].digest_verified, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("rejects a retained bundle whose asset bytes differ", async () => {
  const { root, bundle } = fixture()
  try {
    const target = { ...expected, assets: [{ ...expected.assets[0], sha256: "0".repeat(64) }] }
    await assert.rejects(verifyBundle(bundle, target, "sample-package"), /SHA256 mismatch/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("allows replacing only the original release or a marker-owned reset release", () => {
  const target = { ...expected }
  assert.equal(classifyLiveRelease(target, { id: 123, body: "old" }, "<!-- reset -->"), "replace-original")
  assert.equal(classifyLiveRelease(target, { id: 999, body: "<!-- reset -->" }, "<!-- reset -->"), "reuse-reset")
  assert.equal(classifyLiveRelease(target, null, "<!-- reset -->"), "create")
  assert.throws(() => classifyLiveRelease(target, { id: 999, body: "other" }, "<!-- reset -->"), /not owned/)
})

test("never replaces an uploaded mismatch; only a digest-less starter can be removed", () => {
  const assets = expected.assets.map((asset) => ({ ...asset, sha256: sha256For(assetBytes) }))
  assert.equal(planAssetRestore(assets, [], true)[0].action, "upload")
  assert.equal(planAssetRestore(assets, [{ name: "sample.bin", size: 3, state: "starter" }], true)[0].action, "remove-starter-and-upload")
  assert.throws(() => planAssetRestore(assets, [{ name: "sample.bin", size: 3, state: "uploaded", digest: "sha256:bad" }], true), /Refusing to overwrite/)
  assert.throws(() => planAssetRestore(assets, [{ name: "sample.bin", size: 3, state: "starter", digest: "sha256:bad" }], true), /Refusing to overwrite/)
})

test("checks every original asset against the inventory before allowing release deletion", () => {
  const target = { ...expected }
  const correct = [{
    name: "sample.bin",
    size: assetBytes.length,
    digest: `sha256:${assetSha256}`,
    state: "uploaded",
  }]
  assert.equal(planReleaseRestore(target, { id: 123, body: "old", assets: correct }, "<!-- reset -->").action, "replace-original")
  assert.throws(
    () => planReleaseRestore(target, { id: 123, body: "old", assets: [{ ...correct[0], digest: "sha256:wrong" }] }, "<!-- reset -->"),
    /Refusing to overwrite|Original release assets do not match/,
  )
  assert.throws(
    () => planReleaseRestore(target, { id: 123, body: "old", assets: [...correct, { name: "unexpected.bin", size: 2, digest: "sha256:other" }] }, "<!-- reset -->"),
    /Original release asset names do not match/,
  )
})

function sha256For(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

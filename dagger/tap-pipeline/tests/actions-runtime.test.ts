import test from "node:test"
import assert from "node:assert/strict"
import { resolveActionsRuntimeRelease, verifyActionsRuntimeDigest } from "../src/actions-runtime.ts"

const asset = (name: string) => ({ name, browser_download_url: `https://example.com/${name}`, digest: `sha256:${"a".repeat(64)}` })
const release = (tag_name = "actions-runtime-1.0.1") => ({ tag_name, draft: false, prerelease: false, assets: [asset(`${tag_name}-linux64`), asset(`${tag_name}-macos-arm64`)] })

test("selects stable Runtime assets despite newer legacy, draft and prerelease entries", () => {
  const selected = resolveActionsRuntimeRelease([
    release("action-server-v9.0.0"),
    { ...release("actions-runtime-2.0.0"), draft: true },
    { ...release("actions-runtime-2.0.0"), prerelease: true },
    release("actions-runtime-2.0.0-rc1"),
    release(),
  ])
  assert.equal(selected.version, "1.0.1")
  assert.equal(selected.linux.name, "actions-runtime-1.0.1-linux64")
  assert.equal(selected.macosArm.name, "actions-runtime-1.0.1-macos-arm64")
})

test("fails closed for legacy-only releases and missing required assets", () => {
  assert.throws(() => resolveActionsRuntimeRelease([release("action-server-v1.2.6")]), /No stable Actions Runtime/)
  assert.throws(() => resolveActionsRuntimeRelease([{ ...release(), assets: [asset("action-server-linux64")] }]), /missing required/)
})

test("verifies upstream digest and rejects missing or mismatched checksums", () => {
  assert.equal(verifyActionsRuntimeDigest(asset("runtime"), "a".repeat(64)), "a".repeat(64))
  assert.throws(() => verifyActionsRuntimeDigest(asset("runtime"), "b".repeat(64)), /checksum mismatch/)
  assert.throws(() => verifyActionsRuntimeDigest({ ...asset("runtime"), digest: undefined }, "a".repeat(64)), /SHA-256/)
})

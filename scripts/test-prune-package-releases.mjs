import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { releaseTagsToPrune, referencedReleaseTags } from "./prune-package-releases.mjs"

test("retention keeps the current release and recipes still referencing older releases", () => {
  const releases = [1, 2, 3].map((n) => ({ tag_name: `rcc-${n}`, published_at: `2026-09-0${n}T00:00:00Z` }))
  assert.deepEqual(releaseTagsToPrune(releases, "rcc", "rcc-3", 1, new Set(["rcc-1"])), ["rcc-2"])
})

test("recipe references resolve native Homebrew version interpolation", () => {
  const root = mkdtempSync(join(tmpdir(), "tap-retention-"))
  try {
    mkdirSync(join(root, "Casks"))
    mkdirSync(join(root, "Formula"))
    writeFileSync(join(root, "Casks", "rcc@1.rb"), 'version "1"\nurl "https://github.com/test/tap/releases/download/rcc-#{version}/rcc"\n')
    writeFileSync(join(root, "Formula", "other.rb"), 'url "https://github.com/other/repo/releases/download/other-1/file"\n')
    assert.deepEqual([...referencedReleaseTags(root, "test/tap")], ["rcc-1"])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

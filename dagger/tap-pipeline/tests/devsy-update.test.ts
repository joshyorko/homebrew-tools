import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { rewriteCaskUrl } from "../src/cask-render.ts"
import {
  DEVSY_AMD64_ASSET,
  DEVSY_ARM64_ASSET,
  DEVSY_DESKTOP_ASSET,
  renderDevsyDesktopCask,
  renderDevsyFormula,
  resolveStableDevsyRelease,
  verifyDevsyGithubDigest,
} from "../src/devsy-render.ts"
import { changedCiPackagesFromPaths, releaseMetadataForPackage } from "../src/library.ts"

const applyReleaseBundle = new URL("../../../scripts/apply-release-bundle.mjs", import.meta.url)

test("synthetic Devsy stable bump rewrites every updater-owned package surface", () => {
  const currentFormula = readFileSync(new URL("../../../Formula/devsy.rb", import.meta.url), "utf8")
  const currentCask = readFileSync(new URL("../../../Casks/devsy-desktop.rb", import.meta.url), "utf8")
  const currentVersion = currentFormula.match(/^\s*version "(\d+\.\d+\.\d+)"$/m)?.[1]
  const oldDigests = [
    ...currentFormula.matchAll(/^\s*sha256 "([a-f0-9]{64})"$/gm),
    ...currentCask.matchAll(/^\s*sha256 x86_64_linux: "([a-f0-9]{64})"$/gm),
  ].map((match) => match[1])
  const nextVersion = "9.8.7"
  const nextTag = `v${nextVersion}`
  const nextCommit = "b".repeat(40)
  const sha = {
    amd64: "1".repeat(64),
    arm64: "2".repeat(64),
    desktop: "3".repeat(64),
  }
  const asset = (name: string, digest: string) => ({
    name,
    browser_download_url: `https://github.com/devsy-org/devsy/releases/download/${nextTag}/${name}`,
    digest: `sha256:${digest}`,
  })
  const resolved = resolveStableDevsyRelease({
    draft: false,
    prerelease: false,
    tag_name: nextTag,
    assets: [
      asset(DEVSY_AMD64_ASSET, sha.amd64),
      asset(DEVSY_ARM64_ASSET, sha.arm64),
      asset(DEVSY_DESKTOP_ASSET, sha.desktop),
    ],
  })

  verifyDevsyGithubDigest(resolved.amd64, sha.amd64)
  verifyDevsyGithubDigest(resolved.arm64, sha.arm64)
  verifyDevsyGithubDigest(resolved.desktop, sha.desktop)

  const formulaTag = `devsy-${resolved.version}`
  const desktopTag = `devsy-desktop-${resolved.version}`
  const formula = renderDevsyFormula(currentFormula, {
    version: resolved.version,
    amd64Sha256: sha.amd64,
    arm64Sha256: sha.arm64,
    amd64Url: `https://github.com/joshyorko/homebrew-tools/releases/download/${formulaTag}/${DEVSY_AMD64_ASSET}`,
    arm64Url: `https://github.com/joshyorko/homebrew-tools/releases/download/${formulaTag}/${DEVSY_ARM64_ASSET}`,
  })
  const cask = renderDevsyDesktopCask(
    currentCask,
    {
      version: resolved.version,
      sha256: sha.desktop,
      downloadUrl: `https://github.com/joshyorko/homebrew-tools/releases/download/${desktopTag}/${DEVSY_DESKTOP_ASSET}`,
    },
    rewriteCaskUrl,
  )
  const formulaRelease = releaseMetadataForPackage("devsy", {
    version: resolved.version,
    releaseTag: formulaTag,
    assetName: DEVSY_AMD64_ASSET,
    artifactSha256: sha.amd64,
    downloadUrl: `https://github.com/joshyorko/homebrew-tools/releases/download/${formulaTag}/${DEVSY_AMD64_ASSET}`,
    releaseTitle: `Devsy CLI ${resolved.version}`,
    releaseNotes: `Synthetic release ${resolved.upstreamTag} (${nextCommit})`,
    commitMessage: `Update devsy formula to v${resolved.version}`,
    upstream: {
      kind: "github_release",
      repo: "https://github.com/devsy-org/devsy",
      assetPrefix: "devsy-linux-",
      version: resolved.version,
      commit: nextCommit,
    },
  })
  const desktopRelease = releaseMetadataForPackage("devsy-desktop", {
    version: resolved.version,
    releaseTag: desktopTag,
    assetName: DEVSY_DESKTOP_ASSET,
    artifactSha256: sha.desktop,
    downloadUrl: `https://github.com/joshyorko/homebrew-tools/releases/download/${desktopTag}/${DEVSY_DESKTOP_ASSET}`,
    releaseTitle: `Devsy Desktop ${resolved.version}`,
    releaseNotes: `Synthetic release ${resolved.upstreamTag} (${nextCommit})`,
    commitMessage: `Update devsy-desktop cask to v${resolved.version}`,
    upstream: {
      kind: "github_release",
      repo: "https://github.com/devsy-org/devsy",
      assetName: DEVSY_DESKTOP_ASSET,
      version: resolved.version,
      commit: nextCommit,
    },
  })

  const tempRoot = mkdtempSync(join(tmpdir(), "devsy-update-test-"))
  try {
    const repo = join(tempRoot, "repo")
    const formulaBundle = join(tempRoot, "formula-bundle")
    const desktopBundle = join(tempRoot, "desktop-bundle")
    mkdirSync(join(repo, "Formula"), { recursive: true })
    mkdirSync(join(repo, "Casks"), { recursive: true })
    mkdirSync(join(formulaBundle, "homebrew"), { recursive: true })
    mkdirSync(join(desktopBundle, "homebrew"), { recursive: true })
    writeFileSync(join(repo, "Formula", "devsy.rb"), currentFormula)
    writeFileSync(join(repo, "Casks", "devsy-desktop.rb"), currentCask)
    writeFileSync(join(formulaBundle, "homebrew", "devsy.rb"), formula)
    writeFileSync(join(formulaBundle, "release.json"), `${JSON.stringify(formulaRelease)}\n`)
    writeFileSync(join(desktopBundle, "homebrew", "devsy-desktop.rb"), cask)
    writeFileSync(join(desktopBundle, "release.json"), `${JSON.stringify(desktopRelease)}\n`)

    execFileSync(process.execPath, [applyReleaseBundle.pathname, "--bundle", formulaBundle, "--repo", repo])
    execFileSync(process.execPath, [applyReleaseBundle.pathname, "--bundle", desktopBundle, "--repo", repo])

    const appliedFormula = readFileSync(join(repo, "Formula", "devsy.rb"), "utf8")
    const appliedCask = readFileSync(join(repo, "Casks", "devsy-desktop.rb"), "utf8")
    assert.equal(appliedFormula, formula)
    assert.equal(appliedCask, cask)
    assert.deepEqual(
      changedCiPackagesFromPaths(["Formula/devsy.rb", "Casks/devsy-desktop.rb"]),
      ["devsy", "devsy-desktop"],
    )
    assert.match(appliedFormula, new RegExp(`version "${nextVersion}"`))
    assert.match(appliedCask, new RegExp(`version "${nextVersion}"`))
    assert.equal((formulaRelease.upstream as { commit: string }).commit, nextCommit)
    assert.equal((desktopRelease.upstream as { commit: string }).commit, nextCommit)
    assert.doesNotMatch(`${appliedFormula}\n${appliedCask}`, new RegExp(`version "${currentVersion}"`))
    for (const digest of oldDigests) {
      assert.doesNotMatch(`${appliedFormula}\n${appliedCask}`, new RegExp(digest))
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})

test("Devsy stable release resolution rejects prereleases, missing assets, and digest drift", () => {
  const base = {
    draft: false,
    prerelease: false,
    tag_name: "v2.0.0",
    assets: [],
  }

  assert.throws(() => resolveStableDevsyRelease({ ...base, prerelease: true }), /stable semantic/)
  assert.throws(() => resolveStableDevsyRelease(base), /missing devsy-linux-amd64/)
  assert.throws(
    () => verifyDevsyGithubDigest({
      name: DEVSY_AMD64_ASSET,
      browser_download_url: "https://example.invalid/devsy",
      digest: `sha256:${"a".repeat(64)}`,
    }, "b".repeat(64)),
    /GitHub digest mismatch/,
  )
})

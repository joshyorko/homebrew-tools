#!/usr/bin/env node

import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export async function verifyBundle(bundleDir, expected, packageId) {
  const releasePath = join(bundleDir, "release.json")
  const artifactsDir = join(bundleDir, "artifacts")
  if (!existsSync(releasePath) || !existsSync(artifactsDir)) {
    throw new Error("Resolved retained bundle must contain release.json and artifacts/")
  }

  const bundleRelease = JSON.parse(readFileSync(releasePath, "utf8"))
  if (bundleRelease.release_tag !== expected.release_tag) {
    throw new Error(`Bundle tag mismatch: ${bundleRelease.release_tag} != ${expected.release_tag}`)
  }
  if (!Array.isArray(expected.assets) || expected.assets.length === 0) {
    throw new Error("Expected release manifest has no assets")
  }

  const assets = []
  for (const asset of expected.assets) {
    if (basename(asset.name) !== asset.name || asset.name === "." || asset.name === "..") {
      throw new Error(`Unsafe expected asset name: ${asset.name}`)
    }
    const path = join(artifactsDir, asset.name)
    const stat = lstatSync(path)
    if (!stat.isFile()) throw new Error(`Expected a regular asset file: ${asset.name}`)
    if (stat.size !== asset.size) throw new Error(`Size mismatch for ${asset.name}: ${stat.size} != ${asset.size}`)
    const sha256 = await hashFile(path)
    if (sha256 !== asset.sha256) throw new Error(`SHA256 mismatch for ${asset.name}: ${sha256} != ${asset.sha256}`)
    assets.push({ name: asset.name, size: stat.size, sha256, digest_verified: true })
  }

  return {
    schema_version: 1,
    package_id: packageId,
    original_release_id: expected.original_release_id,
    release_tag: expected.release_tag,
    tag_commit_sha: expected.tag_commit_sha,
    source_artifact_id: expected.source_artifact_id,
    source_run_id: expected.source_run_id,
    source_artifact_name: expected.source_artifact_name,
    verified_at: new Date().toISOString(),
    assets,
  }
}

export function classifyLiveRelease(expected, liveRelease, marker) {
  if (!liveRelease) return "create"
  if (String(liveRelease.id) === String(expected.original_release_id)) return "replace-original"
  if (typeof liveRelease.body === "string" && liveRelease.body.includes(marker)) return "reuse-reset"
  throw new Error(`Release ${expected.release_tag} exists but is not owned by this reset`)
}

export function planAssetRestore(expectedAssets, liveAssets, resetOwned) {
  const existing = new Map()
  for (const asset of liveAssets) {
    if (existing.has(asset.name)) throw new Error(`Duplicate live release asset: ${asset.name}`)
    existing.set(asset.name, asset)
  }

  return expectedAssets.map((expected) => {
    const live = existing.get(expected.name)
    if (!live) return { name: expected.name, action: "upload" }
    if (live.size === expected.size && live.digest === `sha256:${expected.sha256}`) {
      return { name: expected.name, action: "skip-verified" }
    }
    if (resetOwned && live.state === "starter" && !live.digest && live.size < expected.size) {
      return { name: expected.name, action: "remove-starter-and-upload" }
    }
    throw new Error(`Refusing to overwrite mismatching release asset ${expected.name}`)
  })
}

export function planReleaseRestore(expected, liveRelease, marker) {
  const action = classifyLiveRelease(expected, liveRelease, marker)
  if (action === "replace-original") {
    const expectedNames = new Set(expected.assets.map((asset) => asset.name))
    const originalAssets = liveRelease.assets ?? []
    if (
      originalAssets.length !== expectedNames.size ||
      originalAssets.some((asset) => !expectedNames.has(asset.name))
    ) {
      throw new Error("Original release asset names do not match the saved inventory; refusing to delete release")
    }
    const originalAssetPlan = planAssetRestore(expected.assets, originalAssets, false)
    if (originalAssetPlan.some((asset) => asset.action !== "skip-verified")) {
      throw new Error("Original release assets do not match the saved inventory; refusing to delete release")
    }
  }
  const liveAssets = action === "reuse-reset" ? (liveRelease.assets ?? []) : []
  return {
    action,
    assets: planAssetRestore(expected.assets, liveAssets, action === "reuse-reset"),
  }
}

async function hashFile(path) {
  const hash = createHash("sha256")
  for await (const bytes of createReadStream(path)) hash.update(bytes)
  return hash.digest("hex")
}

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (!key.startsWith("--")) throw new Error(`Unexpected argument: ${key}`)
    const value = argv[index + 1]
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`)
    args[key.slice(2)] = value
    index += 1
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.manifest || !args["package-id"] || !args.mode || !args.output) {
    throw new Error("Usage: restore-retained-release.mjs --mode <verify-bundle|plan-release> --manifest <file> --package-id <id> --bundle-dir <dir>|--live-release <file|absent> --output <json>")
  }
  const manifest = JSON.parse(readFileSync(resolve(args.manifest), "utf8"))
  const expected = manifest.packages?.[args["package-id"]]
  if (!expected) throw new Error(`Package is not in the retained release allowlist: ${args["package-id"]}`)
  let output
  if (args.mode === "verify-bundle") {
    if (!args["bundle-dir"]) throw new Error("--bundle-dir is required for verify-bundle")
    output = await verifyBundle(resolve(args["bundle-dir"]), expected, args["package-id"])
  } else if (args.mode === "plan-release") {
    if (!args["live-release"]) throw new Error("--live-release is required for plan-release")
    const liveRelease = args["live-release"] === "absent"
      ? null
      : JSON.parse(readFileSync(resolve(args["live-release"]), "utf8"))
    output = planReleaseRestore(expected, liveRelease, manifest.reset_marker)
  } else {
    throw new Error(`Unknown mode: ${args.mode}`)
  }
  writeFileSync(resolve(args.output), `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 })
  process.stdout.write(`${args.output}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}

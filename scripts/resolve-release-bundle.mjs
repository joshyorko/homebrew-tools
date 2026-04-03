import { readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

function usage() {
  throw new Error("Usage: resolve-release-bundle.mjs --root <dir>")
}

function parseArgs(argv) {
  let rootDir

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--root") {
      rootDir = argv[index + 1]
      index += 1
      continue
    }
    usage()
  }

  if (!rootDir) {
    usage()
  }

  return { rootDir: resolve(rootDir) }
}

function safeStat(path) {
  try {
    return statSync(path)
  } catch {
    return null
  }
}

function isBundleDir(path) {
  const releaseJson = safeStat(join(path, "release.json"))
  const artifacts = safeStat(join(path, "artifacts"))
  return Boolean(releaseJson?.isFile() && artifacts?.isDirectory())
}

function findBundleDirs(rootDir, maxDepth = 4) {
  const results = []
  const visited = new Set()

  function walk(currentDir, depth) {
    if (visited.has(currentDir) || depth > maxDepth) {
      return
    }

    visited.add(currentDir)

    if (isBundleDir(currentDir)) {
      results.push(currentDir)
      return
    }

    const currentStat = safeStat(currentDir)
    if (!currentStat?.isDirectory()) {
      return
    }

    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue
      }

      walk(join(currentDir, entry.name), depth + 1)
    }
  }

  walk(rootDir, 0)
  return results
}

function resolveBundleDir(rootDir) {
  if (isBundleDir(rootDir)) {
    return rootDir
  }

  const nestedBundleDir = join(rootDir, "bundle")
  if (isBundleDir(nestedBundleDir)) {
    return nestedBundleDir
  }

  const discoveredBundleDirs = findBundleDirs(rootDir)
  if (discoveredBundleDirs.length === 1) {
    return discoveredBundleDirs[0]
  }

  if (discoveredBundleDirs.length > 1) {
    throw new Error(
      `Found multiple release bundle directories under ${rootDir}: ${discoveredBundleDirs.join(", ")}`
    )
  }

  throw new Error(`Could not resolve a release bundle directory under ${rootDir}`)
}

const { rootDir } = parseArgs(process.argv)
process.stdout.write(`${resolveBundleDir(rootDir)}\n`)

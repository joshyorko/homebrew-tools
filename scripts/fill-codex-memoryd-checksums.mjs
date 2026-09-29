#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs"

function option(args, name, fallback) {
  const index = args.indexOf(name)
  return index === -1 ? fallback : args[index + 1]
}

function usage() {
  throw new Error("Usage: fill-codex-memoryd-checksums.mjs --checksums SHA256SUMS [--formula Formula/codex-memoryd.rb]")
}

const args = process.argv.slice(2)
const checksumsPath = option(args, "--checksums")
const formulaPath = option(args, "--formula", "Formula/codex-memoryd.rb")
if (!checksumsPath || !formulaPath) usage()

const checksums = new Map()
for (const line of readFileSync(checksumsPath, "utf8").split(/\r?\n/)) {
  const match = line.trim().match(
    /^([0-9a-fA-F]{64})\s+[* ]?(codex-memoryd-v0\.1\.0-(x86_64-unknown-linux-gnu|aarch64-unknown-linux-gnu|x86_64-apple-darwin|aarch64-apple-darwin)\.tar\.gz)$/,
  )
  if (match) checksums.set(match[2], match[1].toLowerCase())
}

const targets = [
  ["x86_64_linux", "x86_64-unknown-linux-gnu"],
  ["aarch64_linux", "aarch64-unknown-linux-gnu"],
  ["x86_64_macos", "x86_64-apple-darwin"],
  ["aarch64_macos", "aarch64-apple-darwin"],
]
for (const [, target] of targets) {
  if (!checksums.has(`codex-memoryd-v0.1.0-${target}.tar.gz`)) {
    throw new Error(`SHA256SUMS is missing codex-memoryd-v0.1.0-${target}.tar.gz`)
  }
}

let formula = readFileSync(formulaPath, "utf8")
for (const [platform, target] of targets) {
  const marker = new RegExp(`(sha256\\s+)"RELEASE_INTEGRATION_REQUIRED_${platform}"`)
  if (!marker.test(formula)) {
    throw new Error(`Formula has no release-integration checksum marker for ${platform}`)
  }
  formula = formula.replace(marker, `$1"${checksums.get(`codex-memoryd-v0.1.0-${target}.tar.gz`)}"`)
}
writeFileSync(formulaPath, formula)
console.log(`Updated ${formulaPath} from ${checksumsPath}`)

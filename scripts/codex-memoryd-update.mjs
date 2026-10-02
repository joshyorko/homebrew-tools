#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

export const TARGETS = [
  "x86_64-unknown-linux-gnu",
  "aarch64-unknown-linux-gnu",
  "x86_64-apple-darwin",
  "aarch64-apple-darwin",
]

export function sourceVersion(source) {
  if (!source || !/^[0-9a-f]{40}$/.test(source.sha ?? "")) throw new Error("Invalid source commit")
  const date = source.commit?.committer?.date
  if (typeof date !== "string" || !Number.isFinite(Date.parse(date))) throw new Error("Invalid source commit date")
  const timestamp = new Date(date).toISOString().replace(/\D/g, "").slice(0, 14)
  return `${timestamp}.${source.sha.slice(0, 12)}`
}

export function renderFormula(formula, version, checksums) {
  if (!/^\d{14}\.[0-9a-f]{12}$/.test(version)) throw new Error("Invalid build version")
  if ((formula.match(/^  version "[^"]+"$/gm) ?? []).length !== 1) throw new Error("Expected one formula version")
  const digests = new Map()
  for (const line of checksums.trim().split(/\r?\n/)) {
    const match = line.match(/^([0-9a-f]{64})\s+\*?(\S+)$/)
    if (!match) throw new Error("Invalid artifact checksum")
    if (digests.has(match[2])) throw new Error(`Duplicate checksum: ${match[2]}`)
    digests.set(match[2], match[1])
  }
  let rendered = formula.replace(/^  version "[^"]+"$/m, `  version "${version}"`)
    .replace(/^    skip "[^"]+"$/m, '    skip "Tap auto-update tracks merged master commits."')
  for (const target of TARGETS) {
    const asset = `codex-memoryd-${version}-${target}.tar.gz`
    const digest = digests.get(asset)
    if (!digest) throw new Error(`Artifact checksum missing: ${asset}`)
    const stanza = new RegExp(`url "[^"\\n]*${target}\\.tar\\.gz"\\n      sha256 "[^"]+"`, "g")
    if ((rendered.match(stanza) ?? []).length !== 1) throw new Error(`Expected one formula stanza for ${target}`)
    rendered = rendered.replace(stanza,
      `url "https://github.com/joshyorko/homebrew-tools/releases/download/codex-memoryd-#{version}/codex-memoryd-#{version}-${target}.tar.gz"\n      sha256 "${digest}"`)
  }
  if (digests.size !== TARGETS.length) throw new Error("Unexpected artifact checksum")
  return rendered
}

function main() {
  const [command, ...args] = process.argv.slice(2)
  if (command === "version" && args.length === 1) {
    console.log(sourceVersion(JSON.parse(readFileSync(args[0], "utf8"))))
  } else if (command === "formula" && args.length === 3) {
    const [path, version, checksums] = args
    writeFileSync(path, renderFormula(readFileSync(path, "utf8"), version, readFileSync(checksums, "utf8")))
  } else {
    throw new Error("Usage: codex-memoryd-update.mjs version COMMIT.json | formula FORMULA VERSION SHA256SUMS")
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()

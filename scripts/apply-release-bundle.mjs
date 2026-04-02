#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

function parseArgs(argv) {
  const args = {}

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg?.startsWith("--")) continue

    const key = arg.slice(2)
    const value = argv[index + 1]
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`)
    }

    args[key] = value
    index += 1
  }

  return args
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const bundleDirArg = args.bundle
  const repoDirArg = args.repo

  if (!bundleDirArg || !repoDirArg) {
    throw new Error("Usage: apply-release-bundle.mjs --bundle <dir> --repo <dir>")
  }

  const bundleDir = resolve(bundleDirArg)
  const repoDir = resolve(repoDirArg)
  const releaseJsonPath = join(bundleDir, "release.json")

  if (!existsSync(releaseJsonPath)) {
    throw new Error(`Missing release metadata at ${releaseJsonPath}`)
  }

  const release = JSON.parse(readFileSync(releaseJsonPath, "utf8"))
  const homebrewPath = release.homebrew_path

  if (typeof homebrewPath !== "string" || homebrewPath.length === 0) {
    throw new Error("release.json is missing homebrew_path")
  }

  const renderedSource = join(bundleDir, "homebrew", homebrewPath.split("/").pop())
  if (!existsSync(renderedSource)) {
    throw new Error(`Missing rendered Homebrew file at ${renderedSource}`)
  }

  const destination = join(repoDir, homebrewPath)
  mkdirSync(dirname(destination), { recursive: true })
  cpSync(renderedSource, destination)

  console.log(destination)
}

main()

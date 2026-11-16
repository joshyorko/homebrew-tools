#!/usr/bin/env node

import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"

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

  if (isAbsolute(homebrewPath) || !/^(Casks|Formula)\//.test(homebrewPath)) {
    throw new Error(`release.json contains an invalid homebrew_path: ${homebrewPath}`)
  }

  const renderedSource = join(bundleDir, "homebrew", homebrewPath.split("/").pop())
  if (!existsSync(renderedSource)) {
    throw new Error(`Missing rendered Homebrew file at ${renderedSource}`)
  }

  const destination = resolve(repoDir, homebrewPath)
  const destinationRelative = relative(repoDir, destination)

  if (
    destinationRelative.startsWith("..") ||
    destinationRelative.includes("../") ||
    destinationRelative === ".."
  ) {
    throw new Error(`Refusing to write outside the repository: ${homebrewPath}`)
  }

  // T3 notes are part of the candidate tap snapshot, so checking/preparing an
  // update needs no live upstream call and promotion keeps an auditable copy.
  let notesDestination
  let notesContents
  if (release.upstream_notes_path !== undefined) {
    const notesPath = release.upstream_notes_path
    const packageVersion = release.version
    if (!["t3code-cli-main", "t3-code-linux"].includes(release.package)
      || typeof packageVersion !== "string"
      || !/^\d+\.\d+\.\d+-nightly\.\d{8}\.\d+\.homebrew\.[1-9]\d*\.[a-f0-9]{12}$/.test(packageVersion)
      || notesPath !== `metadata/t3-nightly/${packageVersion}.json`) {
      throw new Error("Invalid T3 nightly provenance path or package identity")
    }
    const source = join(bundleDir, notesPath)
    const stat = lstatSync(source)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4_500_000) throw new Error("Invalid T3 nightly provenance file")
    notesContents = readFileSync(source, "utf8")
    const notes = JSON.parse(notesContents)
    if (notes.schemaVersion !== 1 || notes.packageVersion !== packageVersion
      || typeof notes.sourceCommit !== "string"
      || !/^[a-f0-9]{40}$/.test(notes.sourceCommit)
      || !packageVersion.endsWith(`.${notes.sourceCommit.slice(0, 12)}`)
      || notes.sourceCommit !== release.upstream?.commit
      || notes.upstream?.commit !== notes.sourceCommit
      || notes.upstream?.tag !== release.upstream?.ref
      || notes.upstream?.version !== release.upstream?.version
      || notes.upstream?.tag !== `v${notes.upstream?.version}`
      || !packageVersion.startsWith(`${notes.upstream?.version}.homebrew.`)
      || JSON.stringify(notes) !== JSON.stringify(release.upstream_notes)) {
      throw new Error("T3 nightly provenance does not match the release")
    }
    notesDestination = join(repoDir, notesPath)
    // Never traverse an existing symlink in the candidate repository.
    for (const path of [join(repoDir, "metadata"), join(repoDir, "metadata/t3-nightly"), notesDestination]) {
      if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error("Unsafe T3 nightly provenance destination")
    }
  }

  mkdirSync(dirname(destination), { recursive: true })
  cpSync(renderedSource, destination)
  if (notesDestination) {
    mkdirSync(dirname(notesDestination), { recursive: true })
    writeFileSync(notesDestination, notesContents)
  }

  console.log(destination)
}

main()

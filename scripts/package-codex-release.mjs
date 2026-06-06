#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { execFileSync } from "node:child_process"

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
  const upstreamDirArg = args["upstream-dir"]
  const binaryArg = args.binary
  const version = args.version
  const outputPathArg = args.output

  if (!upstreamDirArg || !binaryArg || !version || !outputPathArg) {
    throw new Error(
      "Usage: package-codex-release.mjs --upstream-dir <dir> --binary <path> --version <version> --output <tar.gz>",
    )
  }

  const upstreamDir = resolve(upstreamDirArg)
  const binaryPath = resolve(binaryArg)
  const outputPath = resolve(outputPathArg)

  if (!existsSync(binaryPath)) {
    throw new Error(`Missing built codex binary at ${binaryPath}`)
  }

  const stageRoot = mkdtempSync(join(tmpdir(), "codex-release-homebrew-"))
  const packageDir = join(stageRoot, "package")
  const libexecDir = join(packageDir, "libexec")

  try {
    mkdirSync(libexecDir, { recursive: true })

    copyFileSync(binaryPath, join(libexecDir, "codex"))
    copyFileSync(join(upstreamDir, "README.md"), join(packageDir, "README.md"))
    copyFileSync(join(upstreamDir, "LICENSE"), join(packageDir, "LICENSE"))

    mkdirSync(dirname(outputPath), { recursive: true })
    execFileSync(
      "tar",
      [
        "--sort=name",
        "--mtime=@0",
        "--owner=0",
        "--group=0",
        "--numeric-owner",
        "--use-compress-program=gzip -n",
        "-cf",
        outputPath,
        "-C",
        packageDir,
        ".",
      ],
      { stdio: "inherit" },
    )

    console.log(outputPath)
  } finally {
    rmSync(stageRoot, { recursive: true, force: true })
  }
}

main()

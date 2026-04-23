#!/usr/bin/env node

import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
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
  const upstreamDirArg = args["upstream-dir"]
  const binaryArg = args.binary
  const version = args.version
  const outputPathArg = args.output

  if (!upstreamDirArg || !binaryArg || !version || !outputPathArg) {
    throw new Error(
      "Usage: package-fizzy-cli-master.mjs --upstream-dir <dir> --binary <path> --version <version> --output <tar.gz>",
    )
  }

  const upstreamDir = resolve(upstreamDirArg)
  const binaryPath = resolve(binaryArg)
  const outputPath = resolve(outputPathArg)
  const stageRoot = mkdtempSync(join(tmpdir(), "fizzy-cli-master-homebrew-"))
  const packageDir = join(stageRoot, "package")
  const libexecDir = join(packageDir, "libexec")
  const bashCompletionDir = join(packageDir, "completions", "bash")
  const fishCompletionDir = join(packageDir, "completions", "fish")
  const zshCompletionDir = join(packageDir, "completions", "zsh")

  try {
    mkdirSync(libexecDir, { recursive: true })
    mkdirSync(bashCompletionDir, { recursive: true })
    mkdirSync(fishCompletionDir, { recursive: true })
    mkdirSync(zshCompletionDir, { recursive: true })

    const packagedBinary = join(libexecDir, "fizzy")
    copyFileSync(binaryPath, packagedBinary)
    chmodSync(packagedBinary, 0o755)

    copyFileSync(join(upstreamDir, "README.md"), join(packageDir, "README.md"))
    copyFileSync(join(upstreamDir, "MIT-LICENSE"), join(packageDir, "LICENSE"))

    writeFileSync(
      join(bashCompletionDir, "fizzy"),
      execFileSync(binaryPath, ["completion", "bash"], { encoding: "utf8" }),
    )
    writeFileSync(
      join(fishCompletionDir, "fizzy.fish"),
      execFileSync(binaryPath, ["completion", "fish"], { encoding: "utf8" }),
    )
    writeFileSync(
      join(zshCompletionDir, "_fizzy"),
      execFileSync(binaryPath, ["completion", "zsh"], { encoding: "utf8" }),
    )

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

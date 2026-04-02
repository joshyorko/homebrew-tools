#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { execFileSync } from "node:child_process"

function parseArgs(argv) {
  const args = {}

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg || !arg.startsWith("--")) continue

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

function copyIfExists(sourcePath, targetPath) {
  if (!existsSync(sourcePath)) return false
  copyFileSync(sourcePath, targetPath)
  return true
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const upstreamDirArg = args["upstream-dir"]
  const binaryArg = args.binary
  const version = args.version
  const outputPathArg = args.output

  if (!upstreamDirArg || !binaryArg || !version || !outputPathArg) {
    throw new Error(
      "Usage: package-voxtype.mjs --upstream-dir <dir> --binary <path> --version <version> --output <tar.gz>",
    )
  }

  const upstreamDir = resolve(upstreamDirArg)
  const binaryPath = resolve(binaryArg)
  const outputPath = resolve(outputPathArg)

  if (!existsSync(binaryPath)) {
    throw new Error(`Missing built voxtype binary at ${binaryPath}`)
  }

  const stageRoot = mkdtempSync(join(tmpdir(), "voxtype-homebrew-"))
  const packageDir = join(stageRoot, "package")
  const libexecDir = join(packageDir, "libexec")
  const shareDir = join(packageDir, "share", "voxtype")
  const manDir = join(packageDir, "man", "man1")
  const bashCompletionDir = join(packageDir, "completions", "bash")
  const fishCompletionDir = join(packageDir, "completions", "fish")
  const zshCompletionDir = join(packageDir, "completions", "zsh")

  mkdirSync(libexecDir, { recursive: true })
  mkdirSync(shareDir, { recursive: true })
  mkdirSync(manDir, { recursive: true })
  mkdirSync(bashCompletionDir, { recursive: true })
  mkdirSync(fishCompletionDir, { recursive: true })
  mkdirSync(zshCompletionDir, { recursive: true })

  copyFileSync(binaryPath, join(libexecDir, "voxtype"))
  copyFileSync(join(upstreamDir, "config", "default.toml"), join(shareDir, "default.toml"))
  copyFileSync(join(upstreamDir, "README.md"), join(packageDir, "README.md"))
  copyFileSync(join(upstreamDir, "LICENSE"), join(packageDir, "LICENSE"))

  copyIfExists(
    join(upstreamDir, "packaging", "completions", "voxtype.bash"),
    join(bashCompletionDir, "voxtype"),
  )
  copyIfExists(
    join(upstreamDir, "packaging", "completions", "voxtype.fish"),
    join(fishCompletionDir, "voxtype.fish"),
  )
  copyIfExists(
    join(upstreamDir, "packaging", "completions", "voxtype.zsh"),
    join(zshCompletionDir, "_voxtype"),
  )

  const manPagesPattern = join(upstreamDir, "target", "release", "build")
  if (existsSync(manPagesPattern)) {
    execFileSync(
      "bash",
      [
        "-lc",
        `find ${JSON.stringify(manPagesPattern)} -path '*/out/man/*.1' -type f -exec cp {} ${JSON.stringify(manDir)} \\;`,
      ],
      { stdio: "inherit" },
    )
  }

  mkdirSync(dirname(outputPath), { recursive: true })
  execFileSync("tar", ["-czf", outputPath, "-C", packageDir, "."], {
    stdio: "inherit",
  })

  rmdirSync(stageRoot, { recursive: true })
  console.log(outputPath)
}

main()

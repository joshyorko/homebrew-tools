#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
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

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

function normalizeBinEntry(binEntry) {
  if (typeof binEntry !== "string" || binEntry.length === 0) {
    throw new Error('Expected package.json to define a string bin entry for "fizzy-symphony"')
  }

  return binEntry.startsWith("./") ? binEntry.slice(2) : binEntry
}

function findNpmPackTarball(packDir) {
  const matches = readdirSync(packDir)
    .filter((entry) => /^fizzy-symphony-.*\.tgz$/.test(entry))
    .sort()

  if (matches.length !== 1) {
    throw new Error(`Expected exactly one fizzy-symphony npm tarball in ${packDir}, found ${matches.length}`)
  }

  return join(packDir, matches[0])
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const upstreamDirArg = args["upstream-dir"]
  const npmPackDirArg = args["npm-pack-dir"]
  const version = args.version
  const outputPathArg = args.output

  if (!upstreamDirArg || !npmPackDirArg || !version || !outputPathArg) {
    throw new Error(
      "Usage: package-fizzy-symphony.mjs --upstream-dir <dir> --npm-pack-dir <dir> --version <version> --output <tar.gz>",
    )
  }

  const upstreamDir = resolve(upstreamDirArg)
  const npmPackDir = resolve(npmPackDirArg)
  const outputPath = resolve(outputPathArg)
  const sourcePackageJson = readJson(join(upstreamDir, "package.json"))
  const cliEntryRelativePath = normalizeBinEntry(sourcePackageJson.bin?.["fizzy-symphony"])
  const npmPackTarball = findNpmPackTarball(npmPackDir)
  const stageRoot = mkdtempSync(join(tmpdir(), "fizzy-symphony-"))
  const packageDir = join(stageRoot, "package")

  try {
    mkdirSync(packageDir, { recursive: true })

    execFileSync("tar", ["-xzf", npmPackTarball, "--strip-components=1", "-C", packageDir], {
      stdio: "inherit",
    })
    cpSync(join(upstreamDir, "package-lock.json"), join(packageDir, "package-lock.json"))

    if (!existsSync(join(packageDir, cliEntryRelativePath))) {
      throw new Error(`Missing CLI entrypoint at ${join(packageDir, cliEntryRelativePath)}`)
    }

    if (!existsSync(join(packageDir, "src"))) {
      throw new Error(`Missing runtime source at ${join(packageDir, "src")}`)
    }

    execFileSync("npm", ["ci", "--omit=dev"], {
      cwd: packageDir,
      stdio: "inherit",
    })

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

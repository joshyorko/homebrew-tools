#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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
    throw new Error('Expected package.json to define a string bin entry for "fizzy-popper-self-hosted"')
  }

  return binEntry.startsWith("./") ? binEntry.slice(2) : binEntry
}

function resolveLockedDependencies(packageJson, packageLock) {
  const resolved = {}

  for (const name of Object.keys(packageJson.dependencies ?? {})) {
    const lockedPackage = packageLock.packages?.[`node_modules/${name}`]
    const lockedVersion = lockedPackage?.version

    if (!lockedVersion) {
      throw new Error(`Missing locked version for dependency "${name}"`)
    }

    resolved[name] = lockedVersion
  }

  return resolved
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const upstreamDirArg = args["upstream-dir"]
  const version = args.version
  const outputPathArg = args.output

  if (!upstreamDirArg || !version || !outputPathArg) {
    throw new Error(
      "Usage: package-fizzy-popper-self-hosted.mjs --upstream-dir <dir> --version <version> --output <tar.gz>",
    )
  }

  const upstreamDir = resolve(upstreamDirArg)
  const outputPath = resolve(outputPathArg)
  const sourcePackageJson = readJson(join(upstreamDir, "package.json"))
  const sourcePackageLock = readJson(join(upstreamDir, "package-lock.json"))
  const cliEntryRelativePath = normalizeBinEntry(sourcePackageJson.bin?.["fizzy-popper"])
  const cliEntry = join(upstreamDir, cliEntryRelativePath)
  const distDir = join(upstreamDir, "dist")
  const stageRoot = mkdtempSync(join(tmpdir(), "fizzy-popper-self-hosted-"))
  const packageDir = join(stageRoot, "package")

  if (!existsSync(distDir)) {
    throw new Error(`Missing build output at ${distDir}`)
  }

  if (!existsSync(cliEntry)) {
    throw new Error(`Missing CLI entrypoint at ${cliEntry}`)
  }

  try {
    mkdirSync(packageDir, { recursive: true })

    const runtimePackageJson = {
      name: "fizzy-popper-self-hosted",
      version,
      description: `${sourcePackageJson.description} (self-hosted fork build)`,
      homepage: "https://github.com/joshyorko/fizzy-popper/tree/self-hosted",
      license: sourcePackageJson.license ?? "MIT",
      type: "module",
      bin: {
        "fizzy-popper": `./${cliEntryRelativePath}`,
      },
      files: ["dist"],
      engines: sourcePackageJson.engines,
      dependencies: resolveLockedDependencies(sourcePackageJson, sourcePackageLock),
    }

    cpSync(distDir, join(packageDir, "dist"), { recursive: true })
    cpSync(join(upstreamDir, "README.md"), join(packageDir, "README.md"))
    cpSync(join(upstreamDir, "MIT-LICENSE"), join(packageDir, "LICENSE"))
    writeFileSync(join(packageDir, "package.json"), `${JSON.stringify(runtimePackageJson, null, 2)}\n`)

    execFileSync("npm", ["install", "--package-lock-only"], {
      cwd: packageDir,
      stdio: "inherit",
    })

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

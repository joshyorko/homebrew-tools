#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

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

function ghJson(args) {
  return JSON.parse(execFileSync("gh", args, { encoding: "utf8" }))
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const repo = args.repo
  const packageId = args["package-id"]
  const currentTag = args["current-tag"]
  const keep = Number.parseInt(args.keep ?? "3", 10)

  if (!repo || !packageId || !currentTag) {
    throw new Error(
      "Usage: prune-package-releases.mjs --repo <owner/name> --package-id <id> --current-tag <tag> [--keep <count>]",
    )
  }

  if (!Number.isInteger(keep) || keep < 1) {
    throw new Error(`--keep must be an integer >= 1, got ${args.keep ?? ""}`)
  }

  const releases = ghJson([
    "api",
    `repos/${repo}/releases?per_page=100`,
    "--paginate",
    "--slurp",
  ]).flat()

  const protectedTags = referencedReleaseTags(process.cwd(), repo)
  const prune = releaseTagsToPrune(releases, packageId, currentTag, keep, protectedTags)

  if (prune.length === 0) {
    console.log(`No old ${packageId} releases to prune. Keeping the current and referenced release(s).`)
    return
  }

  for (const tag of prune) {
    execFileSync(
      "gh",
      ["release", "delete", tag, "--repo", repo, "--yes"],
      { stdio: "inherit" },
    )
  }
}

export function referencedReleaseTags(repoRoot, repo) {
  const tags = new Set()
  for (const directory of ["Casks", "Formula"]) {
    for (const file of readdirSync(join(repoRoot, directory)).filter((name) => name.endsWith(".rb"))) {
      const source = readFileSync(join(repoRoot, directory, file), "utf8")
      const version = source.match(/^\s*version "([^"]+)"/m)?.[1]
      for (const match of source.matchAll(/https:\/\/github\.com\/([^/]+\/[^/]+)\/releases\/download\/([^/]+)\//g)) {
        if (match[1] !== repo) continue
        const tag = match[2].replaceAll("#{version}", version ?? "#{version}")
        if (tag.includes("#{")) throw new Error(`Cannot safely resolve release reference in ${file}: ${tag}`)
        tags.add(tag)
      }
    }
  }
  return tags
}

export function releaseTagsToPrune(releases, packageId, currentTag, keep, protectedTags = new Set()) {
  const matching = releases
    .filter((release) => typeof release.tag_name === "string" && release.tag_name.startsWith(`${packageId}-`))
    .sort((left, right) => Date.parse(right.published_at ?? right.created_at ?? 0) - Date.parse(left.published_at ?? left.created_at ?? 0))
  const keepTags = new Set([...matching.slice(0, keep).map((release) => release.tag_name), currentTag, ...protectedTags])
  return matching.filter((release) => !keepTags.has(release.tag_name)).map((release) => release.tag_name)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()

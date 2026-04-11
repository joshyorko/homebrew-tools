#!/usr/bin/env node

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

  const prefix = `${packageId}-`
  const matching = releases
    .filter((release) => typeof release.tag_name === "string" && release.tag_name.startsWith(prefix))
    .sort((left, right) => {
      const leftDate = Date.parse(left.published_at ?? left.created_at ?? 0)
      const rightDate = Date.parse(right.published_at ?? right.created_at ?? 0)
      return rightDate - leftDate
    })

  const keepTags = new Set(matching.slice(0, keep).map((release) => release.tag_name))
  keepTags.add(currentTag)

  const prune = matching.filter((release) => !keepTags.has(release.tag_name))

  if (prune.length === 0) {
    console.log(`No old ${packageId} releases to prune. Keeping ${keepTags.size} release(s).`)
    return
  }

  for (const release of prune) {
    execFileSync(
      "gh",
      ["release", "delete", release.tag_name, "--repo", repo, "--cleanup-tag", "--yes"],
      { stdio: "inherit" },
    )
  }
}

main()

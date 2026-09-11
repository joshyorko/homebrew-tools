#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { pathToFileURL } from "node:url"

import { ciPlanFromPaths } from "../dagger/tap-pipeline/src/library.ts"

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
const ZERO_SHA = /^0{40}$/

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args[0]} failed`)
  }
  return result.stdout
}

function validateRef(value, label) {
  if (!value || value.trim() !== value || value.includes("\0")) {
    throw new Error(`${label} must be a non-empty exact Git ref`)
  }
  if (ZERO_SHA.test(value)) {
    if (label === "HEAD_REF") {
      throw new Error("HEAD_REF cannot be the GitHub initial zero SHA")
    }
    return EMPTY_TREE
  }

  return git(["rev-parse", "--verify", "--end-of-options", `${value}^{commit}`]).trim()
}

function changedPaths(baseRef, headRef, eventName) {
  const base = validateRef(baseRef, "BASE_REF")
  const head = validateRef(headRef, "HEAD_REF")
  const comparisonBase = eventName === "pull_request"
    ? git(["merge-base", base, head]).trim()
    : base
  const output = git([
    "-c",
    "core.quotepath=false",
    "diff",
    "--no-ext-diff",
    "--name-only",
    "--no-renames",
    "--diff-filter=ACDMRTUXB",
    "-z",
    comparisonBase,
    head,
  ])
  return output.split("\0").filter((path) => path.length > 0)
}

function option(args, name) {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

export function planTapCi({ baseRef, headRef, eventName } = {}) {
  const resolvedBaseRef = baseRef ?? process.env.BASE_REF
  const resolvedHeadRef = headRef ?? process.env.HEAD_REF
  const resolvedEventName = eventName ?? process.env.EVENT_NAME ?? process.env.GITHUB_EVENT_NAME
  if (resolvedBaseRef === undefined || resolvedHeadRef === undefined) {
    throw new Error("BASE_REF and HEAD_REF must be provided")
  }

  return ciPlanFromPaths(changedPaths(resolvedBaseRef, resolvedHeadRef, resolvedEventName))
}

function main() {
  const args = process.argv.slice(2)
  const baseRef = option(args, "--base-ref")
  const headRef = option(args, "--head-ref")
  const eventName = option(args, "--event-name")
  if (args.some((arg, index) => (arg === "--base-ref" || arg === "--head-ref") && args[index + 1] === undefined)) {
    throw new Error("--base-ref and --head-ref require values")
  }

  console.log(JSON.stringify(planTapCi({ baseRef, headRef, eventName })))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

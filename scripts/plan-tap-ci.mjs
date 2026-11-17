#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { pathToFileURL } from "node:url"

import { nonsemanticScriptChange, packageFingerprint } from "./tap-ci-impact.mjs"

import { PACKAGE_REGISTRY, changedPackagesFromPaths, ciPlanFromPaths } from "../dagger/tap-pipeline/src/library.ts"

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
  return { base: comparisonBase, head, paths: output.split("\0").filter((path) => path.length > 0) }
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

  const { base, head, paths } = changedPaths(resolvedBaseRef, resolvedHeadRef, resolvedEventName)
  const cache = new Map()
  const read = (ref, path) => {
    const key = `${ref}:${path}`
    if (!cache.has(key)) {
      const result = spawnSync("git", ["show", key], { encoding: "utf8" })
      cache.set(key, result.status === 0 ? result.stdout : undefined)
    }
    return cache.get(key)
  }
  const sourcePaths = paths.filter((path) => /^dagger\/tap-pipeline\/src\/[^/]+\.ts$/.test(path))
  const remaining = paths.filter((path) => !sourcePaths.includes(path)
    && !nonsemanticScriptChange(path, read(base, path), read(head, path)))
  const plan = ciPlanFromPaths(remaining)
  if (sourcePaths.length) {
    try {
      for (const entry of PACKAGE_REGISTRY.filter((entry) => entry.supportsPrCi)) {
        const registryIds = [...new Set([entry.id, ...PACKAGE_REGISTRY.filter((dependency) =>
          changedPackagesFromPaths([dependency.homebrewPath]).includes(entry.id)).map((dependency) => dependency.id)])]
        if (packageFingerprint((path) => read(base, path), entry.id, registryIds, sourcePaths)
          !== packageFingerprint((path) => read(head, path), entry.id, registryIds, sourcePaths)) {
          const existing = plan.find((item) => item.package_id === entry.id)
          const reason = `changed CI dependency: ${sourcePaths.join(", ")}`
          if (existing) { existing.mode = "build"; existing.reason += `; ${reason}` }
          else plan.push({ package_id: entry.id, mode: "build", reason })
        }
      }
    } catch (error) {
      const fallback = ciPlanFromPaths(paths)
      const detail = error instanceof Error ? error.message : String(error)
      return fallback.map((entry) => ({ ...entry, reason: `${entry.reason}; impact unproved: ${detail}` }))
    }
  }
  return plan.sort((a, b) => PACKAGE_REGISTRY.findIndex((entry) => entry.id === a.package_id)
    - PACKAGE_REGISTRY.findIndex((entry) => entry.id === b.package_id))
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

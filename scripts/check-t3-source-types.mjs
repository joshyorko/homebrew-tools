import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

export function diagnostics(output) {
  const clean = output.replace(/\x1b\[[0-9;]*m/g, "")
  const unique = new Map()
  for (const line of clean.split(/\r?\n/)) {
    const match = line.match(/^(.+\.[cm]?tsx?)(?::(\d+):(\d+) -|\((\d+),(\d+)\):) error (TS\d+): (.+)$/)
    if (!match) {
      if (/(?:^|\s)error TS\d+:/.test(line)) throw new Error(`Unrecognized compiler error: ${line}`)
      continue
    }
    const file = match[1].replace(/^\.\//, "")
    const signature = `${file} ${match[6]}: ${match[7]}`
    unique.set(`${file}:${match[2] ?? match[4]}:${match[3] ?? match[5]} ${signature}`, { file, signature })
  }
  return [...unique.values()]
}

export function regressions(baseline, current, changedFiles) {
  const remaining = new Map()
  for (const item of baseline) remaining.set(item.signature, (remaining.get(item.signature) ?? 0) + 1)
  return current.filter((item) => {
    if (changedFiles.has(item.file)) return true
    const count = remaining.get(item.signature) ?? 0
    if (count === 0) return true
    remaining.set(item.signature, count - 1)
    return false
  })
}

function check(source, reports, patches) {
  mkdirSync(reports, { recursive: true })
  const packages = [
    ["desktop", "@t3tools/desktop", "apps/desktop/"],
    ["web", "@t3tools/web", "apps/web/"],
    ["contracts", "@t3tools/contracts", "packages/contracts/"],
    ["server", "t3", "apps/server/"],
    ["shared", "@t3tools/shared", "packages/shared/"],
  ]
  const homebrewOwnedFiles = new Set([
    "apps/desktop/src/updates/HomebrewDesktopUpdates.ts",
    "apps/desktop/src/updates/DesktopUpdates.homebrew.test.ts",
    "apps/desktop/src/updates/HomebrewDesktopUpdates.test.ts",
    "apps/desktop/src/updates/homebrewUpdatesTestHarness.ts",
    "apps/desktop/src/app/DesktopApp.homebrew.test.ts",
    "apps/web/src/components/homebrewDesktopUpdate.logic.ts",
    "apps/web/src/components/sidebar/useHomebrewUpdateResult.ts",
  ])
  for (const file of homebrewOwnedFiles) {
    if (!existsSync(resolve(source, file))) throw new Error(`Required Homebrew source file is missing: ${file}`)
  }
  const run = (stage) => packages.map(([label, , prefix]) => {
    const freshState = mkdtempSync(resolve(reports, `${stage}-${label}-`))
    const result = spawnSync("pnpm", ["exec", "effect-tsgo", "tsrs", "--noEmit", "--pretty", "false",
      "--incremental", "--tsBuildInfoFile", resolve(freshState, "types.tsbuildinfo")], {
      cwd: resolve(source, prefix), encoding: "utf8", timeout: 180_000, maxBuffer: 16 * 1024 * 1024,
    })
    const output = (result.stdout ?? "") + (result.stderr ?? "")
    writeFileSync(resolve(reports, `${stage}-${label}.log`), output)
    const errors = diagnostics(output)
    if (result.error || result.signal || (result.status !== 0 && errors.length === 0)) {
      throw new Error(`${stage} ${label} type checker did not produce a valid result:\n${output}`)
    }
    return errors
  })

  for (const patch of [...patches].reverse()) {
    execFileSync("git", ["apply", "--reverse", "--check", patch], { cwd: source })
    execFileSync("git", ["apply", "--reverse", patch], { cwd: source })
  }
  let baseline
  try { baseline = run("upstream") }
  finally {
    for (const patch of patches) execFileSync("git", ["apply", patch], { cwd: source })
  }
  const current = run("homebrew")
  const report = packages.map(([label, , prefix], index) => {
    const owned = new Set([...homebrewOwnedFiles].filter((file) => file.startsWith(prefix)).map((file) => file.slice(prefix.length)))
    const added = regressions(baseline[index], current[index], owned)
    const ownedDiagnostics = current[index].filter((item) => owned.has(item.file))
    return { package: label, baselineErrors: baseline[index].length, currentErrors: current[index].length,
      regressions: added, ownedDiagnostics, inherited: current[index].filter((item) => !added.includes(item)) }
  })
  writeFileSync(resolve(reports, "report.json"), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  if (report.some((entry) => entry.regressions.length > 0)) throw new Error("T3 source type-check regressions")
  console.log("No diagnostics in Homebrew-owned modules and no increased diagnostics elsewhere; inherited diagnostics are listed above.")
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [source, reports, ...patches] = process.argv.slice(2)
  if (!source || !reports || patches.length === 0) throw new Error("Usage: check-t3-source-types.mjs source reports patch [patch ...]")
  check(resolve(source), resolve(reports), patches.map((patch) => resolve(patch)))
}

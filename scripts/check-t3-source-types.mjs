import { execFileSync, spawnSync } from "node:child_process"
import { readFileSync, mkdirSync, writeFileSync } from "node:fs"
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

function check(source, patch, reports) {
  mkdirSync(reports, { recursive: true })
  const packages = [
    ["desktop", "@t3tools/desktop", "apps/desktop/"],
    ["server", "t3", "apps/server/"],
    ["shared", "@t3tools/shared", "packages/shared/"],
  ]
  const changed = [...readFileSync(patch, "utf8").matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1])
  const run = (stage) => packages.map(([label, name]) => {
    const result = spawnSync("pnpm", ["exec", "vp", "run", "--filter", name, "typecheck"], {
      cwd: source, encoding: "utf8", timeout: 180_000, maxBuffer: 16 * 1024 * 1024,
    })
    const output = (result.stdout ?? "") + (result.stderr ?? "")
    writeFileSync(resolve(reports, `${stage}-${label}.log`), output)
    const errors = diagnostics(output)
    if (result.error || result.signal || (result.status !== 0 && errors.length === 0)) {
      throw new Error(`${stage} ${label} type checker did not produce a valid result:\n${output}`)
    }
    return errors
  })

  execFileSync("git", ["apply", "--reverse", "--check", patch], { cwd: source })
  execFileSync("git", ["apply", "--reverse", patch], { cwd: source })
  let baseline
  try { baseline = run("updater-only") }
  finally { execFileSync("git", ["apply", patch], { cwd: source }) }
  const current = run("service-attach")
  const report = packages.map(([label, , prefix], index) => {
    const touched = new Set(changed.filter((file) => file.startsWith(prefix)).map((file) => file.slice(prefix.length)))
    const added = regressions(baseline[index], current[index], touched)
    return { package: label, baselineErrors: baseline[index].length, currentErrors: current[index].length,
      regressions: added, inherited: current[index].filter((item) => !added.includes(item)) }
  })
  writeFileSync(resolve(reports, "report.json"), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  if (report.some((entry) => entry.regressions.length > 0)) throw new Error("T3 source type-check regressions")
  console.log("No type-check errors in attachment files and no new errors elsewhere; inherited diagnostics are listed above.")
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [source, patch, reports] = process.argv.slice(2)
  if (!source || !patch || !reports) throw new Error("Usage: check-t3-source-types.mjs source patch reports")
  check(resolve(source), resolve(patch), resolve(reports))
}

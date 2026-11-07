import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const repoRoot = new URL("../../../", import.meta.url)
const formula = readFileSync(new URL("Formula/t3code-cli-main.rb", repoRoot), "utf8")
const cask = readFileSync(new URL("Casks/t3-code-linux.rb", repoRoot), "utf8")
const workflow = readFileSync(new URL(".github/workflows/tap-ci.yml", repoRoot), "utf8")
const daggerPipeline = readFileSync(new URL("dagger/tap-pipeline/src/index.ts", repoRoot), "utf8")

function packageVersion(source: string): string {
  const version = source.match(/^\s+version "([^"]+)"$/m)?.[1]
  assert.ok(version, "package version is declared")
  return version
}

test("T3 CLI and Desktop packages encode the same upstream source commit", () => {
  const cliVersion = packageVersion(formula)
  const desktopVersion = packageVersion(cask)
  const cliCommit = cliVersion.match(/^main\.\d{14}\.([0-9a-f]{12})$/)?.[1]
  const desktopCommit = desktopVersion.match(/^main\.\d{14}\.([0-9a-f]{12})$/)?.[1]

  assert.equal(cliVersion, desktopVersion, "paired packages use the same release version")
  assert.ok(cliCommit, "CLI version includes the pinned upstream short commit")
  assert.equal(desktopCommit, cliCommit, "Desktop version includes the same upstream short commit")
  assert.ok(formula.includes(`/t3code-cli-main-${cliVersion}/`), "formula URL matches its pinned version")
  assert.ok(cask.replaceAll("#{version}", desktopVersion).includes(`/t3-code-linux-${desktopVersion}/`), "cask URL matches its pinned version")
})

test("paired T3 acceptance builds both packages from one resolved immutable source", () => {
  const pairedJob = workflow.match(/  t3-paired-acceptance:[\s\S]*?(?=\n  ci:)/)?.[0]
  assert.ok(pairedJob, "paired T3 CI job exists")
  assert.match(pairedJob, /resolve-t-3-source/)
  assert.equal((pairedJob.match(/id: t3_source/g) ?? []).length, 1)
  assert.equal((pairedJob.match(/--t-3-source-ref="\$\{\{ fromJSON\(steps\.t3_source\.outputs\.output\)\.commit \}\}"/g) ?? []).length, 3)
  assert.match(pairedJob, /--package-id="t3code-cli-main"/)
  assert.match(pairedJob, /--package-id="t3-code-linux"/)
  assert.match(pairedJob, /t-3-code-linux-candidate/)
})

test("isolated T3 source checks audit the formula and cask before installing them", () => {
  assert.match(
    daggerPipeline,
    /tapStagingCommands\("t3code-cli-main"\),[\s\S]*?"brew audit --formula test\/tap\/t3code-cli-main",[\s\S]*?"brew install test\/tap\/t3code-cli-main"/,
  )
  assert.match(
    daggerPipeline,
    /tapStagingCommands\("t3-code-linux"\),[\s\S]*?"brew audit --cask test\/tap\/t3-code-linux",[\s\S]*?"brew install --cask test\/tap\/t3-code-linux"/,
  )
})

test("T3 smoke installs use generated tap files without changing other package lanes", () => {
  assert.match(
    daggerPipeline,
    /case "t3code-cli-main": \{[\s\S]*?\.withDirectory\("\/tap", tap\)\s*\.withDirectory\("\/built-tap", smokeTap\)[\s\S]*?"brew audit --formula test\/tap\/t3code-cli-main",[\s\S]*?cp \/built-tap\/Formula\/t3code-cli-main\.rb[\s\S]*?"brew install test\/tap\/t3code-cli-main"/,
  )
  assert.match(
    daggerPipeline,
    /case "t3-code-linux": \{[\s\S]*?\.withDirectory\("\/tap", tap\)\s*\.withDirectory\("\/built-tap", smokeTap\)[\s\S]*?"brew audit --cask test\/tap\/t3-code-linux",[\s\S]*?cp \/built-tap\/Casks\/t3-code-linux\.rb[\s\S]*?"brew install --cask test\/tap\/t3-code-linux"/,
  )
  assert.match(
    daggerPipeline,
    /case "fizzy-cli-master": \{[\s\S]*?\.withDirectory\("\/tap", smokeTap\)[\s\S]*?"brew install test\/tap\/fizzy-cli-master"/,
  )
})

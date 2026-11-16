import { _electron as electron } from "/runner/node_modules/playwright-core/index.mjs"
import { mkdir, copyFile, chmod, writeFile, readFile, rm } from "node:fs/promises"
import { promisify } from "node:util"
import { execFile } from "node:child_process"
import assert from "node:assert/strict"
import { fixture } from "./fixture.mjs"
import { waitForApplicationRenderer } from "./renderer-readiness.mjs"

const exec = promisify(execFile)
const root = "/tmp/t3-ui-test"
const appDir = root + "/squashfs-root"
const bundle = "/work/" + (process.env.BUNDLE_DIR || "bundle")
await mkdir(root, { recursive: true })
await copyFile(bundle + "/artifacts/candidate.AppImage", root + "/candidate.AppImage")
await chmod(root + "/candidate.AppImage", 0o700)
await exec(root + "/candidate.AppImage", ["--appimage-extract"], { cwd: root, maxBuffer: 32 * 1024 * 1024 })
const builtIdentity = JSON.parse(await readFile(appDir + "/resources/t3-homebrew-build.json", "utf8"))
const provenance = JSON.parse(await readFile(appDir + "/resources/t3-homebrew-upstream.json", "utf8"))
assert.equal(provenance.packageVersion, builtIdentity.packageVersion)
assert.equal(provenance.sourceCommit, builtIdentity.sourceCommit)
const records = new Map(provenance.releases.map(release => [release.tag, release]))
const offered = records.get(provenance.upstream.tag)
assert.ok(offered)
const previous = records.get(offered.previousTag)
assert.ok(previous, "Retained previous nightly is required for skipped-update UI proof")
const installed = records.get(previous.previousTag)
assert.ok(installed, "Retained installed baseline is required for range proof")
const installedIdentity = {
  packageVersion: `${installed.version}.homebrew.1.${installed.commit.slice(0, 12)}`,
  sourceCommit: installed.commit,
}
// Only this extracted, disposable test copy claims the synthetic installed baseline.
await writeFile(appDir + "/resources/t3-homebrew-build.json", JSON.stringify(installedIdentity))
for (const directory of ["home", "config", "state", "runtime", "data"]) {
  await mkdir(root + "/" + directory, { recursive: true, mode: 0o700 })
}
const fake = await fixture(root, appDir)
await rm(root + "/brew-state/active")
const tap = root + "/tap"
await mkdir(tap + "/metadata/t3-nightly", { recursive: true })
await writeFile(tap + "/metadata/t3-nightly/" + builtIdentity.packageVersion + ".json", JSON.stringify(provenance))
const brewPath = fake.bin + "/brew"
let brew = await readFile(brewPath, "utf8")
brew = brew.replaceAll(fake.next, builtIdentity.packageVersion)
brew = brew.replace('case "$1" in', `case "$1" in\n --repo) echo '${tap}' ;;`)
await writeFile(brewPath, brew)
const app = await electron.launch({
  executablePath: appDir + "/AppRun", args: ["--no-sandbox"], timeout: 90_000,
  env: {
    PATH: fake.bin + ":" + process.env.PATH, HOME: root + "/home", DISPLAY: ":99",
    DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS,
    XDG_CURRENT_DESKTOP: "GNOME", XDG_CONFIG_HOME: root + "/config",
    XDG_STATE_HOME: root + "/state", XDG_RUNTIME_DIR: root + "/runtime", XDG_DATA_HOME: root + "/data",
    T3CODE_HOME: root + "/custom-t3-home", T3CODE_TELEMETRY_ENABLED: "false", ELECTRON_DISABLE_GPU: "1",
  },
})
try {
  await writeFile(root + "/desktop.pid", String(app.process().pid))
  const runtime = await app.evaluate(({ app, shell }) => {
    globalThis.t3NightlyNotesExternalUrls = []
    shell.openExternal = async url => { globalThis.t3NightlyNotesExternalUrls.push(url) }
    return { version: app.getVersion(), packaged: app.isPackaged }
  })
  assert.equal(runtime.packaged, true)
  assert.equal(runtime.version, provenance.upstream.version, "Desktop runtime reports the upstream nightly version")
  const { page, observations } = await waitForApplicationRenderer(app)
  await writeFile(root + "/renderer-readiness.json", JSON.stringify(observations, null, 2))
  const close = page.getByRole("button", { name: "Close", exact: true })
  if (await close.isVisible().catch(() => false)) await close.click()
  await page.getByRole("button", { name: "Start without an agent", exact: true }).click({ timeout: 30_000 })
  const checked = await page.evaluate(() => window.desktopBridge.checkForUpdate())
  assert.equal(checked.checked, true)
  const availableState = await page.evaluate(() => window.desktopBridge.getUpdateState())
  assert.equal(availableState.status, "available")
  assert.equal(availableState.availableVersion, builtIdentity.packageVersion)
  assert.deepEqual(availableState.releaseNotes.map(note => note.version), [offered.version, previous.version])
  assert.equal(availableState.homebrewReleaseNotes.message, "")
  const stats = availableState.releaseNotes[0].stats
  assert.ok(stats, "Real upstream generated stats must survive normalization")
  const available = page.getByRole("button", { name: /Homebrew update available for/ })
  await available.hover()
  const popover = page.getByLabel("Update release notes", { exact: true })
  await popover.waitFor({ state: "visible", timeout: 15_000 })
  const statsLink = popover.getByRole("link", { name: stats, exact: true })
  const target = `https://github.com/pingdotgg/t3code/releases/tag/${offered.tag}`
  assert.equal(await statsLink.getAttribute("href"), target)
  await page.screenshot({ path: root + "/nightly-notes-available.png" })
  const commandsBeforeClick = await readFile(root + "/commands.log", "utf8")
  await statsLink.click()
  assert.deepEqual(await app.evaluate(() => globalThis.t3NightlyNotesExternalUrls), [target])
  assert.equal(await readFile(root + "/commands.log", "utf8"), commandsBeforeClick)
  assert.equal((await page.evaluate(() => window.desktopBridge.getUpdateState())).status, "available")
  assert.doesNotMatch(commandsBeforeClick, /(?:^|\n)(?:fetch|upgrade|uninstall|link) /)
  // Prepare through the actual bridge; installation is deliberately never invoked.
  const prepared = await page.evaluate(() => window.desktopBridge.downloadUpdate())
  assert.equal(prepared.completed, true)
  const downloadedState = await page.evaluate(() => window.desktopBridge.getUpdateState())
  assert.equal(downloadedState.status, "downloaded")
  assert.deepEqual(downloadedState.releaseNotes, availableState.releaseNotes)
  await page.mouse.move(0, 0)
  await page.getByRole("button", { name: /Homebrew packages.*are prepared/ }).hover()
  await popover.getByText("Update ready to install", { exact: true }).waitFor({ state: "visible", timeout: 15_000 })
  await page.screenshot({ path: root + "/nightly-notes-downloaded.png" })
  const commands = await readFile(root + "/commands.log", "utf8")
  assert.doesNotMatch(commands, /(?:^|\n)(?:upgrade|uninstall|link) /)
  await writeFile(root + "/renderer-state.json", JSON.stringify({ available: availableState, downloaded: downloadedState }, null, 2))
  await writeFile(root + "/report.json", JSON.stringify({
    scenario: "nightly-notes", sourceCommit: builtIdentity.sourceCommit, builtIdentity, syntheticInstalledIdentity: installedIdentity,
    upstreamTag: offered.tag, includedVersions: availableState.releaseNotes.map(note => note.version),
    stats, statsTarget: target, clickedExternalUrls: [target], clickDidNotPrepareOrInstall: true,
    availableAndDownloadedNotesMatch: true, installed: false, network: "none", homebrew: "fake", systemd: "fake", runtime,
  }, null, 2))
} catch (error) {
  await writeFile(root + "/failure.txt", String(error.stack ?? error))
  for (const page of app.windows()) await page.screenshot({ path: root + "/error-screen.png" }).catch(() => {})
  throw error
} finally {
  await Promise.race([app.close().catch(() => {}), new Promise(resolve => setTimeout(resolve, 2000))])
}
process.exit(0)

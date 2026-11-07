import { _electron as electron } from "/runner/node_modules/playwright-core/index.mjs"
import { mkdir, copyFile, chmod, writeFile, readFile, stat } from "node:fs/promises"
import { watch } from "node:fs"
import { createHash } from "node:crypto"
import { promisify } from "node:util"
import { execFile, spawn } from "node:child_process"
import assert from "node:assert/strict"

const exec = promisify(execFile)
const root = "/tmp/t3-ui-test"
const scenario = process.env.CASE
const bundle = "/work/" + (process.env.BUNDLE_DIR || "bundle")
const artifact = bundle + "/artifacts/candidate.AppImage"
const home = root + "/home"
const t3Home = home + "/.t3"
const stateDir = t3Home + "/userdata"
const appDir = root + "/squashfs-root"
const appRun = appDir + "/AppRun"
const serverEntry = appDir + "/resources/app.asar/apps/server/dist/bin.mjs"
const runtimeStatePath = stateDir + "/server-runtime.json"
const environmentIdPath = stateDir + "/environment-id"
const markerPaths = [
  stateDir + "/e2e-history-preserved.marker",
  stateDir + "/e2e-credential-preserved.marker",
]
const environment = {
  PATH: "/tmp/t3-ui-test/fakebin:" + process.env.PATH,
  HOME: home,
  DISPLAY: ":99",
  XDG_CONFIG_HOME: root + "/config",
  XDG_STATE_HOME: root + "/state",
  XDG_RUNTIME_DIR: root + "/runtime",
  XDG_DATA_HOME: root + "/data",
  T3_UI_ROOT: root,
  T3CODE_TELEMETRY_ENABLED: "false",
  ELECTRON_DISABLE_GPU: "1",
}

await mkdir(root, { recursive: true })
await copyFile(artifact, root + "/candidate.AppImage")
await chmod(root + "/candidate.AppImage", 0o700)
await exec(root + "/candidate.AppImage", ["--appimage-extract"], {
  cwd: root,
  maxBuffer: 32 * 1024 * 1024,
})
for (const path of [home, stateDir, root + "/fakebin", root + "/config", root + "/state", root + "/runtime", root + "/data"]) {
  await mkdir(path, { recursive: true, mode: 0o700 })
}
for (const marker of markerPaths) await writeFile(marker, marker.includes("history") ? "history-marker-v1" : "credential-marker-v1")

const unitPath = "/tmp/t3-ui-test/homebrew/opt/t3code-cli-main/bin/t3"
await mkdir(unitPath.slice(0, unitPath.lastIndexOf("/")), { recursive: true })
await writeFile(unitPath, "#!/bin/sh\nexit 0\n", { mode: 0o700 })
const unitExecStart = scenario === "unknown-owner"
  ? "/usr/bin/other-t3-server"
  : unitPath
const systemctl = `#!/bin/sh
set -eu
if [ "$1" = "--user" ]; then shift; fi
if [ "$1" != "show" ]; then exit 2; fi
unit="$2"
if [ "$unit" != "t3code-homebrew.service" ]; then exit 1; fi
pid=$(cat "$T3_UI_ROOT/service.pid")
printf 'ActiveState=active\\n'
printf 'MainPID=%s\\n' "$pid"
printf 'ExecStart={ path=%s ; argv[]=%s serve ; ignore_errors=no ; }\\n' '${unitExecStart}' '${unitExecStart}'
printf 'Environment=T3CODE_HOME=%s T3CODE_TELEMETRY_ENABLED=false\\n' "$T3_UI_ROOT/home/.t3"
`
await writeFile(root + "/fakebin/systemctl", systemctl, { mode: 0o700 })

let server = null
let app = null
let environmentId = null
let serverRuntimePid = null
let serverOrigin = null
let lockIdentity = null
let markerHashes = null
let serverStderr = ""

const waitForServerReady = () => new Promise((resolve, reject) => {
  let checking = false
  const watcher = watch(stateDir, { persistent: false }, () => {
    void check()
  })
  const deadline = setTimeout(() => finish(new Error("Timed out waiting for isolated T3 service readiness")), 60_000)
  const finish = (error, value) => {
    clearTimeout(deadline)
    watcher.close()
    if (error) reject(error)
    else resolve(value)
  }
  const check = async () => {
    if (checking) return
    checking = true
    try {
      const runtime = JSON.parse(await readFile(runtimeStatePath, "utf8"))
      const response = await fetch(new URL("/.well-known/t3/environment", runtime.origin))
      if (!response.ok) return
      const descriptor = await response.json()
      const id = (await readFile(environmentIdPath, "utf8")).trim()
      if (!id || descriptor.environmentId !== id || !Number.isSafeInteger(runtime.pid)) {
        return finish(new Error("The fixture service identity did not match its runtime files"))
      }
      serverRuntimePid = runtime.pid
      await writeFile(root + "/service.pid", String(serverRuntimePid))
      environmentId = id
      serverOrigin = runtime.origin
      lockIdentity = await stat(stateDir + "/server-owner.sqlite")
      markerHashes = await Promise.all(markerPaths.map(async (path) =>
        createHash("sha256").update(await readFile(path)).digest("hex"),
      ))
      finish(null, descriptor)
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.cause?.code !== "ECONNREFUSED") {
        if (error instanceof TypeError && /fetch failed/.test(error.message)) return
        finish(error)
      }
    } finally {
      checking = false
    }
  }
  void check()
})

const startService = async () => {
  const serviceEnvironment = {
    ...environment,
    ELECTRON_RUN_AS_NODE: "1",
    T3CODE_HOME: t3Home,
    T3CODE_HOST: "127.0.0.1",
    T3CODE_PORT: "3773",
  }
  server = spawn(appRun, [serverEntry, "serve", "--base-dir", t3Home, "--host", "127.0.0.1", "--port", "3773"], {
    cwd: home,
    env: serviceEnvironment,
    detached: true,
    stdio: ["ignore", "ignore", "pipe"],
  })
  assert.ok(server.pid, "isolated T3 server process started")
  server.stderr.setEncoding("utf8")
  server.stderr.on("data", (chunk) => {
    serverStderr = (serverStderr + chunk).slice(-8000)
  })
  return waitForServerReady()
}

const checkPreserved = async () => {
  const currentLock = await stat(stateDir + "/server-owner.sqlite")
  assert.equal(currentLock.dev, lockIdentity.dev)
  assert.equal(currentLock.ino, lockIdentity.ino)
  const hashes = await Promise.all(markerPaths.map(async (path) =>
    createHash("sha256").update(await readFile(path)).digest("hex"),
  ))
  assert.deepEqual(hashes, markerHashes)
  const runtime = JSON.parse(await readFile(runtimeStatePath, "utf8"))
  assert.equal(runtime.pid, serverRuntimePid)
  assert.equal((await readFile(environmentIdPath, "utf8")).trim(), environmentId)
  assert.equal(await readFile(root + "/service.pid", "utf8"), String(server.pid))
}

const launchDesktop = () => electron.launch({
  executablePath: appRun,
  args: ["--no-sandbox"],
  env: environment,
  timeout: 90_000,
})

const waitForWebSocket = async (page) => {
  const socketPromise = page.waitForEvent("websocket", {
    predicate: (socket) => {
      const url = new URL(socket.url())
      return url.hostname === new URL(serverOrigin).hostname && url.port === new URL(serverOrigin).port
    },
    timeout: 30_000,
  })
  await page.reload()
  const socket = await socketPromise
  await socket.waitForEvent("framereceived", { timeout: 30_000 })
  return socket.url()
}

const clickNativeDialog = async (title) => {
  const result = await exec("xdotool", ["search", "--sync", "--onlyvisible", "--name", title], {
    timeout: 60_000,
    maxBuffer: 4096,
  })
  const windowId = result.stdout.trim().split(/\s+/u).at(-1)
  assert.ok(windowId, `native dialog did not appear: ${title}`)
  await exec("xdotool", ["windowfocus", windowId], { timeout: 5000 })
  await exec("xdotool", ["key", "--window", windowId, "Return"], { timeout: 5000 })
}

const connectAndVerify = async () => {
  app = await launchDesktop()
  await clickNativeDialog("Homebrew T3 service is already running")
  const page = await app.firstWindow({ timeout: 90_000 })
  await page.waitForLoadState("domcontentloaded")
  await page.getByText(new RegExp(new URL(serverOrigin).origin.replaceAll(".", "\\."))).waitFor({ timeout: 30_000 })
  await page.screenshot({ path: root + "/pairing-confirmation.png" })
  await page.getByRole("button", { name: "Confirm", exact: true }).click()
  await page.getByText("Backend added", { exact: true }).waitFor({ timeout: 30_000 })
  const connected = await page.evaluate(() => window.desktopBridge.getLocalEnvironmentEnabled())
  assert.equal(connected, false)
  const settings = JSON.parse(await readFile(stateDir + "/desktop-settings.json", "utf8"))
  assert.equal(settings.localEnvironmentEnabled, false)

  const registry = JSON.parse(await readFile(stateDir + "/saved-environments.json", "utf8"))
  const saved = registry.records?.find((record) => record.environmentId === environmentId)
  assert.ok(saved, "the paired environment ID is persisted")
  assert.equal(new URL(saved.httpBaseUrl).origin, new URL(serverOrigin).origin)
  await page.screenshot({ path: root + "/connected.png" })
  const firstSocket = await waitForWebSocket(page)
  await checkPreserved()
  const firstReport = { environmentId, serverOrigin, websocketUrl: firstSocket }
  await app.close()
  app = null
  await checkPreserved()

  app = await launchDesktop()
  const repeatPage = await app.firstWindow({ timeout: 90_000 })
  await repeatPage.waitForLoadState("domcontentloaded")
  const repeatSocket = await waitForWebSocket(repeatPage)
  await repeatPage.screenshot({ path: root + "/repeat-run.png" })
  await checkPreserved()
  assert.equal(new URL(repeatSocket).origin, new URL(firstSocket).origin)
  await app.close()
  app = null
  return { ...firstReport, repeatWebsocketUrl: repeatSocket }
}

const verifyUnknownOwner = async () => {
  app = await launchDesktop()
  await clickNativeDialog("T3 home owner could not be verified")
  const firstWindow = await app.firstWindow({ timeout: 5000 }).catch(() => null)
  if (firstWindow) await firstWindow.close().catch(() => {})
  await app.close().catch(() => {})
  app = null
  await checkPreserved()
  assert.equal(await readFile(stateDir + "/desktop-settings.json").then(() => true, () => false), false)
  assert.equal(await readFile(stateDir + "/saved-environments.json").then(() => true, () => false), false)
  return { owner: "unverified", attached: false, settingsChanged: false }
}

try {
  await startService()
  const runtime = JSON.parse(await readFile(runtimeStatePath, "utf8"))
  const descriptor = await fetch(new URL("/.well-known/t3/environment", runtime.origin)).then((response) => response.json())
  assert.equal(descriptor.environmentId, environmentId)
  const result = scenario === "unknown-owner" ? await verifyUnknownOwner() : await connectAndVerify()
  await writeFile(root + "/report.json", JSON.stringify({
    scenario,
    packageVersion: JSON.parse(await readFile(appDir + "/resources/t3-homebrew-build.json", "utf8")).packageVersion,
    sourceCommit: JSON.parse(await readFile(appDir + "/resources/t3-homebrew-build.json", "utf8")).sourceCommit,
    serviceEnvironmentId: environmentId,
    serviceProcessPreserved: true,
    stateAndMarkersPreserved: true,
    isolatedHome: true,
    network: "none",
    systemd: "fake user-unit metadata",
    result,
  }, null, 2))
} catch (error) {
  await writeFile(root + "/failure.txt", `${error?.stack ?? error}\n${serverStderr}`)
  throw error
} finally {
  if (app) await app.close().catch(() => {})
  if (server && server.exitCode === null) {
    try {
      process.kill(-server.pid, "SIGTERM")
    } catch {}
    const exited = await Promise.race([
      new Promise((resolve) => server.once("exit", () => resolve(true))),
      new Promise((resolve) => setTimeout(() => resolve(false), 5000)),
    ])
    if (!exited) {
      try {
        process.kill(-server.pid, "SIGKILL")
      } catch {}
      await new Promise((resolve) => server.once("exit", resolve))
    }
  }
  if (serverRuntimePid !== null) {
    await assert.rejects(exec("kill", ["-0", String(serverRuntimePid)]))
  }
}

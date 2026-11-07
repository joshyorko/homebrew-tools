import { _electron as electron } from "/runner/node_modules/playwright-core/index.mjs"
import { mkdir, copyFile, chmod, writeFile, readFile, stat, readdir } from "node:fs/promises"
import { watch } from "node:fs"
import { createHash } from "node:crypto"
import { promisify } from "node:util"
import { execFile, spawn } from "node:child_process"
import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"

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
const electronBinary = appDir + "/t3code"
const bundledServerEntry = appDir + "/resources/app.asar/apps/server/dist/bin.mjs"
let serverEntry = bundledServerEntry
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
  DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS,
  XDG_CURRENT_DESKTOP: "GNOME",
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
const originalDesktopSettings = JSON.stringify({ localEnvironmentEnabled: true, linuxPasswordStore: "gnome-libsecret", updateChannel: "latest", updateChannelConfiguredByUser: true }) + "\n"
await writeFile(stateDir + "/desktop-settings.json", originalDesktopSettings)
const settingsBeforeLocalOff = new Set([originalDesktopSettings])
const settingsObserver = watch(stateDir, { persistent: false }, (_event, name) => {
  if (name !== "desktop-settings.json") return
  void readFile(stateDir + "/desktop-settings.json", "utf8").then((raw) => {
    if (JSON.parse(raw).localEnvironmentEnabled !== false) settingsBeforeLocalOff.add(raw)
  }).catch(() => {})
})
for (const marker of markerPaths) await writeFile(marker, marker.includes("history") ? "history-marker-v1" : "credential-marker-v1")

const buildIdentity = JSON.parse(await readFile(appDir + "/resources/t3-homebrew-build.json", "utf8"))
const runningPackageVersion = scenario === "package-mismatch" ? "main.20000101000000.aaaaaaaaaaaa" : buildIdentity.packageVersion
const activeKeg = root + "/homebrew/Cellar/t3code-cli-main/" + runningPackageVersion
serverEntry = activeKeg + "/libexec/dist/bin.mjs"
await mkdir(activeKeg + "/libexec/dist", { recursive: true })
await writeFile(serverEntry, `import { readdirSync } from "node:fs";
import { join } from "node:path";
const directory = ${JSON.stringify(appDir + "/resources/app.asar/apps/server/dist")};
const main = readdirSync(directory).find((name) => /^binMain-.*\\.mjs$/.test(name));
if (!main) throw new Error("Packaged CLI entry module is missing");
const { runCliCommand } = await import(join(directory, main));
await runCliCommand();
`)
await writeFile(activeKeg + "/INSTALL_RECEIPT.json", JSON.stringify({ source: { tap: "joshyorko/tools", version: runningPackageVersion } }))

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
let preservedState = null

const waitForServerReady = () => new Promise((resolve, reject) => {
  let checking = false
  let settled = false
  const onExit = (code, signal) => finish(new Error(`Isolated T3 service exited before readiness (${code ?? signal})`))
  server.once("close", onExit)
  const watcher = watch(stateDir, { persistent: false }, () => {
    void check()
  })
  const deadline = setTimeout(() => finish(new Error("Timed out waiting for isolated T3 service readiness")), 60_000)
  const finish = (error, value) => {
    if (settled) return
    settled = true
    server.removeListener("close", onExit)
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
  server = spawn(electronBinary, [serverEntry, "serve", "--base-dir", t3Home, "--host", "127.0.0.1", "--port", "3773"], {
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

const runPackagedCli = async (args) => {
  const result = await exec(electronBinary, [serverEntry, ...args, "--base-dir", t3Home], {
    cwd: home,
    env: { ...environment, ELECTRON_RUN_AS_NODE: "1", T3CODE_HOME: t3Home },
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  })
  return result.stdout
}

const seedServiceState = async () => {
  const workspace = root + "/existing-project"
  await mkdir(workspace)
  await runPackagedCli(["project", "add", workspace, "--title", "Preserved project"])
  const issued = JSON.parse(await runPackagedCli(["auth", "session", "issue", "--json", "--subject", "mcp-client", "--label", "Existing fixture credential"]))
  assert.ok(issued.token)
  let sessionId = null
  let sequence = 0
  const request = async (method, params, notification = false) => {
    const response = await fetch(new URL("/mcp", serverOrigin), {
      method: "POST",
      headers: {
        "content-type": "application/json", accept: "application/json, text/event-stream",
        authorization: "Bearer " + issued.token,
        "mcp-protocol-version": "2025-06-18",
        connection: "close",
        ...(sessionId === null ? {} : { "mcp-session-id": sessionId }),
      },
      body: JSON.stringify({ jsonrpc: "2.0", ...(notification ? {} : { id: ++sequence }), method, params }),
      signal: AbortSignal.timeout(20_000),
    })
    assert.ok(response.ok, `isolated MCP ${method} returned ${response.status}`)
    sessionId = response.headers.get("mcp-session-id") ?? sessionId
    const raw = await response.text()
    if (notification) return null
    const message = response.headers.get("content-type")?.includes("text/event-stream")
      ? raw.split("\n").filter((line) => line.startsWith("data:")).map((line) => JSON.parse(line.slice(5))).find((value) => value.id === sequence)
      : JSON.parse(raw)
    assert.ok(message && !message.error, `isolated MCP ${method} failed`)
    return message.result
  }
  await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "preservation-fixture", version: "1" } })
  await request("notifications/initialized", {}, true)
  const tool = async (name, args) => {
    const result = await request("tools/call", { name, arguments: args })
    if (result?.isError === true) {
      let failure = result.structuredContent
      if (!failure) {
        try { failure = JSON.parse(result.content?.find((part) => part.type === "text")?.text ?? "{}") } catch {}
      }
      throw new Error(`isolated tool ${name} failed: ${failure?.code ?? "unknown"}: ${failure?.message ?? "no diagnostic"}`)
    }
    return result.structuredContent
  }
  const projects = await tool("t3_project_list", {})
  const project = projects.projects.find((value) => value.workspaceRoot === workspace)
  assert.ok(project)
  const thread = await tool("t3_thread_launch", { projectId: project.id, title: "Existing preserved thread", runtimeMode: "approval-required", modelSelection: { provider: "codex", model: "gpt-6-luna" } })
  assert.ok(thread.threadId)
  assert.equal(thread.runId, null, "fixture must not run an agent")
  // Seed durable conversation history in the real projection store without invoking a provider.
  const timestamp = new Date().toISOString()
  const historyMessage = {
    id: "message:preserved-history", threadId: thread.threadId, runId: null, nodeId: null,
    role: "assistant", text: "Historical fixture reply preserved across service attachment.",
    createdBy: "agent", creationSource: "provider", attachments: [], streaming: false,
    createdAt: timestamp, updatedAt: timestamp,
  }
  const database = new DatabaseSync(stateDir + "/statev2.sqlite")
  try {
    database.exec("PRAGMA busy_timeout=5000")
    database.prepare(`INSERT INTO orchestration_v2_projection_messages
      (message_id, thread_id, run_id, node_id, role, streaming, created_at, updated_at, payload_json)
      VALUES (?, ?, NULL, NULL, 'assistant', 0, ?, ?, ?)`)
      .run(historyMessage.id, thread.threadId, timestamp, timestamp, JSON.stringify(historyMessage))
    const historyItem = {
      id: "item:preserved-history", threadId: thread.threadId, runId: null, nodeId: null,
      providerThreadId: null, providerTurnId: null, nativeItemRef: null, parentItemId: null,
      ordinal: 0, type: "assistant_message", status: "completed", title: null,
      startedAt: timestamp, completedAt: timestamp, updatedAt: timestamp,
      messageId: historyMessage.id, text: historyMessage.text, streaming: false,
    }
    database.prepare(`INSERT INTO orchestration_v2_projection_turn_items
      (turn_item_id, thread_id, run_id, node_id, provider_thread_id, provider_turn_id,
       parent_item_id, ordinal, type, status, updated_at, payload_json)
      VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, 0, 'assistant_message', 'completed', ?, ?)`)
      .run(historyItem.id, thread.threadId, timestamp, JSON.stringify(historyItem))
  } finally { database.close() }
  const verify = async () => {
    const savedProject = await tool("t3_project_read", { projectId: project.id })
    assert.equal(savedProject.title, "Preserved project")
    const savedThread = await tool("t3_thread_read", { threadId: thread.threadId, limit: 5 })
    assert.equal(savedThread.thread.title, "Existing preserved thread")
    assert.equal(savedThread.recentRuns.length, 0)
    assert.equal(JSON.stringify(savedThread).includes(historyMessage.text), true, "real API returns the preserved conversation history")
    return true
  }
  await verify()
  return { verify, projectId: project.id, threadId: thread.threadId, sessionId: issued.sessionId }
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
  assert.equal(await readFile(root + "/service.pid", "utf8"), String(serverRuntimePid))
  assert.equal(await preservedState.verify(), true, "existing thread/project and original bearer credential remain usable")
}

const launchDesktop = async () => {
  const instance = await electron.launch({
  executablePath: appRun,
  args: ["--no-sandbox"],
  env: environment,
  timeout: 90_000,
  })
  if (scenario !== "unknown-owner") {
    const secureStorage = await instance.evaluate(({ safeStorage }) => ({
      available: safeStorage.isEncryptionAvailable(), backend: safeStorage.getSelectedStorageBackend(),
    }))
    console.log("SECURE_STORAGE", JSON.stringify(secureStorage))
    assert.equal(secureStorage.available, true, "Desktop secure storage must be available")
    assert.notEqual(secureStorage.backend, "basic_text", "fixture requires a protected storage backend")
  }
  const clean = (value) => String(value).replace(/(?:t3code|https?):\/\/[^\s]+/g, "<url>").replace(/Bearer\s+\S+/gi, "Bearer <redacted>")
  const observe = (page) => {
    page.on("pageerror", (error) => console.log("RENDERER_ERROR", clean(error.message).slice(0, 500)))
    page.on("console", (message) => { if (message.type() === "error") console.log("RENDERER_CONSOLE", clean(message.text()).slice(0, 500)) })
  }
  instance.windows().forEach(observe)
  instance.on("window", observe)
  return instance
}

const captureRendererState = async (page) => {
  let deadline
  try {
    const state = await Promise.race([
      page.evaluate(() => ({
        protocol: location.protocol, host: location.host, pathname: location.pathname,
        bridge: !!window.desktopBridge, localEnvironmentEnabled: window.desktopBridge?.getLocalEnvironmentEnabled(),
        ready: document.readyState, rootChildren: document.getElementById("root")?.childElementCount,
        online: navigator.onLine,
      })),
      new Promise((resolve) => { deadline = setTimeout(() => resolve({ unavailable: true }), 5000) }),
    ])
    console.log("RENDERER_STATE", JSON.stringify(state))
    await writeFile(root + "/renderer-state.json", JSON.stringify(state, null, 2))
  } finally { clearTimeout(deadline) }
}

const waitForWebSocket = async (page, { reload = true } = {}) => {
  const socketPromise = page.waitForEvent("websocket", {
    predicate: (socket) => {
      const url = new URL(socket.url())
      return url.hostname === new URL(serverOrigin).hostname && url.port === new URL(serverOrigin).port
    },
    timeout: 30_000,
  })
  if (reload) await page.reload()
  assert.equal(await page.evaluate(() => navigator.onLine), true, "the isolated interface must allow the saved-connection supervisor to run")
  const socket = await socketPromise
  await socket.waitForEvent("framereceived", { timeout: 30_000 })
  const url = new URL(socket.url())
  return url.origin + url.pathname
}

const clickNativeDialog = async (title, buttonIndex = 0) => {
  const result = await exec("xdotool", ["search", "--sync", "--onlyvisible", "--name", title], {
    timeout: 60_000,
    maxBuffer: 4096,
  })
  const windowId = result.stdout.trim().split(/\s+/u).at(-1)
  assert.ok(windowId, `native dialog did not appear: ${title}`)
  if (title === "Homebrew T3 service is already running") {
    await exec("scrot", ["-o", root + "/owner-dialog.png"], { timeout: 5000 })
  }
  await exec("xdotool", ["windowfocus", windowId], { timeout: 5000 })
  if (title === "Homebrew T3 service is already running") {
    const geometry = await exec("xdotool", ["getwindowgeometry", "--shell", windowId], { timeout: 5000 })
    const width = Number(geometry.stdout.match(/^WIDTH=(\d+)$/m)?.[1])
    const height = Number(geometry.stdout.match(/^HEIGHT=(\d+)$/m)?.[1])
    console.log("NATIVE_GEOMETRY", JSON.stringify({ windowId, width, height, buttonIndex }))
    assert.ok(width > 0 && height > 20)
    await exec("xdotool", ["mousemove", "--window", windowId, String(Math.floor(width * (buttonIndex + 0.5) / 3)), String(height - 18)], { timeout: 5000 })
    await exec("xdotool", ["click", "1"], { timeout: 5000 })
    let closed = false
    for (let check = 0; check < 20; check++) {
      const visible = await exec("xdotool", ["search", "--onlyvisible", "--name", title], { timeout: 1000 }).then((value) => value.stdout.trim().split(/\s+/u), () => [])
      if (!visible.includes(windowId)) { closed = true; break }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    if (!closed) {
      await exec("scrot", ["-o", root + "/owner-dialog-after-click.png"], { timeout: 5000 })
      throw new Error("Native recovery dialog remained visible after the selected input")
    }
  } else {
    await exec("xdotool", ["key", "--window", windowId, "Return"], { timeout: 5000 })
  }
}

const savedPublicProfile = (page) => page.evaluate(async (expectedId) => {
  const raw = await window.desktopBridge.getConnectionCatalog()
  const catalog = raw === null ? null : JSON.parse(raw)
  const profile = catalog?.profiles?.find((value) => value.environmentId === expectedId && typeof value.httpBaseUrl === "string")
  return profile ? { environmentId: profile.environmentId, httpBaseUrl: profile.httpBaseUrl } : null
}, environmentId)

const connectAndVerify = async () => {
  app = await launchDesktop()
  console.log("DESKTOP_LAUNCHED")
  await clickNativeDialog("Homebrew T3 service is already running")
  console.log("SERVICE_RECOVERY_CONFIRMED")
  const page = await app.firstWindow({ timeout: 90_000 })
  await page.waitForLoadState("domcontentloaded")
  await writeFile(root + "/window-state.json", JSON.stringify(app.windows().map((window) => {
    const value = new URL(window.url())
    return { protocol: value.protocol, host: value.host, pathname: value.protocol === "data:" ? "<data>" : value.pathname }
  }), null, 2))
  await captureRendererState(page)
  const confirmation = page.getByText(new RegExp(new URL(serverOrigin).origin.replaceAll(".", "\\."))).waitFor({ timeout: 30_000 }).then(() => "confirmation")
  const rejected = exec("xdotool", ["search", "--sync", "--onlyvisible", "--name", "^(Could not create a pairing link|Error)$"], { timeout: 30_000, maxBuffer: 4096 }).then(() => "rejected", () => "not-found")
  const outcome = await Promise.race([confirmation, rejected])
  if (outcome === "rejected") {
    await exec("scrot", ["-o", root + "/error-screen.png"], { timeout: 5000 })
    await clickNativeDialog("^(Could not create a pairing link|Error)$")
    await captureRendererState(page)
    await page.screenshot({ path: root + "/initial.png", timeout: 10_000 })
    throw new Error("Automatic pairing failed before renderer delivery")
  }
  assert.equal(outcome, "confirmation")
  await page.screenshot({ path: root + "/pairing-confirmation.png" })
  const pendingLinks = JSON.parse(await runPackagedCli(["auth", "pairing", "list", "--json"]))
  console.log("PAIRING_LINK_STATE", JSON.stringify({ count: pendingLinks.length, unexpired: pendingLinks.every((link) => Date.parse(link.expiresAt) > Date.now()) }))
  const added = page.getByText("Backend added", { exact: true }).waitFor({ timeout: 30_000 }).then(() => "added")
  const refused = page.getByText("Could not add backend", { exact: true }).waitFor({ timeout: 30_000 }).then(() => "refused")
  const firstConnection = waitForWebSocket(page, { reload: false })
  void firstConnection.catch(() => {})
  await page.getByRole("button", { name: "Confirm", exact: true }).click()
  console.log("PAIRING_CONFIRMED")
  const pairingResult = await Promise.race([added, refused])
  if (pairingResult === "refused") {
    await captureRendererState(page)
    const detail = ["Could not add backend", ...await page.locator('[data-slot="toast-description"]').allTextContents()].join("\n")
    const safeDetail = detail.replace(/(?:https?|t3code):\/\/[^\s]+/g, "<url>").replace(/Bearer\s+\S+/gi, "Bearer <redacted>")
    await writeFile(root + "/pairing-result.txt", safeDetail)
    await exec("scrot", ["-o", root + "/pairing-failure.png"], { timeout: 5000 })
    throw new Error("Pairing refused: " + safeDetail)
  }
  const connected = await page.evaluate(() => window.desktopBridge.getLocalEnvironmentEnabled())
  assert.equal(connected, false)
  const settings = JSON.parse(await readFile(stateDir + "/desktop-settings.json", "utf8"))
  assert.equal(settings.localEnvironmentEnabled, false)
  const backups = (await readdir(stateDir)).filter((name) => name.startsWith("desktop-settings.json.before-homebrew-attach-"))
  assert.equal(backups.length, 1)
  assert.equal(settingsBeforeLocalOff.has(await readFile(stateDir + "/" + backups[0], "utf8")), true, "backup preserves an exact pre-recovery settings document")
  assert.equal((await stat(stateDir + "/" + backups[0])).mode & 0o777, 0o600)

  const saved = await savedPublicProfile(page)
  assert.ok(saved, "the paired environment ID is persisted in the protected connection catalog")
  assert.equal((await readFile(stateDir + "/connection-catalog.json", "utf8")).includes(environmentId), false, "catalog must not persist plaintext connection data")
  assert.equal(new URL(saved.httpBaseUrl).origin, new URL(serverOrigin).origin)
  const firstSocket = await firstConnection
  await page.getByText("Preserved project", { exact: true }).first().waitFor({ timeout: 30_000 })
  await page.getByText("Existing preserved thread", { exact: true }).first().waitFor({ timeout: 30_000 })
  await page.getByRole("button", { name: /Existing preserved thread/ }).first().click()
  await page.getByText("Historical fixture reply preserved across service attachment.", { exact: true }).waitFor({ timeout: 30_000 })
  await page.screenshot({ path: root + "/connected.png" })
  console.log("FIRST_CONNECTION_PROVED")
  await checkPreserved()
  const firstReport = { environmentId, serverOrigin, websocketUrl: firstSocket }
  await app.close()
  app = null
  await checkPreserved()

  app = await launchDesktop()
  const repeatPage = await app.firstWindow({ timeout: 90_000 })
  await repeatPage.waitForLoadState("domcontentloaded")
  await repeatPage.getByText("Existing preserved thread", { exact: true }).first().waitFor({ timeout: 30_000 })
  await repeatPage.getByRole("button", { name: /Existing preserved thread/ }).first().click()
  await repeatPage.getByText("Historical fixture reply preserved across service attachment.", { exact: true }).waitFor({ timeout: 30_000 })
  const repeatSocket = await waitForWebSocket(repeatPage)
  await repeatPage.getByText("Existing preserved thread", { exact: true }).first().waitFor({ timeout: 30_000 })
  console.log("REPEAT_CONNECTION_PROVED")
  await repeatPage.screenshot({ path: root + "/repeat-run.png" })
  await checkPreserved()
  assert.equal(new URL(repeatSocket).origin, new URL(firstSocket).origin)
  await app.close()
  app = null
  return { ...firstReport, repeatWebsocketUrl: repeatSocket }
}

const verifyManualSettings = async () => {
  app = await launchDesktop()
  await clickNativeDialog("Homebrew T3 service is already running", 1)
  const page = await app.firstWindow({ timeout: 90_000 })
  await page.waitForURL((url) => url.pathname === "/settings/connections", { timeout: 30_000 })
  await page.screenshot({ path: root + "/manual-settings.png" })
  assert.equal(JSON.parse(await readFile(stateDir + "/desktop-settings.json", "utf8")).localEnvironmentEnabled, false)
  assert.equal(await savedPublicProfile(page), null)
  await checkPreserved()
  await app.close()
  app = null
  return { attached: false, manualSettingsOpened: true }
}

const verifyPackageMismatch = async () => {
  app = await launchDesktop()
  console.log("DESKTOP_LAUNCHED")
  await clickNativeDialog("Homebrew T3 service is already running")
  console.log("SERVICE_RECOVERY_CONFIRMED")
  await clickNativeDialog("^(Could not create a pairing link|Error)$")
  const page = await app.firstWindow({ timeout: 90_000 })
  await page.waitForLoadState("domcontentloaded")
  await page.waitForURL((url) => url.pathname === "/settings/connections", { timeout: 30_000 })
  await page.screenshot({ path: root + "/package-mismatch.png" })
  assert.equal(JSON.parse(await readFile(stateDir + "/desktop-settings.json", "utf8")).localEnvironmentEnabled, false)
  assert.equal(await savedPublicProfile(page), null)
  await checkPreserved()
  await app.close()
  app = null
  return { attached: false, differentPackageRefused: true }
}

const verifyUnknownOwner = async () => {
  app = await launchDesktop()
  await clickNativeDialog("^(T3 home owner could not be verified|Error)$")
  const firstWindow = await app.firstWindow({ timeout: 5000 }).catch(() => null)
  if (firstWindow) await firstWindow.close().catch(() => {})
  await app.close().catch(() => {})
  app = null
  await checkPreserved()
  const retainedSettings = JSON.parse(await readFile(stateDir + "/desktop-settings.json", "utf8"))
  assert.notEqual(retainedSettings.localEnvironmentEnabled, false)
  assert.equal(retainedSettings.linuxPasswordStore, "gnome-libsecret")
  assert.equal(retainedSettings.updateChannelConfiguredByUser, true)
  assert.equal((await readdir(stateDir)).some((name) => name.includes(".before-homebrew-attach-")), false)
  assert.equal(await readFile(stateDir + "/saved-environments.json").then(() => true, () => false), false)
  return { owner: "unverified", attached: false, settingsChanged: false }
}

try {
  await startService()
  console.log("SERVICE_READY")
  preservedState = await seedServiceState()
  console.log("EXISTING_STATE_SEEDED")
  const runtime = JSON.parse(await readFile(runtimeStatePath, "utf8"))
  const descriptor = await fetch(new URL("/.well-known/t3/environment", runtime.origin)).then((response) => response.json())
  assert.equal(descriptor.environmentId, environmentId)
  const result = scenario === "unknown-owner" ? await verifyUnknownOwner()
    : scenario === "package-mismatch" ? await verifyPackageMismatch()
    : scenario === "manual-settings" ? await verifyManualSettings() : await connectAndVerify()
  const pidEvents = await readFile("/sys/fs/cgroup/pids.events", "utf8")
  const memoryEvents = await readFile("/sys/fs/cgroup/memory.events", "utf8")
  assert.equal(Number(pidEvents.match(/^max (\d+)$/m)?.[1]), 0, "fixture must not hit the task limit")
  assert.equal(Number(memoryEvents.match(/^oom_kill (\d+)$/m)?.[1]), 0, "fixture must not hit the memory limit")
  await writeFile(root + "/report.json", JSON.stringify({
    scenario,
    packageVersion: JSON.parse(await readFile(appDir + "/resources/t3-homebrew-build.json", "utf8")).packageVersion,
    sourceCommit: JSON.parse(await readFile(appDir + "/resources/t3-homebrew-build.json", "utf8")).sourceCommit,
    serviceEnvironmentId: environmentId,
    serviceProcessPreserved: true,
    existingProjectAndIdleThreadPreserved: true,
    existingConversationHistoryPreserved: true,
    existingBearerCredentialAuthenticated: true,
    syntheticMarkersPreserved: true,
    originalDesktopSettingsBackedUp: scenario !== "unknown-owner",
    isolatedHome: true,
    network: "internal bridge without host gateway, external routing or DNS",
    systemd: "fake user-unit metadata",
    result,
  }, null, 2))
} catch (error) {
  await writeFile(root + "/failure.txt", `${error?.stack ?? error}\n${serverStderr}`)
  throw error
} finally {
  settingsObserver.close()
  await writeFile(root + "/resource-report.json", JSON.stringify({
    pidEvents: await readFile("/sys/fs/cgroup/pids.events", "utf8"),
    memoryEvents: await readFile("/sys/fs/cgroup/memory.events", "utf8"),
    taskLimit: await readFile("/sys/fs/cgroup/pids.max", "utf8"),
  }, null, 2))
  if (app) await app.close().catch(() => {})
  if (server?.pid) {
    const groupAlive = () => {
      try { process.kill(-server.pid, 0); return true } catch (error) {
        if (error.code === "ESRCH") return false
        throw error
      }
    }
    const waitForGroupExit = (deadlineMs) => new Promise((resolve) => {
      const deadline = setTimeout(() => { clearInterval(observer); resolve(!groupAlive()) }, deadlineMs)
      const observer = setInterval(() => {
        if (!groupAlive()) { clearTimeout(deadline); clearInterval(observer); resolve(true) }
      }, 50)
    })
    try { process.kill(-server.pid, "SIGTERM") } catch (error) { if (error.code !== "ESRCH") throw error }
    if (!await waitForGroupExit(5000)) {
      try { process.kill(-server.pid, "SIGKILL") } catch (error) { if (error.code !== "ESRCH") throw error }
      assert.equal(await waitForGroupExit(5000), true, "the entire isolated service process group exited")
    }
  }
}

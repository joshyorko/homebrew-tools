import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { setImmediate } from "node:timers/promises"
import { runInNewContext } from "node:vm"
import test from "node:test"
import { waitForApplicationRenderer } from "./renderer-readiness.mjs"

class Window extends EventEmitter {
  address = ""
  mounted = false
  url() { return this.address }
  async waitForLoadState() {}
  async waitForURL(predicate) {
    if (!this.address || !predicate(new URL(this.address))) await new Promise(resolve => this.once("navigate", resolve))
    assert.equal(predicate(new URL(this.address)), true)
  }
  async waitForFunction(predicate) {
    if (!this.mounted) await new Promise(resolve => this.once("mount", resolve))
    const ready = runInNewContext(`(${predicate})()`, {
      location: new URL(this.address),
      document: { readyState: "complete", getElementById: id => id === "root" ? { childElementCount: 1 } : null },
      window: { desktopBridge: { getConnectionCatalog() {}, getLocalEnvironmentEnabled() {} } },
    })
    assert.equal(ready, true)
  }
  navigate() { this.address = "t3code://app/"; this.emit("navigate") }
  mount() { this.mounted = true; this.emit("mount") }
}
class App extends EventEmitter {
  pages = [new Window()]
  windows() { return this.pages }
  async firstWindow() { return this.pages[0] }
}

test("domcontentloaded on an unloaded window is not application readiness", async () => {
  const app = new App()
  let settled = false
  const result = waitForApplicationRenderer(app).then(value => { settled = true; return value })
  await app.pages[0].waitForLoadState("domcontentloaded")
  await setImmediate()
  assert.equal(settled, false)
  app.pages[0].navigate()
  await setImmediate()
  assert.equal(settled, false, "the application URL still needs the mounted preload-backed renderer")
  app.pages[0].mount()
  assert.equal((await result).page, app.pages[0])
})

test("selects a later application window instead of assuming the first window is the renderer", async () => {
  const app = new App()
  const result = waitForApplicationRenderer(app)
  const renderer = new Window()
  app.pages.push(renderer)
  app.emit("window", renderer)
  renderer.navigate()
  renderer.mount()
  assert.equal((await result).page, renderer)
})

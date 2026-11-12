export async function waitForApplicationRenderer(app, { timeoutMs = 90_000 } = {}) {
  const observations = []
  const seen = new Set()
  let watch
  let deadline
  let finished = false
  const locationOf = page => {
    const url = URL.parse(page.url())
    return url === null ? { protocol: "", host: "", pathname: "<unloaded>" }
      : { protocol: url.protocol, host: url.host, pathname: url.protocol === "data:" ? "<data>" : url.pathname }
  }
  try {
    return await new Promise((resolve, reject) => {
      watch = page => {
        if (seen.has(page)) return
        seen.add(page)
        observations.push({ event: "candidate", ...locationOf(page) })
        void (async () => {
          await page.waitForURL(url => url.protocol === "t3code:" && url.hostname === "app", {
            waitUntil: "domcontentloaded", timeout: timeoutMs,
          })
          await page.waitForFunction(() =>
            location.protocol === "t3code:" && location.hostname === "app" &&
            document.readyState !== "loading" && !document.getElementById("boot-shell") &&
            (document.getElementById("root")?.childElementCount ?? 0) > 0 &&
            typeof window.desktopBridge?.getConnectionCatalog === "function" &&
            typeof window.desktopBridge?.getLocalEnvironmentEnabled === "function",
          undefined, { timeout: timeoutMs })
          if (finished) return
          finished = true
          observations.push({ event: "renderer-ready", ...locationOf(page) })
          resolve({ page, observations })
        })().catch(error => {
          if (!finished) observations.push({ event: "candidate-unavailable", errorName: error.name, ...locationOf(page) })
        })
      }
      app.on("window", watch)
      app.windows().forEach(watch)
      deadline = setTimeout(() => reject(new Error(`Application renderer did not become ready: ${JSON.stringify(observations)}`)), timeoutMs)
    })
  } finally {
    finished = true
    clearTimeout(deadline)
    app.removeListener("window", watch)
  }
}

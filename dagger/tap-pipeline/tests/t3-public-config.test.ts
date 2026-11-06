import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"

import {
  T3_CONNECT_UNAVAILABLE_MARKER,
  T3_PUBLIC_CONNECT_CONFIG,
  T3_PUBLIC_CONNECT_ENV,
  T3_PUBLIC_CONNECT_UPSTREAM_MARKERS,
  t3CliConnectGateChecks,
  t3PublicConnectAsarChecks,
  t3PublicConnectDriftGuardCommand,
  t3PublicConnectEnv,
  validateT3PublicConnectConfig,
} from "../src/install-checks.ts"

function run(command: string, env: NodeJS.ProcessEnv = process.env) {
  return spawnSync("bash", ["-c", command], {
    encoding: "utf8",
    env: { ...env, BASH_ENV: undefined },
    maxBuffer: 1024 * 1024,
    timeout: 5_000,
  })
}

function withScratch<T>(runIn: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), "t3-public-config-"))
  try {
    return runIn(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function writeFixtureUpstream(root: string, envValue: (name: string, value: string) => string = (name, value) => `${name}=${value}`) {
  writeFileSync(
    join(root, ".env.example"),
    [
      "# Audited public T3 Connect identifiers.",
      ...T3_PUBLIC_CONNECT_CONFIG.map(({ name, value }) => envValue(name, value)),
      "",
    ].join("\n"),
  )
  const markersByFile = new Map<string, string[]>()
  for (const [file, marker] of T3_PUBLIC_CONNECT_UPSTREAM_MARKERS) {
    const markers = markersByFile.get(file) ?? []
    markers.push(marker)
    markersByFile.set(file, markers)
  }
  for (const [file, markers] of markersByFile) {
    const path = join(root, file)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${markers.join("\n")}\n`)
  }
}

test("audited public Connect allowlist is complete and shaped", () => {
  const config = validateT3PublicConnectConfig()
  assert.deepEqual(config.map(({ name }) => name), [...T3_PUBLIC_CONNECT_ENV])
  assert.deepEqual(
    t3PublicConnectEnv().map(([name, value]) => `${name}=${value}`),
    T3_PUBLIC_CONNECT_CONFIG.map(({ name, value }) => `${name}=${value}`),
  )
})

test("malformed or incomplete public Connect config fails closed", () => {
  const clone = () => T3_PUBLIC_CONNECT_CONFIG.map((setting) => ({ ...setting }))
  const setValue = (config: ReturnType<typeof clone>, name: string, value: string) => {
    const setting = config.find((candidate) => candidate.name === name)
    assert.ok(setting, name)
    setting.value = value
    return config
  }

  assert.throws(
    () => validateT3PublicConnectConfig(clone().slice(0, 3)),
    /missing required setting T3CODE_RELAY_URL/,
  )
  assert.throws(
    () => validateT3PublicConnectConfig(setValue(clone(), "T3CODE_RELAY_URL", "")),
    /T3CODE_RELAY_URL must be a non-empty trimmed value/,
  )
  assert.throws(
    () => validateT3PublicConnectConfig(setValue(clone(), "T3CODE_CLERK_JWT_TEMPLATE", " t3-relay")),
    /T3CODE_CLERK_JWT_TEMPLATE must be a non-empty trimmed value/,
  )
  assert.throws(
    () =>
      validateT3PublicConnectConfig(
        setValue(clone(), "T3CODE_CLERK_PUBLISHABLE_KEY", "sk_live_secret"),
      ),
    /not a Clerk publishable key/,
  )
  assert.throws(
    () => validateT3PublicConnectConfig(setValue(clone(), "T3CODE_RELAY_URL", "http://relay.t3.codes")),
    /must be a secure HTTPS origin/,
  )
  assert.throws(
    () => validateT3PublicConnectConfig(setValue(clone(), "T3CODE_RELAY_URL", "https://relay.t3.codes/tunnel")),
    /must be a secure HTTPS origin/,
  )
  assert.throws(
    () => validateT3PublicConnectConfig([...clone(), { name: "T3CODE_CLERK_SECRET_KEY", value: "sk_live" }]),
    /unexpected setting T3CODE_CLERK_SECRET_KEY/,
  )
  assert.throws(
    () => validateT3PublicConnectConfig([...clone(), { ...clone()[0]! }]),
    /duplicate setting T3CODE_CLERK_PUBLISHABLE_KEY/,
  )
})

test("drift guard passes on a conforming pinned source and fails on drift", () => {
  withScratch((root) => {
    writeFixtureUpstream(root)
    const guard = t3PublicConnectDriftGuardCommand(root)

    const ok = run(guard)
    assert.equal(ok.status, 0, ok.stderr)

    writeFixtureUpstream(root, (name, value) =>
      name === "T3CODE_RELAY_URL" ? `${name}=https://relay.example.com` : `${name}=${value}`,
    )
    const driftedEnv = run(guard)
    assert.equal(driftedEnv.status, 1)
    assert.match(driftedEnv.stderr, /no longer documents the audited T3CODE_RELAY_URL/)

    writeFixtureUpstream(root)
    writeFileSync(join(root, "apps/server/vite.config.ts"), "// marker removed\n")
    const driftedBuild = run(guard)
    assert.equal(driftedBuild.status, 1)
    assert.match(driftedBuild.stderr, /apps\/server\/vite\.config\.ts no longer consumes public Connect configuration/)
  })
})

test("installed CLI Connect gate check passes only when the command is compiled in", () => {
  withScratch((root) => {
    const bin = join(root, "bin")
    mkdirSync(bin)
    const t3 = join(bin, "t3")
    const checks = t3CliConnectGateChecks(join(root, "home"), join(root, "help.txt")).join("\n")
    assert.match(checks, /-u T3CODE_RELAY_URL/)
    assert.match(checks, /-u T3CODE_CLERK_PUBLISHABLE_KEY/)

    writeFileSync(
      t3,
      "#!/bin/bash\nprintf '%s\\n' \"$0\" >> \"$T3_INVOCATION_LOG\"\nprintf '%s\\n' 'Set up T3 Connect for this machine. Same as `t3 up --connect`.' '' 'COMMANDS' '  login'\n",
    )
    chmodSync(t3, 0o755)
    const invocationLog = join(root, "invocations.txt")
    const enabled = run(checks, {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      T3_INVOCATION_LOG: invocationLog,
    })
    assert.equal(enabled.status, 0, enabled.stderr)
    assert.equal(readFileSync(join(root, "help.txt"), "utf8"), "Set up T3 Connect for this machine. Same as `t3 up --connect`.\n\nCOMMANDS\n  login\n")
    assert.equal(readFileSync(invocationLog, "utf8"), `${t3}\n`)

    writeFileSync(
      t3,
      `#!/bin/bash\nprintf "${T3_CONNECT_UNAVAILABLE_MARKER}.\\n"\n`,
    )
    chmodSync(t3, 0o755)
    const disabled = run(checks, { ...process.env, PATH: `${bin}:${process.env.PATH}` })
    assert.equal(disabled.status, 1)
    assert.match(disabled.stderr, /compiled out of the installed CLI/)
  })
})

test("shipped AppImage check requires the bundled client and every public value", () => {
  withScratch((root) => {
    const asar = join(root, "app.asar")
    const checks = t3PublicConnectAsarChecks().join("\n")
    const body = [
      "apps/server/dist/client/index.html",
      ...T3_PUBLIC_CONNECT_CONFIG.map(({ value }) => value),
      "",
    ].join("\n")
    writeFileSync(asar, body)

    const present = run(`asar=${JSON.stringify(asar)}\n${checks}`)
    assert.equal(present.status, 0, present.stderr)

    writeFileSync(asar, body.replace("https://relay.t3.codes", "https://disabled.invalid"))
    const missing = run(`asar=${JSON.stringify(asar)}\n${checks}`)
    assert.equal(missing.status, 1)
    assert.match(missing.stderr, /missing embedded public T3CODE_RELAY_URL/)
  })
})

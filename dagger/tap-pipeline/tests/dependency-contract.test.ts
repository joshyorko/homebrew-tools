import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const moduleRoot = new URL("..", import.meta.url)

test("Dagger TypeScript runtime stays on the locked v5 SDK contract", () => {
  const manifest = JSON.parse(readFileSync(new URL("package.json", moduleRoot), "utf8"))
  const version = manifest.dependencies.typescript
  const lock = readFileSync(new URL("yarn.lock", moduleRoot), "utf8")

  assert.equal(version.split(".")[0], "5")
  assert.match(lock, new RegExp(`^typescript@${version}:$`, "m"))
})

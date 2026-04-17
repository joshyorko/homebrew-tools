import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"

import { renderGithubApiFetchScript } from "../src/github-api.ts"

function runScript(script: string, url = "https://api.github.com/repos/example/project/releases/latest") {
  return spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script, url],
    { encoding: "utf8" },
  )
}

test("renderGithubApiFetchScript retries retryable failures and eventually succeeds", () => {
  const script = renderGithubApiFetchScript({ baseDelayMs: 0, maxDelayMs: 0 })

  assert.match(script, /const retryableStatuses = new Set\(\[403,429,500,502,503,504\]\)/)
  assert.match(script, /await writeStdout\(await response\.text\(\)\)/)
  assert.match(script, /Retrying in \$\{delayMs\}ms/)
  assert.match(script, /baseDelayMs \* \(2 \*\* \(attempt - 1\)\)/)
})

test("renderGithubApiFetchScript emits detailed diagnostics on terminal failures", () => {
  const script = [
    "const mockHeaders = (values) => ({ get(name) { return values[name.toLowerCase()] ?? null } })",
    "globalThis.fetch = async () => ({",
    "  ok: false,",
    "  status: 403,",
    "  headers: mockHeaders({",
    "    \"x-github-request-id\": \"req-403\",",
    "    \"retry-after\": \"7\",",
    "    \"x-ratelimit-limit\": \"60\",",
    "    \"x-ratelimit-remaining\": \"0\",",
    "    \"x-ratelimit-reset\": \"999999\",",
    "  }),",
    "  text: async () => \"API rate limit exceeded for 203.0.113.10\",",
    "})",
    renderGithubApiFetchScript({ maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 }),
  ].join("\n")

  const result = runScript(script)

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Failed to fetch https:\/\/api.github.com\/repos\/example\/project\/releases\/latest: status=403/)
  assert.match(result.stderr, /request_id=req-403/)
  assert.match(result.stderr, /retry_after=7/)
  assert.match(result.stderr, /ratelimit_remaining=0/)
  assert.match(result.stderr, /API rate limit exceeded/)
})

test("renderGithubApiFetchScript can treat 404 as a non-error sentinel", () => {
  const script = renderGithubApiFetchScript({ successOutput: "true", notFoundOutput: "false", maxAttempts: 1 })

  assert.match(script, /if \(response\.status === 404\)/)
  assert.match(script, /await writeStdout\("false"\)/)
  assert.match(script, /completed = true/)
  assert.match(script, /await writeStdout\("true"\)/)
})

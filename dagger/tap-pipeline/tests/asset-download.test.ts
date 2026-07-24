import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { renderAssetDownloadScript } from "../src/asset-download.ts"

async function runDownloadScript(url: string, destination: string) {
  return await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", renderAssetDownloadScript([0, 0, 0]), url, destination],
    )
    let stderr = ""

    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.on("error", reject)
    child.on("close", (code) => resolve({ code, stderr }))
  })
}

test("asset downloads retry a transient response and write the verified response body", async () => {
  let requests = 0
  const server = createServer((_request, response) => {
    requests += 1
    if (requests === 1) {
      response.writeHead(500).end("temporary failure")
      return
    }

    response.writeHead(200).end("release asset")
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))

  const address = server.address()
  assert.ok(address && typeof address === "object")
  const directory = await mkdtemp(join(tmpdir(), "tap-pipeline-download-"))
  const destination = join(directory, "asset")

  try {
    const result = await runDownloadScript(`http://127.0.0.1:${address.port}/asset`, destination)

    assert.equal(result.code, 0, result.stderr)
    assert.equal(requests, 2)
    assert.equal(await readFile(destination, "utf8"), "release asset")
  } finally {
    server.close()
    await rm(directory, { force: true, recursive: true })
  }
})

test("asset downloads fail immediately for permanent HTTP errors", async () => {
  let requests = 0
  const server = createServer((_request, response) => {
    requests += 1
    response.writeHead(404).end("missing")
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))

  const address = server.address()
  assert.ok(address && typeof address === "object")
  const directory = await mkdtemp(join(tmpdir(), "tap-pipeline-download-"))

  try {
    const result = await runDownloadScript(
      `http://127.0.0.1:${address.port}/missing`,
      join(directory, "asset"),
    )

    assert.equal(result.code, 1)
    assert.equal(requests, 1)
    assert.match(result.stderr, /Failed to download .*: 404 after 1 attempt/)
  } finally {
    server.close()
    await rm(directory, { force: true, recursive: true })
  }
})

test("asset downloads report the final transient response after exhausting retries", async () => {
  let requests = 0
  const server = createServer((_request, response) => {
    requests += 1
    response.writeHead(503).end("still unavailable")
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))

  const address = server.address()
  assert.ok(address && typeof address === "object")
  const directory = await mkdtemp(join(tmpdir(), "tap-pipeline-download-"))

  try {
    const result = await runDownloadScript(
      `http://127.0.0.1:${address.port}/unavailable`,
      join(directory, "asset"),
    )

    assert.equal(result.code, 1)
    assert.equal(requests, 4)
    assert.match(result.stderr, /Failed to download .*: 503 after 4 attempts/)
  } finally {
    server.close()
    await rm(directory, { force: true, recursive: true })
  }
})

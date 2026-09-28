import assert from "node:assert/strict"
import test from "node:test"

import { parseVscodeInsidersUpdate } from "../src/library.ts"

test("VS Code Insiders metadata resolves to a commit-pinned Linux archive and its upstream digest", () => {
  const commitSha = "4a6a3612a562c50f54c2bd5211f0ea42915b974e"
  const archiveSha256 = "556b4dc1b6a94e5496c9317f609aae6c1dc0e5c1ec5785d161fcf378cb36a5e9"
  const update = parseVscodeInsidersUpdate({
    productVersion: "1.140.0-insider",
    version: commitSha,
    sha256hash: archiveSha256,
  })

  assert.deepEqual(update, {
    archiveSha256,
    archiveUrl: `https://update.code.visualstudio.com/commit:${commitSha}/linux-x64/insider`,
    commitSha,
    caskVersion: `1.140.0-insider,${commitSha}`,
    productVersion: "1.140.0-insider",
  })
})

test("VS Code Insiders metadata rejects missing source integrity data", () => {
  assert.throws(
    () => parseVscodeInsidersUpdate({
      productVersion: "1.140.0-insider",
      version: "4a6a3612a562c50f54c2bd5211f0ea42915b974e",
    }),
    /invalid archive SHA256/,
  )
})

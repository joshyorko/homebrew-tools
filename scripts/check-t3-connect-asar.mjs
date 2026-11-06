#!/usr/bin/env node

import { readFileSync } from "node:fs"

function fail(message) {
  throw new Error(`T3 Connect ASAR check: ${message}`)
}

function parseAsar(buffer) {
  if (buffer.length < 8) fail("archive header is truncated")
  const outerPayloadSize = buffer.readUInt32LE(0)
  const headerSize = buffer.readUInt32LE(4)
  if (outerPayloadSize !== 4 || headerSize < 8) fail("invalid archive size pickle")
  const dataStart = 8 + headerSize
  if (dataStart > buffer.length) fail("header extends past the archive")
  const headerPayloadSize = buffer.readUInt32LE(8)
  const jsonSize = buffer.readUInt32LE(12)
  if (headerPayloadSize + 4 !== headerSize || jsonSize > headerPayloadSize - 4) {
    fail("invalid header pickle size fields")
  }

  let header
  try {
    header = JSON.parse(buffer.toString("utf8", 16, 16 + jsonSize))
  } catch {
    fail("header is not valid JSON")
  }
  if (!header || typeof header !== "object" || !header.files || typeof header.files !== "object") {
    fail("header has no file tree")
  }

  const entries = new Map()
  const visit = (files, prefix = "") => {
    if (!files || typeof files !== "object" || Array.isArray(files)) fail("invalid directory entry")
    for (const [name, entry] of Object.entries(files)) {
      if (!name || name.includes("/") || name === "." || name === "..") fail("invalid entry name")
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail(`invalid entry ${name}`)
      const path = prefix ? `${prefix}/${name}` : name
      if (entry.files !== undefined) {
        visit(entry.files, path)
        continue
      }
      if (entry.link !== undefined || entry.unpacked === true) continue
      if (typeof entry.offset !== "string" || !/^\d+$/.test(entry.offset)) fail(`invalid offset for ${path}`)
      if (!Number.isSafeInteger(entry.size) || entry.size < 0) fail(`invalid size for ${path}`)
      const start = dataStart + Number(entry.offset)
      const end = start + entry.size
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end > buffer.length) {
        fail(`entry extends past archive data: ${path}`)
      }
      entries.set(path, buffer.subarray(start, end))
    }
  }
  visit(header.files)
  return entries
}

function checkAsar(asarPath, configJson) {
  if (!asarPath || !configJson) fail("usage: node scripts/check-t3-connect-asar.mjs <app.asar> <settings-json>")
  let settings
  try {
    settings = JSON.parse(configJson)
  } catch {
    fail("settings are not valid JSON")
  }
  if (!Array.isArray(settings) || settings.length !== 4 || settings.some((setting) =>
    !setting || typeof setting.name !== "string" || typeof setting.value !== "string" || !setting.value,
  )) fail("settings must contain the four validated public name/value pairs")
  const entries = parseAsar(readFileSync(asarPath))
  const frontend = [...entries].filter(([path]) =>
    /^apps\/server\/dist\/client\/assets\/.+\.js$/.test(path),
  )
  const server = [...entries].filter(([path]) =>
    /^apps\/server\/dist\/(?!client\/).+\.(?:js|mjs|cjs)$/.test(path),
  )
  if (frontend.length === 0) fail("missing compiled frontend JavaScript entry under apps/server/dist/client/assets")
  if (server.length === 0) fail("missing compiled server JavaScript entry under apps/server/dist")

  const frontendText = Buffer.concat(frontend.map(([, content]) => content)).toString("utf8")
  const serverText = Buffer.concat(server.map(([, content]) => content)).toString("utf8")
  for (const { name, value } of settings) {
    if (!frontendText.includes(value)) fail(`frontend is missing public ${name}`)
  }
  for (const name of ["T3CODE_CLERK_PUBLISHABLE_KEY", "T3CODE_CLERK_CLI_OAUTH_CLIENT_ID", "T3CODE_RELAY_URL"]) {
    const setting = settings.find((candidate) => candidate.name === name)
    if (!setting || !serverText.includes(setting.value)) fail(`server is missing public ${name}`)
  }
}

try {
  checkAsar(process.argv[2], process.argv[3])
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}

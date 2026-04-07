import test from "node:test"
import assert from "node:assert/strict"

import { rewriteCaskUrl } from "../src/cask-render.ts"

test("rewriteCaskUrl updates plain one-line cask URLs", () => {
  const baseContents = [
    "cask \"devpod-linux\" do",
    "  version \"0.18.0\"",
    "  url \"https://example.com/old.deb\"",
    "end",
    "",
  ].join("\n")

  const updated = rewriteCaskUrl(baseContents, "file:///artifacts/DevPod_linux_amd64.deb")

  assert.match(updated, /url "file:\/\/\/artifacts\/DevPod_linux_amd64\.deb"/)
  assert.doesNotMatch(updated, /https:\/\/example\.com\/old\.deb/)
})

test("rewriteCaskUrl removes verified metadata when swapping release URLs", () => {
  const baseContents = [
    "cask \"example\" do",
    "  url \"https://example.com/old.tar.gz\",",
    "      verified: \"example.com/\"",
    "end",
    "",
  ].join("\n")

  const updated = rewriteCaskUrl(baseContents, "https://github.com/org/repo/releases/download/v1.2.3/example.tar.gz")

  assert.match(updated, /url "https:\/\/github\.com\/org\/repo\/releases\/download\/v1\.2\.3\/example\.tar\.gz"/)
  assert.doesNotMatch(updated, /verified:/)
})

test("rewriteCaskUrl rejects casks without a supported url stanza", () => {
  const baseContents = [
    "cask \"example\" do",
    "  version \"1.2.3\"",
    "end",
    "",
  ].join("\n")

  assert.throws(
    () => rewriteCaskUrl(baseContents, "https://example.com/new.tar.gz"),
    /Expected exactly one unverified url stanza, found 0/,
  )
})

test("rewriteCaskUrl rejects ambiguous plain-url casks", () => {
  const baseContents = [
    "cask \"example\" do",
    "  on_macos do",
    "    url \"https://example.com/macos.tar.gz\"",
    "  end",
    "  on_linux do",
    "    url \"https://example.com/linux.tar.gz\"",
    "  end",
    "end",
    "",
  ].join("\n")

  assert.throws(
    () => rewriteCaskUrl(baseContents, "https://example.com/new.tar.gz"),
    /Expected exactly one unverified url stanza, found 2/,
  )
})

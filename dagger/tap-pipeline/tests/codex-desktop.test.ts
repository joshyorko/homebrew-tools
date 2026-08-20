import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const repoRoot = new URL("../../..", import.meta.url)

function read(path: string): string {
  return readFileSync(new URL(path, repoRoot), "utf8")
}

test("Codex Desktop official setup forwards source and immutable conversion selection", () => {
  const setup = read("scripts/setup-codex-desktop-official.sh")
  const pipeline = read("dagger/tap-pipeline/src/index.ts")
  const registry = read("dagger/tap-pipeline/src/library.ts")

  assert.match(setup, /--codex-desktop-conversion-commit="\$conversion_ref"/)
  assert.match(setup, /--codex-desktop-package-source="\$package_source"/)
  assert.match(pipeline, /codexDesktopConversionCommit\(requestedConversionCommit\)/)
  assert.match(pipeline, /codexDesktopPackageSource\(requestedPackageSource\)/)
  assert.match(pipeline, /dag\.git\(CODEX_DESKTOP_CONVERSION_REPO\)\.ref/)
  assert.doesNotMatch(registry, /75e8d4050c66df0d9f3eeaabcef42bc6bff7b0fe/)
})

test("Codex Desktop official builder validates features before compiling", () => {
  const pipeline = read("dagger/tap-pipeline/src/index.ts")

  assert.match(pipeline, /featureConfig\.enabled\.some\(\(feature\) => typeof feature !== "string"\)/)
  assert.match(pipeline, /Enabled Linux feature id not found in this checkout/)
  assert.match(pipeline, /scripts\/lib\/upstream-linux-package\.js/)
  assert.match(pipeline, /--key-base64 assets\/openai-codex-linux-repository-key\.gpg\.base64/)
  assert.match(pipeline, /packageSource === "pinned"/)
  assert.match(pipeline, /package_source: build\.packageSource/)
})

test("Codex Desktop setup is Linux-package-only", () => {
  const setup = read("scripts/setup-codex-desktop-official.sh")
  const wizard = read("scripts/codex-desktop-feature-wizard.py")
  const makefile = read("Makefile")
  const pipeline = read("dagger/tap-pipeline/src/index.ts")

  assert.match(wizard, /Official signed Linux package/)
  assert.doesNotMatch(setup, /Codex\\.dmg|dmg-source|codex-desktop-local/)
  assert.doesNotMatch(makefile, /codex-desktop-legacy|install-codex-desktop-local|Codex\\.dmg/)
  assert.doesNotMatch(pipeline, /codexDesktopLocalBundle|codexDesktopReleaseBundle|Codex\\.dmg|CODEX_DESKTOP_DMG/)
})

test("Codex Desktop official cask remains release-backed", () => {
  const cask = read("Casks/codex-desktop.rb")

  assert.match(cask, /cask "codex-desktop"/)
  assert.match(cask, /releases\/download\/codex-desktop-linux/)
  assert.match(cask, /binary "usr\/bin\/codex-desktop"/)
})

test("official and community streams have distinct identities", () => {
  const official = read("Casks/chatgpt.rb")
  const community = read("Casks/codex-desktop.rb")

  assert.match(official, /cask "chatgpt"/)
  assert.match(official, /name "ChatGPT"/)
  assert.match(official, /homepage "https:\/\/chatgpt\.com\//)
  assert.match(community, /name "ChatGPT Community"/)
  assert.match(community, /homepage "https:\/\/github\.com\/ilysenko\/codex-desktop-linux"/)
  assert.match(community, /official[\s\S]*OpenAI ChatGPT cask/)
})

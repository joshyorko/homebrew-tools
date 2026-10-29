import test from "node:test"
import assert from "node:assert/strict"
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { sourceVersion, renderFormula, wolfiImage, TARGETS } from "./codex-memoryd-update.mjs"

const commit = "8146e6bd4bfe32651183d61f2dd1b12b84ab93cb"
const version = "20261002154624.8146e6bd4bfe"
const formula = readFileSync(new URL("../Formula/codex-memoryd.rb", import.meta.url), "utf8")
const checksums = TARGETS.map((target, index) => `${String(index + 1).repeat(64)}  codex-memoryd-${version}-${target}.tar.gz`).join("\n")

test("publisher uses the consumer's single immutable Wolfi image", () => {
  const consumer = readFileSync(new URL("../.github/workflows/codex-memoryd-homebrew.yml", import.meta.url), "utf8")
  const image = `ghcr.io/joshyorko/room-of-requirement:wolfi@sha256:${"a".repeat(64)}`
  assert.equal(wolfiImage(`    image: ${image}\n`), image)
  assert.match(wolfiImage(consumer), /@sha256:[0-9a-f]{64}$/)
  for (const invalid of ["", "image: ghcr.io/joshyorko/room-of-requirement:wolfi", `image: ${image}\nimage: ${image}`, `image: ${image}; echo unsafe`, `image: ${image}\nimage: invalid value`]) {
    assert.throws(() => wolfiImage(invalid), /one immutable Wolfi image/)
  }
  const publisher = readFileSync(new URL("../.github/workflows/codex-memoryd-update.yml", import.meta.url), "utf8")
  assert.ok(publisher.includes("node scripts/codex-memoryd-update.mjs wolfi-image .github/workflows/codex-memoryd-homebrew.yml"))
  assert.ok(!publisher.includes("room-of-requirement:wolfi@"))
})

test("commit-derived versions are deterministic and reject malformed source identities", () => {
  assert.equal(sourceVersion({ sha: commit, commit: { committer: { date: "2026-10-02T15:46:24Z" } } }), version)
  assert.throws(() => sourceVersion({ sha: "master" }), /commit/)
  assert.throws(() => sourceVersion({ sha: commit, commit: { committer: { date: "invalid" } } }), /date/)
})

test("formula rendering preserves safe foreground testing and all four platforms", () => {
  const rendered = renderFormula(formula, version, checksums)
  assert.match(rendered, new RegExp(`version "${version}"`))
  assert.equal((rendered.match(/homebrew-tools\/releases\/download/g) ?? []).length, 4)
  for (const target of TARGETS) assert.ok(rendered.includes(`codex-memoryd-#{version}-${target}.tar.gz`))
  assert.ok(rendered.includes('"serve", "--bind"'))
  assert.ok(!rendered.includes('system bin/"codex-memoryd", "down"'))
  assert.ok(rendered.includes('assert_path_exists testpath/"runtime/memory.db"'))
  assert.ok(rendered.includes("tracks approved released master commits"))
  assert.ok(!rendered.includes("Pinned to the immutable"))
})

test("scheduled publication requires a matching released source", () => {
  const publisher = readFileSync(new URL("../.github/workflows/codex-memoryd-update.yml", import.meta.url), "utf8")
  const guards = publisher.match(/needs\.resolve\.outputs\.released_source == 'true'/g) ?? []
  assert.equal(guards.length, 2)
  const optionalPins = publisher.match(/\(vars\.CODEX_MEMORYD_APPROVED_SOURCE_SHA == '' \|\|\s+needs\.resolve\.outputs\.commit == vars\.CODEX_MEMORYD_APPROVED_SOURCE_SHA\)/g) ?? []
  assert.equal(optionalPins.length, 2)
  assert.match(publisher, /python3 scripts\/smoke_release_candidate\.py/)
  assert.match(publisher, /fea268928b197b09ca602a73e8f26bf867fd2e9e/)
  const verified = publisher.indexOf("Verify signed immutable upstream release and compare tap builds")
  const published = publisher.indexOf("Publish retained artifacts and advance the main formula")
  assert.ok(verified >= 0 && verified < published)
  assert.match(publisher, /gh release verify-asset/)
  assert.match(publisher, /gh attestation verify/)
  assert.match(publisher, /python3 scripts\/verify_codex_memoryd_release\.py/)
})

test("resolver gates updates on one immutable stable release of the exact source", () => {
  const publisher = readFileSync(new URL("../.github/workflows/codex-memoryd-update.yml", import.meta.url), "utf8")
  const step = publisher.split("    - name: Pin the latest merged source\n")[1].split("\n  build:\n")[0]
  const script = step.split("      run: |\n")[1].split("\n").map((line) => line.slice(8)).join("\n")
  const fixture = mkdtempSync(join(tmpdir(), "memoryd-release-resolver-"))
  const fakeGh = join(fixture, "gh")
  const fakeGhSource = [
    "#!/usr/bin/env node",
    "const a = process.argv.slice(2)",
    "if (a[0] !== 'api') process.exit(2)",
    "if (a.includes('--paginate')) {",
    "  if (process.env.FIXTURE_API_FAILURE === '1') process.exit(1)",
    "  console.log(JSON.stringify([JSON.parse(process.env.FIXTURE_RELEASES)])); process.exit(0)",
    "}",
    "const target = a[1]",
    "const commit = process.env.FIXTURE_COMMIT",
    "if (target.endsWith('/commits/master')) console.log(JSON.stringify({sha:commit,commit:{committer:{date:'2026-10-02T15:46:24Z'}}}))",
    "else if (target.includes('/contents/Cargo.toml?ref=')) console.log(Buffer.from('[package]\\nversion = \"0.1.1\"\\n').toString('base64'))",
    "else if (target.includes('/contents/Formula/codex-memoryd.rb?ref=main')) console.log(Buffer.from('  version \"old\"\\n').toString('base64'))",
    "else if (target.endsWith('/commits/v0.1.1')) console.log(process.env.FIXTURE_TAG_COMMIT)",
    "else process.exit(2)",
  ].join("\n") + "\n"
  writeFileSync(fakeGh, fakeGhSource)
  chmodSync(fakeGh, 0o755)
  const release = {tag_name: "v0.1.1", draft: false, prerelease: false, immutable: true}
  const cases = [
    {name: "matching", releases: [release], expected: "true"},
    {name: "no release", releases: [], expected: "false"},
    {name: "wrong source", releases: [release], tagCommit: "b".repeat(40), expected: "false"},
    {name: "draft", releases: [{...release, draft: true}], expected: "false"},
    {name: "prerelease", releases: [{...release, prerelease: true}], expected: "false"},
    {name: "mutable", releases: [{...release, immutable: false}], expected: "false"},
    {name: "wrong version", releases: [{...release, tag_name: "v0.1.0"}], expected: "false"},
    {name: "ambiguous", releases: [release, {...release, immutable: false}], expected: "false"},
  ]
  try {
    for (const entry of cases) {
      const output = join(fixture, "output")
      const summary = join(fixture, "summary")
      writeFileSync(output, "")
      writeFileSync(summary, "")
      const result = spawnSync("bash", ["-c", script], {
        env: {...process.env, PATH: fixture + ":" + process.env.PATH, RUNNER_TEMP: fixture,
          GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary, FIXTURE_COMMIT: commit,
          FIXTURE_TAG_COMMIT: entry.tagCommit ?? commit, FIXTURE_RELEASES: JSON.stringify(entry.releases)},
        encoding: "utf8",
      })
      assert.equal(result.status, 0, entry.name + ": " + result.stderr)
      assert.match(readFileSync(output, "utf8"), new RegExp("^released_source=" + entry.expected + "$", "m"), entry.name)
    }
    const output = join(fixture, "output")
    writeFileSync(output, "")
    const failed = spawnSync("bash", ["-c", script], {
      env: {...process.env, PATH: fixture + ":" + process.env.PATH, RUNNER_TEMP: fixture,
        GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: join(fixture, "summary"), FIXTURE_COMMIT: commit,
        FIXTURE_TAG_COMMIT: commit, FIXTURE_RELEASES: "[]", FIXTURE_API_FAILURE: "1"},
      encoding: "utf8",
    })
    assert.notEqual(failed.status, 0, "a release API failure must not allow publication")
  } finally {
    rmSync(fixture, {recursive: true, force: true})
  }
})

test("consumer smoke and upgrade guidance do not call legacy PID-file shutdown", () => {
  const smoke = readFileSync(new URL("./smoke-codex-memoryd-homebrew.sh", import.meta.url), "utf8")
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8")
  const section = readme.split("## Codex MemoryD\n")[1].split("\n## License")[0]
  assert.doesNotMatch(smoke, /codex-memoryd\s+(?:down|restart)/)
  assert.doesNotMatch(section, /^codex-memoryd\s+(?:down|restart)/m)
})

test("consumer smoke uses writable isolated Homebrew state with an inaccessible default cache", () => {
  const fixture = mkdtempSync(join(tmpdir(), "memoryd-brew-env-"))
  try {
    const fakeBrew = join(fixture, "brew")
    const capture = join(fixture, "capture")
    writeFileSync(fakeBrew, '#!/bin/bash\nprintf "%s\\n" "$HOMEBREW_CACHE" "$HOMEBREW_LOGS" "$XDG_CACHE_HOME" "$XDG_CONFIG_HOME" > "$CAPTURE"\nexit 42\n')
    chmodSync(fakeBrew, 0o755)
    const result = spawnSync("bash", [fileURLToPath(new URL("./smoke-codex-memoryd-homebrew.sh", import.meta.url))], {
      env: { ...process.env, PATH: `${fixture}:/bin:/usr/bin`, TMPDIR: fixture, CAPTURE: capture,
        HOMEBREW_CACHE: "/root/unwritable-cache", FORMULA_PATH: fileURLToPath(new URL("../Formula/codex-memoryd.rb", import.meta.url)) },
      encoding: "utf8",
    })
    assert.equal(result.status, 42, result.stderr)
    const paths = readFileSync(capture, "utf8").trim().split("\n")
    assert.equal(paths.length, 4)
    for (const path of paths) assert.ok(path.startsWith(`${fixture}/`), path)
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test("a partial or ambiguous artifact set cannot update the formula", () => {
  assert.throws(() => renderFormula(formula, version, checksums.split("\n").slice(1).join("\n")), /missing/)
  assert.throws(() => renderFormula(formula, version, `${checksums}\n${checksums.split("\n")[0]}`), /Duplicate/)
  assert.throws(() => renderFormula(formula, "master", checksums), /version/)
  assert.throws(() => renderFormula(formula.replace(/^  version .*$/m, ""), version, checksums), /version/)
  assert.throws(() => renderFormula(formula, version, checksums.replace(/1{64}/, "invalid")), /checksum/)
})


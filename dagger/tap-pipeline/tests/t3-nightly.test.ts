import assert from "node:assert/strict"
import test from "node:test"
import { nightlyPackageVersion, parseNightlyRelease, resolveNightlyBaseline, resolveNightlyReleases, selectNightlyHistory } from "../src/t3-nightly.ts"

const tag = "v0.1.10-nightly.20261116.4774"
const previous = "v0.1.10-nightly.20261116.4761"
const before = "v0.1.10-nightly.20261115.4749"
const commit = "16695c812fffe75e85f8cc3084d2c561aa3ca93f"
const previousCommit = "6b7027b1f43eebc4c7edf5304236a0775b2d8928"
function record(version = tag, base = previous, changes = 26, contributors = 7) {
  return {
    tag_name: version, draft: false, prerelease: true,
    html_url: `https://github.com/pingdotgg/t3code/releases/tag/${version}`,
    published_at: "2026-11-16T07:48:27Z",
    body: `**${version}** · ${changes} changes from ${contributors} contributors\n\n- **File search.** Searching after a large folder arrives no longer freezes the server.\n- **Composer drafts.** Saved drafts preserve underscores in non-Latin names after a reload.\n\n### Plus ${changes - 3} more bug fixes.\n\n<details>\n<summary>Full changelog</summary>\n\n**Full Changelog**: https://github.com/pingdotgg/t3code/compare/${base}...${version}\n\n</details>\n`,
  }
}

test("retains official notes, date and canonical release identity verbatim", () => {
  const source = record()
  const release = parseNightlyRelease(source, commit)
  assert.equal(release.body, source.body)
  assert.equal(release.publishedAt, source.published_at)
  assert.equal(release.previousTag, previous)
  assert.equal(release.commit, commit)
  assert.equal(nightlyPackageVersion(release), "0.1.10-nightly.20261116.4774.homebrew.1.16695c812fff")
})

test("rejects wrong channel, mismatched heading, identity, URL and unpeeled source refs", () => {
  for (const source of [
    { ...record(), tag_name: "v0.1.10" },
    { ...record(), body: record(previous, before).body },
    { ...record(), html_url: "https://github.com/joshyorko/homebrew-tools/releases/tag/example" },
    { ...record(), draft: true },
    { ...record(), published_at: "yesterday" },
  ]) assert.throws(() => parseNightlyRelease(source, commit))
  assert.throws(() => parseNightlyRelease(record(), "main"))
  assert.throws(() => nightlyPackageVersion(parseNightlyRelease(record(), commit), 0))
})

test("preserves GitHub generated fallback notes without fabricating highlights or stats", () => {
  const body = `## What's Changed\n* Fix search by @example in https://github.com/pingdotgg/t3code/pull/1\n\n**Full Changelog**: https://github.com/pingdotgg/t3code/compare/${previous}...${tag}\n`
  assert.equal(parseNightlyRelease({ ...record(), body }, commit).body, body)
})

test("history follows proven compare boundaries once, excluding newer releases", () => {
  const available = parseNightlyRelease(record(), commit)
  const older = parseNightlyRelease(record(previous, before, 23, 9), previousCommit)
  const result = selectNightlyHistory({ available, installed: { tag: before, commit: "a".repeat(40) }, releases: [older, available, older] })
  assert.equal(result.kind, "complete")
  assert.deepEqual(result.releases.map((release) => release.tag), [tag, previous])
  assert.equal(result.releases[1]?.body, record(previous, before, 23, 9).body)
})

test("migration, missing range, missing notes and truncated histories explicitly remain limited", () => {
  const available = parseNightlyRelease(record(), commit)
  assert.equal(selectNightlyHistory({ available, releases: [available] }).kind, "limited")
  assert.equal(selectNightlyHistory({ available, installed: { tag: before, commit: "a".repeat(40) }, releases: [available] }).kind, "limited")
  const empty = parseNightlyRelease({ ...record(), body: null }, commit)
  assert.equal(selectNightlyHistory({ available: empty, releases: [empty] }).kind, "limited")
  assert.equal(selectNightlyHistory({ available, installed: { tag: before, commit: "a".repeat(40) }, releases: [available], limit: 1 }).kind, "limited")
})

test("same source tap rebuild and no-op never claim new upstream changes", () => {
  const available = parseNightlyRelease(record(), commit)
  const installed = { tag, commit }
  assert.equal(selectNightlyHistory({ available, installed, releases: [available], samePackage: true }).kind, "current")
  const rebuild = selectNightlyHistory({ available, installed, releases: [available] })
  assert.equal(rebuild.kind, "rebuild")
  assert.deepEqual(rebuild.releases, [])
  assert.throws(() => selectNightlyHistory({ available, installed: { tag, commit: previousCommit }, releases: [available] }))
})

test("resolver uses the immutable tag object, never target_commitish, and peels annotated tags", async () => {
  const calls: string[] = []
  const release = await resolveNightlyBaseline({ fetchJson: async (path) => {
    calls.push(path)
    if (path.includes("releases?")) return [{ ...record(), target_commitish: "main" }]
    if (path.includes("git/ref/")) return { ref: `refs/tags/${tag}`, object: { type: "tag", sha: "a".repeat(40) } }
    return { tag, object: { type: "commit", sha: commit } }
  } })
  assert.equal(release.commit, commit)
  assert.equal(calls.length, 3)
})

test("resolver bounds pagination and propagates offline/rate-limit failures", async () => {
  let pages = 0
  await assert.rejects(resolveNightlyBaseline({ fetchJson: async () => { pages++; return [] } }), /nightly/)
  assert.equal(pages, 1)
  await assert.rejects(resolveNightlyBaseline({ fetchJson: async () => { throw new Error("HTTP 429") } }), /429/)
  await assert.rejects(resolveNightlyBaseline({ requestedTag: "main", fetchJson: async () => [] }), /nightly/)
})

test("resolver compares nightly version numbers rather than GitHub release ordering", async () => {
  const result = await resolveNightlyReleases({ fetchJson: async (path) => {
    if (path.includes("releases?")) return [record(previous, before, 23, 9), record()]
    const selected = path.endsWith(previous) ? previous : tag
    return { ref: `refs/tags/${selected}`, object: { type: "commit", sha: selected === tag ? commit : previousCommit } }
  } })
  assert.equal(result.available.tag, tag)
  assert.deepEqual(result.releases.map((release) => release.tag), [tag, previous])
})

test("explicit immutable replay rejects disagreement and excludes later nightly notes", async () => {
  const fetchJson = async (path: string) => {
    if (path.includes("releases/tags/")) return record(previous, before, 23, 9)
    if (path.includes("releases?")) return [record(), record(previous, before, 23, 9)]
    const selected = path.endsWith(previous) ? previous : tag
    return { ref: `refs/tags/${selected}`, object: { type: "commit", sha: selected === tag ? commit : previousCommit } }
  }
  const result = await resolveNightlyReleases({ fetchJson, requestedTag: previous, requestedCommit: previousCommit })
  assert.equal(result.available.tag, previous)
  assert.deepEqual(result.releases.map((release) => release.tag), [previous])
  await assert.rejects(resolveNightlyReleases({ fetchJson, requestedTag: previous, requestedCommit: commit }), /disagree/)
})

test("release-note size bounds count UTF-8 bytes rather than JavaScript characters", () => {
  assert.throws(() => parseNightlyRelease({ ...record(), body: "🦕".repeat(50_001) }, commit), /notes/)
})

test("verbose Unicode history fits the complete duplicated provenance payload budget", async () => {
  const records = [4774, 4761, 4749, 4730, 4723].map((run, index, runs) => {
    const current = `v0.1.10-nightly.20261116.${run}`
    const base = `v0.1.10-nightly.20261116.${runs[index + 1] ?? 4700}`
    const source = record(current, base)
    return { ...source, body: source.body + "\n" + "🦕".repeat(45_000) }
  })
  const result = await resolveNightlyReleases({ fetchJson: async (path) => {
    if (path.includes("releases?")) return records
    const selected = records.find((source) => path.endsWith(source.tag_name))
    assert.ok(selected)
    return { ref: `refs/tags/${selected.tag_name}`, object: { type: "commit", sha: commit } }
  } })
  const payload = { schemaVersion: 1, packageVersion: nightlyPackageVersion(result.available), sourceCommit: result.available.commit, upstream: result.available, releases: result.releases, historyComplete: result.historyComplete }
  assert.ok(new TextEncoder().encode(JSON.stringify(payload)).length <= 750_000)
  assert.equal(result.releases.length, 3)
  assert.deepEqual(result.releases.map((release) => release.tag), records.slice(0, 3).map((source) => source.tag_name))
  assert.equal(result.releases[0]?.body, records[0]?.body)
  assert.equal(result.historyComplete, false)
})

test("JSON escaping cannot silently push even a single offered record over the transport limit", async () => {
  await assert.rejects(resolveNightlyReleases({ fetchJson: async (path) => {
    if (path.includes("releases?")) return [{ ...record(), body: "\\".repeat(190_000) }]
    return { ref: `refs/tags/${tag}`, object: { type: "commit", sha: commit } }
  } }), /transport byte limit/)
})

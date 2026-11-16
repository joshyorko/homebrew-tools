const REPOSITORY = "pingdotgg/t3code"
const RELEASE_ROOT = `https://github.com/${REPOSITORY}/releases/tag/`
const COMPARE_ROOT = `https://github.com/${REPOSITORY}/compare/`
const NIGHTLY_TAG = /^v\d+\.\d+\.\d+-nightly\.\d{8}\.\d+$/
const COMMIT = /^[0-9a-f]{40}$/
export const T3_NIGHTLY_HISTORY_LIMIT = 20
export const T3_NIGHTLY_PROVENANCE_BYTE_LIMIT = 750_000
const NOTE_BYTE_LIMIT = 200_000
const utf8 = new TextEncoder()
const PAGE_SIZE = 100
const MAX_PAGES = 3

export type T3NightlyRelease = {
  tag: string
  version: string
  commit: string
  publishedAt: string
  url: string
  body: string
  previousTag: string | null
}

export type T3NightlyHistory = {
  kind: "current" | "rebuild" | "complete" | "limited"
  releases: T3NightlyRelease[]
  reason: string
}

export type NightlyFetchJson = (path: string) => Promise<unknown>

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid upstream nightly metadata object")
  }
  return Object.fromEntries(Object.entries(value))
}

function nightlyTag(value: unknown): string {
  if (typeof value !== "string" || !NIGHTLY_TAG.test(value)) throw new Error("Expected an official T3 nightly tag")
  return value
}

export function compareNightlyTags(left: string, right: string): number {
  const numbers = (tag: string) => nightlyTag(tag).slice(1).replace("-nightly.", ".").split(".").map(BigInt)
  const rightParts = numbers(right)
  for (const [index, part] of numbers(left).entries()) {
    const other = rightParts[index]
    if (other === undefined) throw new Error("Invalid nightly version components")
    if (part !== other) return part > other ? 1 : -1
  }
  return 0
}

function commitSha(value: unknown): string {
  if (typeof value !== "string" || !COMMIT.test(value)) throw new Error("Expected immutable nightly source commit SHA")
  return value
}

export function parseNightlyRelease(value: unknown, resolvedTagCommit: string): T3NightlyRelease {
  const raw = object(value)
  const tag = nightlyTag(raw.tag_name)
  const commit = commitSha(resolvedTagCommit)
  if (raw.draft !== false || raw.prerelease !== true || raw.html_url !== `${RELEASE_ROOT}${tag}`) {
    throw new Error(`Invalid official nightly release identity for ${tag}`)
  }
  if (typeof raw.published_at !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(raw.published_at) || !Number.isFinite(Date.parse(raw.published_at))) {
    throw new Error(`Invalid nightly publication date for ${tag}`)
  }
  const body = raw.body === null ? "" : raw.body
  if (typeof body !== "string" || utf8.encode(body).length > NOTE_BYTE_LIMIT) throw new Error(`Invalid nightly release notes for ${tag}`)
  // Upstream deliberately retains GitHub's generated notes if its summary step fails.
  // Only a structured version header claims an additional version identity.
  const heading = body.trimStart().match(/^\*\*(v[^*]+)\*\*/)?.[1]
  if (heading && heading !== tag) throw new Error(`Nightly release note heading does not match ${tag}`)
  const compare = body.match(/\*\*Full Changelog\*\*:\s+(https:\/\/[^\s<>]+)/)?.[1]
  let previousTag: string | null = null
  if (compare) {
    if (!compare.startsWith(COMPARE_ROOT)) throw new Error(`Noncanonical nightly changelog URL for ${tag}`)
    const [previous, offered, extra] = compare.slice(COMPARE_ROOT.length).split("...")
    if (!previous || !NIGHTLY_TAG.test(previous) || offered !== tag || extra !== undefined || compareNightlyTags(previous, tag) >= 0) {
      throw new Error(`Nightly changelog range does not match ${tag}`)
    }
    previousTag = previous
  }
  return { tag, version: tag.slice(1), commit, publishedAt: raw.published_at, url: `${RELEASE_ROOT}${tag}`, body, previousTag }
}

export function nightlyPackageVersion(release: T3NightlyRelease, revision = 1): string {
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error("Nightly package revision must be a positive integer")
  return `${release.version}.homebrew.${revision}.${release.commit.slice(0, 12)}`
}

export function selectNightlyHistory({ available, installed, releases, limit = T3_NIGHTLY_HISTORY_LIMIT, samePackage = false }: {
  available: T3NightlyRelease
  installed?: { tag: string, commit: string }
  releases: T3NightlyRelease[]
  limit?: number
  samePackage?: boolean
}): T3NightlyHistory {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > T3_NIGHTLY_HISTORY_LIMIT) throw new Error("Invalid nightly history limit")
  if (installed?.tag === available.tag && installed.commit !== available.commit) throw new Error("Nightly source changed for an existing tag")
  if (installed?.commit === available.commit) return { kind: samePackage ? "current" : "rebuild", releases: [], reason: samePackage ? "Already current." : "Homebrew rebuild: no new upstream changes." }
  if (!installed) return { kind: "limited", releases: available.body ? [available] : [], reason: "Limited history: the installed upstream nightly baseline is unknown." }
  const byTag = new Map<string, T3NightlyRelease>()
  for (const release of releases) {
    const duplicate = byTag.get(release.tag)
    if (duplicate && JSON.stringify(duplicate) !== JSON.stringify(release)) throw new Error(`Conflicting nightly metadata for ${release.tag}`)
    byTag.set(release.tag, release)
  }
  const installedRelease = byTag.get(installed.tag)
  if (installedRelease && installedRelease.commit !== installed.commit) throw new Error("Installed nightly source does not match retained metadata")
  const selected: T3NightlyRelease[] = []
  const visited = new Set<string>()
  let current: T3NightlyRelease | undefined = available
  while (current && selected.length < limit && !visited.has(current.tag)) {
    visited.add(current.tag)
    if (!current.body) break
    selected.push(current)
    if (current.previousTag === installed.tag) return { kind: "complete", releases: selected, reason: "Included upstream nightly releases." }
    if (!current.previousTag) break
    current = byTag.get(current.previousTag)
  }
  return { kind: "limited", releases: selected, reason: "Limited history: the complete included nightly range could not be verified." }
}

async function resolveTagCommit(fetchJson: NightlyFetchJson, tag: string): Promise<string> {
  const ref = object(await fetchJson(`repos/${REPOSITORY}/git/ref/tags/${encodeURIComponent(tag)}`))
  if (ref.ref !== `refs/tags/${tag}`) throw new Error(`Wrong nightly tag ref for ${tag}`)
  let target = object(ref.object)
  for (let depth = 0; depth < 4; depth++) {
    const sha = commitSha(target.sha)
    if (target.type === "commit") return sha
    if (target.type !== "tag") throw new Error(`Nightly tag ${tag} does not reference a commit`)
    const annotated = object(await fetchJson(`repos/${REPOSITORY}/git/tags/${sha}`))
    if (depth === 0 && annotated.tag !== tag) throw new Error(`Wrong annotated nightly tag for ${tag}`)
    target = object(annotated.object)
  }
  throw new Error(`Nightly tag ${tag} exceeds annotated tag depth limit`)
}

export async function resolveNightlyReleases({ fetchJson, requestedTag, requestedCommit }: {
  fetchJson: NightlyFetchJson
  requestedTag?: string
  requestedCommit?: string
}): Promise<{ available: T3NightlyRelease, releases: T3NightlyRelease[], historyComplete: boolean }> {
  if (requestedTag) nightlyTag(requestedTag)
  if (requestedCommit) commitSha(requestedCommit)
  const releases: T3NightlyRelease[] = []
  const seen = new Set<string>()
  let available: T3NightlyRelease | undefined
  let exhausted = false
  if (requestedTag) {
    const raw = await fetchJson(`repos/${REPOSITORY}/releases/tags/${encodeURIComponent(requestedTag)}`)
    available = parseNightlyRelease(raw, await resolveTagCommit(fetchJson, requestedTag))
    if (requestedCommit && available.commit !== requestedCommit) throw new Error("Requested nightly tag and source commit disagree")
    releases.push(available)
    seen.add(available.tag)
  }
  for (let page = 1; page <= MAX_PAGES && releases.length < T3_NIGHTLY_HISTORY_LIMIT; page++) {
    const records = await fetchJson(`repos/${REPOSITORY}/releases?per_page=${PAGE_SIZE}&page=${page}`)
    if (!Array.isArray(records) || records.length > PAGE_SIZE) throw new Error("Invalid upstream nightly release page")
    for (const value of records) {
      const raw = object(value)
      if (typeof raw.tag_name !== "string" || !NIGHTLY_TAG.test(raw.tag_name) || raw.draft === true || seen.has(raw.tag_name)) continue
      seen.add(raw.tag_name)
      const release = parseNightlyRelease(raw, await resolveTagCommit(fetchJson, raw.tag_name))
      if (!requestedTag && (!requestedCommit || release.commit === requestedCommit) && (!available || compareNightlyTags(release.tag, available.tag) > 0)) available = release
      releases.push(release)
      if (releases.length === T3_NIGHTLY_HISTORY_LIMIT) break
    }
    if (records.length < PAGE_SIZE) { exhausted = true; break }
  }
  if (!available) throw new Error("No matching official nightly release within the bounded release history")
  const offered = available
  // A pinned replay may have newer releases in the fetched pages; never attach them.
  const included = new Map(releases.map((release) => [release.tag, release]))
  const history: T3NightlyRelease[] = []
  let current: T3NightlyRelease | undefined = available
  while (current && history.length < T3_NIGHTLY_HISTORY_LIMIT && !history.some((release) => release.tag === current?.tag)) {
    history.push(current)
    current = current.previousTag ? included.get(current.previousTag) : undefined
  }
  let historyComplete = exhausted && history.at(-1)?.previousTag === null
  // The offered release is also retained separately from history. Budget the
  // serialized transport, including that duplication and JSON escaping, rather
  // than summing character lengths or individual note sizes.
  const payloadBytes = () => utf8.encode(JSON.stringify({
    schemaVersion: 1,
    packageVersion: nightlyPackageVersion(offered),
    sourceCommit: offered.commit,
    upstream: offered,
    releases: history,
    historyComplete,
  })).length
  while (history.length > 1 && payloadBytes() > T3_NIGHTLY_PROVENANCE_BYTE_LIMIT) {
    history.pop()
    historyComplete = false
  }
  if (payloadBytes() > T3_NIGHTLY_PROVENANCE_BYTE_LIMIT) throw new Error("Offered nightly release notes exceed the provenance transport byte limit")
  return { available, releases: history, historyComplete }
}

export async function resolveNightlyBaseline(options: Parameters<typeof resolveNightlyReleases>[0]): Promise<T3NightlyRelease> {
  return (await resolveNightlyReleases(options)).available
}

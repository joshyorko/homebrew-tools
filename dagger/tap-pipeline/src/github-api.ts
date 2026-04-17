export type GithubApiFetchScriptOptions = {
  successOutput?: "body" | "true"
  notFoundOutput?: string
  maxAttempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
}

const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_BASE_DELAY_MS = 1_000
const DEFAULT_MAX_DELAY_MS = 15_000
const RETRYABLE_STATUSES = [403, 429, 500, 502, 503, 504]

export function renderGithubApiFetchScript({
  successOutput = "body",
  notFoundOutput,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  maxDelayMs = DEFAULT_MAX_DELAY_MS,
}: GithubApiFetchScriptOptions = {}): string {
  const successLines = successOutput === "true"
    ? ["    await writeStdout(\"true\")"]
    : ["    await writeStdout(await response.text())"]

  const notFoundLines = typeof notFoundOutput === "string"
    ? [
        "  if (response.status === 404) {",
        `    await writeStdout(${JSON.stringify(notFoundOutput)})`,
        "    completed = true",
        "    break",
        "  }",
      ]
    : []

  return [
    "const url = process.argv[1]",
    `const maxAttempts = ${maxAttempts}`,
    `const baseDelayMs = ${baseDelayMs}`,
    `const maxDelayMs = ${maxDelayMs}`,
    `const retryableStatuses = new Set(${JSON.stringify(RETRYABLE_STATUSES)})`,
    "const headers = { Accept: \"application/vnd.github+json\", \"User-Agent\": \"tap-pipeline\" }",
    "if (process.env.GH_TOKEN) {",
    "  headers.Authorization = `Bearer ${process.env.GH_TOKEN}`",
    "}",
    "const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))",
    "const writeStdout = (value) => new Promise((resolve, reject) => {",
    "  process.stdout.write(value, (error) => {",
    "    if (error) {",
    "      reject(error)",
    "      return",
    "    }",
    "    resolve(undefined)",
    "  })",
    "})",
    "const header = (response, name) => response.headers.get(name) ?? \"n/a\"",
    "const summarizeFailure = async (response) => {",
    "  const body = (await response.text()).replace(/\\s+/g, \" \").trim()",
    "  const bodySummary = body.length > 0 ? `, body=${body.slice(0, 200)}` : \"\"",
    "  return [",
    "    `status=${response.status}`,",
    "    `request_id=${header(response, \"x-github-request-id\")}`,",
    "    `retry_after=${header(response, \"retry-after\")}`,",
    "    `ratelimit_limit=${header(response, \"x-ratelimit-limit\")}`,",
    "    `ratelimit_remaining=${header(response, \"x-ratelimit-remaining\")}`,",
    "    `ratelimit_reset=${header(response, \"x-ratelimit-reset\")}`,",
    "  ].join(\", \") + bodySummary",
    "}",
    "let completed = false",
    "for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {",
    "  const response = await fetch(url, { headers })",
    ...notFoundLines,
    "  if (response.ok) {",
    ...successLines,
    "    completed = true",
    "    break",
    "  }",
    "  const failure = await summarizeFailure(response)",
    "  if (retryableStatuses.has(response.status) && attempt < maxAttempts) {",
    "    const retryAfterSeconds = Number(response.headers.get(\"retry-after\") ?? \"\")",
    "    const retryAfterMs = Number.isFinite(retryAfterSeconds) ? retryAfterSeconds * 1_000 : 0",
    "    const delayMs = Math.min(maxDelayMs, Math.max(baseDelayMs * (2 ** (attempt - 1)), retryAfterMs))",
    "    console.error(`GitHub API request failed for ${url} on attempt ${attempt}/${maxAttempts}: ${failure}. Retrying in ${delayMs}ms.`)",
    "    await sleep(delayMs)",
    "    continue",
    "  }",
    "  throw new Error(`Failed to fetch ${url}: ${failure}`)",
    "}",
    "if (!completed) {",
    "  throw new Error(`Failed to fetch ${url}: exhausted retries without a response`)",
    "}",
  ].join("\n")
}

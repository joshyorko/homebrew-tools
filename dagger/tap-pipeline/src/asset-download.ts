const DEFAULT_RETRY_DELAYS_MS = [1_000, 3_000, 7_000]

export function renderAssetDownloadScript(retryDelaysMs = DEFAULT_RETRY_DELAYS_MS): string {
  return [
    "import { writeFile } from 'node:fs/promises'",
    "const [url, path] = process.argv.slice(1)",
    "const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'tap-pipeline' }",
    "if (process.env.GH_TOKEN) {",
    "  headers.Authorization = `Bearer ${process.env.GH_TOKEN}`",
    "}",
    `const retryDelaysMs = ${JSON.stringify(retryDelaysMs)}`,
    "const retryableStatuses = new Set([403, 429, 500, 502, 503, 504])",
    "const wait = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs))",
    "const totalAttempts = retryDelaysMs.length + 1",
    "for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {",
    "  try {",
    "    const response = await fetch(url, { headers })",
    "    if (response.ok) {",
    "      await writeFile(path, Buffer.from(await response.arrayBuffer()))",
    "      break",
    "    }",
    "    if (!retryableStatuses.has(response.status) || attempt === totalAttempts) {",
    "      throw new Error(`Failed to download ${url}: ${response.status} after ${attempt} attempt${attempt === 1 ? '' : 's'}`)",
    "    }",
    "  } catch (error) {",
    "    if (error.message.startsWith('Failed to download') || attempt === totalAttempts) {",
    "      if (error.message.startsWith('Failed to download')) throw error",
    "      throw new Error(`Failed to download ${url}: ${error.message} after ${attempt} attempts`, { cause: error })",
    "    }",
    "  }",
    "  await wait(retryDelaysMs[attempt - 1])",
    "}",
  ].join("\n")
}

export function rewriteCaskUrl(baseContents: string, downloadUrl: string): string {
  const verifiedUrlPattern = /url ".*",\n\s+verified: ".*"/
  const fallbackUrlPattern = /^(\s*)url ".*"$/gm

  if (verifiedUrlPattern.test(baseContents)) {
    return baseContents.replace(verifiedUrlPattern, `url "${downloadUrl}"`)
  }

  const fallbackMatches = [...baseContents.matchAll(fallbackUrlPattern)]

  if (fallbackMatches.length !== 1) {
    throw new Error(
      `Expected exactly one unverified url stanza, found ${fallbackMatches.length}`,
    )
  }

  return baseContents.replace(
    fallbackUrlPattern,
    `${fallbackMatches[0][1]}url "${downloadUrl}"`,
  )
}

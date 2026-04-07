export function rewriteCaskUrl(baseContents: string, downloadUrl: string): string {
  const verifiedUrlPattern = /url ".*",\n\s+verified: ".*"/

  if (verifiedUrlPattern.test(baseContents)) {
    return baseContents.replace(verifiedUrlPattern, `url "${downloadUrl}"`)
  }

  return baseContents.replace(/url ".*"/, `url "${downloadUrl}"`)
}

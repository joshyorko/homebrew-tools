import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { parseArgs } from "node:util"
import { applySourcePatches, assertSourceRef, defaultPatchRoot, patchesForVariant } from "./t3-source-patches.mjs"

export function checkT3Patches({ sourceRef, packageIds, repository = "https://github.com/pingdotgg/t3code.git", patchRoot = defaultPatchRoot }) {
  assertSourceRef(sourceRef)
  if (!Array.isArray(packageIds) || !packageIds.every((id) => typeof id === "string")) throw new Error("Expected a JSON array of package ids")
  const variants = []
  if (packageIds.includes("t3-code-linux")) variants.push("desktop")
  if (packageIds.includes("t3code-cli-main")) variants.push("cli")
  if (variants.length === 0) return
  const root = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), "t3-patch-compatibility-"))
  const git = (args, input) => execFileSync("git", args, {
    encoding: "utf8", input, timeout: 120_000, stdio: ["pipe", "pipe", "pipe"],
  })
  try {
    const objects = join(root, "source.git")
    git(["init", "--bare", "--quiet", objects])
    git(["--git-dir", objects, "remote", "add", "origin", repository])
    git(["--git-dir", objects, "fetch", "--depth=1", "--no-tags", "--filter=blob:none", "origin", sourceRef])
    const fetched = git(["--git-dir", objects, "rev-parse", "FETCH_HEAD"]).trim()
    if (fetched !== sourceRef) throw new Error(`T3 source mismatch: selected ${sourceRef}, fetched ${fetched}`)
    for (const variant of variants) {
      const tree = join(root, variant)
      const paths = patchesForVariant(variant).flatMap((name) =>
        [...readFileSync(join(patchRoot, name), "utf8").matchAll(/^--- a\/(.+)$/gm)].map((match) => `/${match[1]}`))
      git(["--git-dir", objects, "worktree", "add", "--detach", "--no-checkout", tree, sourceRef])
      git(["-C", tree, "sparse-checkout", "set", "--no-cone", "--stdin"], `${paths.join("\n")}\n`)
      git(["-C", tree, "checkout", "--detach", "--quiet", sourceRef])
      applySourcePatches({ source: tree, sourceRef, variant, patchRoot })
    }
    console.log(`T3 patch compatibility passed at ${sourceRef}: ${variants.join(", ")}`)
  } catch (cause) {
    throw new Error(`T3 patch compatibility failed at selected source ${sourceRef}\n${cause.stderr ?? cause.message}`, { cause })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: {
    "source-ref": { type: "string" }, "package-ids": { type: "string" },
    repository: { type: "string" }, "patch-root": { type: "string", default: defaultPatchRoot },
  } })
  checkT3Patches({ sourceRef: values["source-ref"], packageIds: JSON.parse(values["package-ids"] ?? "null"), repository: values.repository, patchRoot: values["patch-root"] })
}

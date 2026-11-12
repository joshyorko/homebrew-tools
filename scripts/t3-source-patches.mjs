import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { parseArgs } from "node:util"

export const T3_PATCHES = {
  desktop: ["t3-homebrew-desktop-update.patch", "t3-homebrew-service-attach.patch"],
  cli: ["t3-homebrew-service-protect.patch"],
}
export const defaultPatchRoot = fileURLToPath(new URL("../patches/", import.meta.url))

export function assertSourceRef(sourceRef) {
  if (!/^[0-9a-f]{40}$/.test(sourceRef ?? "")) throw new Error("T3 patch checks require an immutable 40-character source SHA")
}

export function patchesForVariant(variant) {
  if (!Object.hasOwn(T3_PATCHES, variant)) throw new Error(`Unknown T3 package variant: ${variant}`)
  return T3_PATCHES[variant]
}

export function applySourcePatches({ source, sourceRef, variant, patchRoot = defaultPatchRoot }) {
  assertSourceRef(sourceRef)
  for (const name of patchesForVariant(variant)) {
    const patch = resolve(patchRoot, name)
    console.log(`T3 source ${sourceRef}: ${variant} ${name}`)
    for (const flags of [["--check", "--verbose"], []]) {
      try {
        execFileSync("git", ["-C", resolve(source), "apply", ...flags, patch], { encoding: "utf8", timeout: 30_000, stdio: ["pipe", "pipe", "pipe"] })
      } catch (cause) {
        throw new Error(`T3 source ${sourceRef}: ${variant} patch ${name} failed\n${cause.stderr ?? cause.message}`, { cause })
      }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: {
    source: { type: "string" }, "source-ref": { type: "string" },
    variant: { type: "string" }, "patch-root": { type: "string", default: defaultPatchRoot },
  } })
  if (!values.source) throw new Error("Missing --source")
  applySourcePatches({ source: values.source, sourceRef: values["source-ref"], variant: values.variant, patchRoot: values["patch-root"] })
}

#!/usr/bin/env node

import { createHash } from "node:crypto"
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"

const DEFAULT_CONVERSION_REPO =
  process.env.CODEX_DESKTOP_CONVERSION_REPO || "https://github.com/joshyorko/codex-desktop-linux"
const DEFAULT_CONVERSION_COMMIT =
  process.env.CODEX_DESKTOP_CONVERSION_COMMIT || "5ff12de4dba995904edc6b2f37bf2b93628dc837"
const LINUX_PROTOCOL_SCHEMES = ["codex", "codex-browser-sidebar"]
const LINUX_RENDERER_COPY_REPLACEMENTS = [
  ["SSH connections from this Mac", "SSH connections from this computer"],
]
const LINUX_SETTINGS_SIDEBAR_SURFACE_SELECTOR =
  "[data-codex-window-type=electron][data-codex-os=linux] .window-fx-sidebar-surface"
const LINUX_APP_SHELL_SIDEBAR_SURFACE_SELECTOR =
  "[data-codex-window-type=electron][data-codex-os=linux] .app-shell-left-panel"
const LINUX_SIDEBAR_SURFACE_RULES = [
  {
    key: "settings",
    selector: LINUX_SETTINGS_SIDEBAR_SURFACE_SELECTOR,
    css: `${LINUX_SETTINGS_SIDEBAR_SURFACE_SELECTOR}{background:var(--color-token-bg-primary)}`,
  },
  {
    key: "app_shell",
    selector: LINUX_APP_SHELL_SIDEBAR_SURFACE_SELECTOR,
    css: `${LINUX_APP_SHELL_SIDEBAR_SURFACE_SELECTOR}{background:var(--color-token-bg-primary)}`,
  },
]
const LINUX_ICON_VISIBILITY_SELECTOR =
  "[data-codex-window-type=electron][data-codex-os=linux] [role=menu] [role=menuitem] :is(img,svg)"
const LINUX_ICON_VISIBILITY_RULE = {
  key: "menu_item_icons",
  selector: LINUX_ICON_VISIBILITY_SELECTOR,
  css: `${LINUX_ICON_VISIBILITY_SELECTOR}{width:20px;height:20px;min-width:20px;min-height:20px}`,
}

function linuxProtocolMimeTypes() {
  return `${LINUX_PROTOCOL_SCHEMES.map((scheme) => `x-scheme-handler/${scheme}`).join(";")};`
}

function parseArgs(argv) {
  const args = {}

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg?.startsWith("--")) continue

    const key = arg.slice(2)
    const value = argv[index + 1]
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`)
    }

    args[key] = value
    index += 1
  }

  return args
}

function requiredArg(args, name) {
  const value = args[name]
  if (!value) {
    throw new Error(
      "Usage: package-codex-desktop-linux.mjs --app-dir <converted-codex-app> --version <version> --output <tar.gz> [--codex-dmg <Codex.dmg>] [--rebuild-report <json>] [--patch-report <json>] [--metadata-output <json>] [--computer-use-ui-enabled true|false]",
    )
  }

  return value
}

function readJsonIfPresent(path) {
  if (!path || !existsSync(path)) {
    return null
  }

  return JSON.parse(readFileSync(path, "utf8"))
}

function sha256File(path) {
  const hash = createHash("sha256")
  hash.update(readFileSync(path))
  return hash.digest("hex")
}

function hashDirectory(path) {
  const hash = createHash("sha256")

  function walk(current) {
    const stat = lstatSync(current)
    const localPath = relative(path, current) || "."

    if (stat.isSymbolicLink()) {
      hash.update(`symlink:${localPath}:${readlinkSync(current)}\n`)
      return
    }

    if (stat.isDirectory()) {
      hash.update(`dir:${localPath}\n`)
      for (const entry of readdirSync(current).sort()) {
        walk(join(current, entry))
      }
      return
    }

    if (stat.isFile()) {
      hash.update(`file:${localPath}:${stat.mode & 0o777}:${stat.size}:`)
      hash.update(readFileSync(current))
      hash.update("\n")
    }
  }

  walk(path)
  return hash.digest("hex")
}

function alignAsarPickle(value) {
  return value + ((4 - (value % 4)) % 4)
}

function createAsarUInt32Pickle(value) {
  const buffer = Buffer.alloc(8)
  buffer.writeUInt32LE(4, 0)
  buffer.writeUInt32LE(value, 4)
  return buffer
}

function createAsarStringPickle(value) {
  const stringLength = Buffer.byteLength(value)
  const payloadSize = 4 + alignAsarPickle(stringLength)
  const buffer = Buffer.alloc(4 + payloadSize)
  buffer.writeUInt32LE(payloadSize, 0)
  buffer.writeInt32LE(stringLength, 4)
  buffer.write(value, 8, stringLength, "utf8")
  return buffer
}

function readAsarHeader(asarPath) {
  const file = readFileSync(asarPath)
  if (file.length < 16 || file.readUInt32LE(0) !== 4) {
    throw new Error(`Not an ASAR archive: ${asarPath}`)
  }

  const headerSize = file.readUInt32LE(4)
  const headerBuffer = file.subarray(8, 8 + headerSize)
  const headerPayloadSize = headerBuffer.readUInt32LE(0)
  const headerStringLength = headerBuffer.readInt32LE(4)
  if (headerPayloadSize + 4 !== headerBuffer.length) {
    throw new Error(`Invalid ASAR header payload size in ${asarPath}`)
  }

  const headerString = headerBuffer.subarray(8, 8 + headerStringLength).toString("utf8")
  return {
    header: JSON.parse(headerString),
    headerSize,
    payloadOffset: 8 + headerSize,
    source: file,
  }
}

function listAsarFileNodes(header) {
  const nodes = []

  function walk(node, pathParts) {
    if (node?.files) {
      for (const [name, child] of Object.entries(node.files)) {
        walk(child, [...pathParts, name])
      }
      return
    }

    if (typeof node?.size === "number") {
      nodes.push({
        path: pathParts.join("/"),
        node,
      })
    }
  }

  walk(header, [])
  return nodes
}

function hashAsarBlock(buffer) {
  return createHash("sha256").update(buffer).digest("hex")
}

function updateAsarIntegrity(node, buffer) {
  const blockSize = Number(node.integrity?.blockSize ?? 4 * 1024 * 1024)
  const blocks = []
  for (let offset = 0; offset < buffer.length; offset += blockSize) {
    blocks.push(hashAsarBlock(buffer.subarray(offset, offset + blockSize)))
  }

  node.integrity = {
    algorithm: "SHA256",
    hash: hashAsarBlock(buffer),
    blockSize,
    blocks,
  }
}

function patchLinuxEditorTargets(source) {
  if (
    source.includes("linuxDetect:()=>lm(`code`)") &&
    source.includes("linuxDetect:()=>lm(`code-insiders`)")
  ) {
    return source
  }
  if (
    source.includes("codexLinuxIdeCommand(`vscode`)") &&
    source.includes("codexLinuxIdeCommand(`vscodeInsiders`)")
  ) {
    return source
  }

  const original = source

  const editorFactory = source.match(
    /function\s+([A-Za-z_$][\w$]*)\(\{id:([A-Za-z_$][\w$]*),label:([A-Za-z_$][\w$]*),icon:([A-Za-z_$][\w$]*),darwinDetect:([A-Za-z_$][\w$]*),win32Detect:([A-Za-z_$][\w$]*),darwinEnv:([A-Za-z_$][\w$]*),darwinArgs:([A-Za-z_$][\w$]*),hidden:([A-Za-z_$][\w$]*)\}\)\{return\{id:\2,platforms:\{darwin:\5\?\{label:\3,icon:\4,kind:`editor`,hidden:\9,detect:\5,env:\7,args:\8\?\?([A-Za-z_$][\w$]*),supportsSsh:!0\}:void 0,win32:\6\?\{label:\3,icon:\4,kind:`editor`,hidden:\9,detect:\6,args:\10,supportsSsh:!0\}:void 0\}\}\}/,
  )
  if (editorFactory) {
    const [
      factorySource,
      functionName,
      idParam,
      labelParam,
      iconParam,
      darwinDetectParam,
      win32DetectParam,
      darwinEnvParam,
      darwinArgsParam,
      hiddenParam,
      defaultArgsName,
    ] = editorFactory
    const linuxDetectParam = unusedMinifiedParameterName(
      [
        idParam,
        labelParam,
        iconParam,
        darwinDetectParam,
        win32DetectParam,
        darwinEnvParam,
        darwinArgsParam,
        hiddenParam,
        defaultArgsName,
      ],
      "l",
    )
    source = source.replace(
      factorySource,
      `function ${functionName}({id:${idParam},label:${labelParam},icon:${iconParam},darwinDetect:${darwinDetectParam},win32Detect:${win32DetectParam},linuxDetect:${linuxDetectParam},darwinEnv:${darwinEnvParam},darwinArgs:${darwinArgsParam},hidden:${hiddenParam}}){return{id:${idParam},platforms:{darwin:${darwinDetectParam}?{label:${labelParam},icon:${iconParam},kind:\`editor\`,hidden:${hiddenParam},detect:${darwinDetectParam},env:${darwinEnvParam},args:${darwinArgsParam}??${defaultArgsName},supportsSsh:!0}:void 0,win32:${win32DetectParam}?{label:${labelParam},icon:${iconParam},kind:\`editor\`,hidden:${hiddenParam},detect:${win32DetectParam},args:${defaultArgsName},supportsSsh:!0}:void 0,linux:${linuxDetectParam}?{label:${labelParam},icon:${iconParam},kind:\`editor\`,hidden:${hiddenParam},detect:${linuxDetectParam},args:${defaultArgsName},supportsSsh:!0}:void 0}}}`,
    )
  }

  source = patchEditorTargetLinuxDetect(source, "vscode", "code")
  source = patchEditorTargetLinuxDetect(source, "vscodeInsiders", "code-insiders")

  if (source === original) {
    throw new Error("Codex Desktop main bundle did not match the expected VS Code target registry")
  }
  if (!source.includes("linuxDetect:()=>lm(`code`)") || !source.includes("linuxDetect:()=>lm(`code-insiders`)")) {
    throw new Error("Codex Desktop Linux editor target patch did not produce both VS Code detectors")
  }

  return source
}

function unusedMinifiedParameterName(usedNames, preferredName) {
  const used = new Set(usedNames)
  if (!used.has(preferredName)) {
    return preferredName
  }
  for (const name of "abcdefghijklmnopqrstuvwxyz") {
    if (!used.has(name)) {
      return name
    }
  }
  throw new Error("Could not allocate a minified parameter name for Linux editor detection")
}

function patchEditorTargetLinuxDetect(source, targetId, command) {
  const targetPattern = new RegExp(
    `([A-Za-z_$][\\\\w$]*\\s*=\\s*[A-Za-z_$][\\\\w$]*\\(\\{id:\`${targetId}\`[\\s\\S]*?)(\\}\\);)`,
  )
  return source.replace(targetPattern, (match, targetSource, suffix) => {
    if (match.includes("linuxDetect:")) {
      return match
    }
    return `${targetSource},linuxDetect:()=>lm(\`${command}\`)${suffix}`
  })
}

function rewriteAsarWithPatchedFile(asarPath, targetPath, patchedBuffer) {
  const archive = readAsarHeader(asarPath)
  const fileNodes = listAsarFileNodes(archive.header)
  const target = fileNodes.find((entry) => entry.path === targetPath)
  if (!target) {
    throw new Error(`ASAR target file is missing: ${targetPath}`)
  }

  target.node.size = patchedBuffer.length
  updateAsarIntegrity(target.node, patchedBuffer)

  const packedNodes = fileNodes
    .filter((entry) => !entry.node.unpacked && typeof entry.node.offset === "string")
    .map((entry) => ({ ...entry, oldOffset: BigInt(entry.node.offset) }))
    .sort((left, right) => Number(left.oldOffset - right.oldOffset))

  let offset = 0n
  for (const entry of packedNodes) {
    entry.node.offset = offset.toString()
    offset += BigInt(entry.node.size)
  }

  const headerBuffer = createAsarStringPickle(JSON.stringify(archive.header))
  const sizeBuffer = createAsarUInt32Pickle(headerBuffer.length)
  const output = Buffer.alloc(sizeBuffer.length + headerBuffer.length + Number(offset))
  sizeBuffer.copy(output, 0)
  headerBuffer.copy(output, sizeBuffer.length)

  let writeOffset = sizeBuffer.length + headerBuffer.length
  for (const entry of packedNodes) {
    const buffer =
      entry.path === targetPath
        ? patchedBuffer
        : archive.source.subarray(
            archive.payloadOffset + Number(entry.oldOffset),
            archive.payloadOffset + Number(entry.oldOffset) + entry.node.size,
          )
    buffer.copy(output, writeOffset)
    writeOffset += buffer.length
  }

  writeFileSync(asarPath, output)
}

function patchLinuxEditorOpenTargets(appDir) {
  const asarPath = join(appDir, "resources/app.asar")
  let archive
  try {
    archive = readAsarHeader(asarPath)
  } catch (error) {
    if (readFileSync(asarPath, "utf8") === "fixture-asar") {
      return {
        patched: false,
        main_bundle: null,
        targets: [],
        skipped: "fixture-asar",
      }
    }
    throw error
  }
  const mainBundles = listAsarFileNodes(archive.header)
    .filter((entry) => /^\.vite\/build\/main-[^/]+\.js$/.test(entry.path) && !entry.node.unpacked)
    .sort((left, right) => left.path.localeCompare(right.path))

  for (const entry of mainBundles) {
    const start = archive.payloadOffset + Number(BigInt(entry.node.offset))
    const source = archive.source.subarray(start, start + entry.node.size).toString("utf8")
    if (
      !source.includes("id:`vscode`") ||
      !source.includes("id:`vscodeInsiders`") ||
      !source.includes("label:`VS Code`") ||
      !source.includes("label:`VS Code Insiders`")
    ) {
      continue
    }

    const patched = patchLinuxEditorTargets(source)
    rewriteAsarWithPatchedFile(asarPath, entry.path, Buffer.from(patched, "utf8"))
    return {
      patched: true,
      main_bundle: entry.path,
      targets: ["vscode", "vscodeInsiders"],
    }
  }

  throw new Error("Could not find Codex Desktop main bundle with VS Code open target definitions")
}

function patchLinuxFeatureMainBundles(appDir) {
  const featurePatches = loadLinuxFeatureMainBundlePatches()
  if (featurePatches.length === 0) {
    return []
  }

  const asarPath = join(appDir, "resources/app.asar")
  let archive
  try {
    archive = readAsarHeader(asarPath)
  } catch (error) {
    if (readFileSync(asarPath, "utf8") === "fixture-asar") {
      return featurePatches.map((patch) => ({
        id: patch.id,
        patched: false,
        main_bundle: null,
        skipped: "fixture-asar",
      }))
    }
    throw error
  }

  const mainBundles = listAsarFileNodes(archive.header)
    .filter((entry) => /^\.vite\/build\/main-[^/]+\.js$/.test(entry.path) && !entry.node.unpacked)
    .sort((left, right) => left.path.localeCompare(right.path))
  const results = []

  for (const patch of featurePatches) {
    let patchedFeature = false
    for (const entry of mainBundles) {
      const refreshedArchive = readAsarHeader(asarPath)
      const refreshedEntry = listAsarFileNodes(refreshedArchive.header)
        .find((candidate) => candidate.path === entry.path)
      if (!refreshedEntry) {
        continue
      }

      const start = refreshedArchive.payloadOffset + Number(BigInt(refreshedEntry.node.offset))
      const source = refreshedArchive.source.subarray(start, start + refreshedEntry.node.size).toString("utf8")
      const patched = patch.apply(source, { appDir, mainBundle: entry.path })
      if (patched !== source) {
        rewriteAsarWithPatchedFile(asarPath, entry.path, Buffer.from(patched, "utf8"))
        results.push({
          id: patch.id,
          patched: true,
          main_bundle: entry.path,
        })
        patchedFeature = true
        break
      }
    }

    if (!patchedFeature) {
      results.push({
        id: patch.id,
        patched: false,
        main_bundle: null,
      })
    }
  }

  return results
}

function writeExecutable(path, contents) {
  writeFileSync(path, contents, { mode: 0o755 })
}

function fileIsExecutable(path) {
  try {
    return Boolean(lstatSync(path).mode & 0o111)
  } catch {
    return false
  }
}

function assertConvertedApp(appDir) {
  const requiredFiles = [
    ["launcher", join(appDir, "start.sh")],
    ["Electron binary", join(appDir, "electron")],
    ["patched app.asar", join(appDir, "resources/app.asar")],
  ]

  for (const [label, path] of requiredFiles) {
    if (!existsSync(path)) {
      throw new Error(`Converted Codex Desktop app is missing ${label}: ${path}`)
    }
  }

  for (const path of [join(appDir, "start.sh"), join(appDir, "electron")]) {
    if (!fileIsExecutable(path)) {
      throw new Error(`Converted Codex Desktop runtime is not executable: ${path}`)
    }
  }
}

function managedNodeVersion(appDir) {
  const nodePath = join(appDir, "resources/node-runtime/bin/node")
  if (!fileIsExecutable(nodePath)) {
    return null
  }

  try {
    return execFileSync(nodePath, ["-v"], { encoding: "utf8" }).trim()
  } catch {
    return null
  }
}

function electronVersion(appDir, rebuildReport) {
  if (typeof rebuildReport?.electronVersion === "string" && rebuildReport.electronVersion.length > 0) {
    return rebuildReport.electronVersion
  }

  const versionPath = join(appDir, "version")
  if (existsSync(versionPath)) {
    return readFileSync(versionPath, "utf8").trim()
  }

  return null
}

function copyIfExists(source, destination) {
  if (!existsSync(source)) {
    return false
  }

  mkdirSync(dirname(destination), { recursive: true })
  cpSync(source, destination, { recursive: true, dereference: false })
  return true
}

function countOccurrences(source, search) {
  let count = 0
  let index = source.indexOf(search)

  while (index !== -1) {
    count += 1
    index = source.indexOf(search, index + search.length)
  }

  return count
}

function listTextFiles(root) {
  if (!existsSync(root)) {
    return []
  }

  const files = []

  function walk(current) {
    const stat = lstatSync(current)
    if (stat.isDirectory()) {
      for (const entry of readdirSync(current).sort()) {
        walk(join(current, entry))
      }
      return
    }

    if (stat.isFile() && /\.(js|mjs|cjs|html|json)$/.test(current)) {
      files.push(current)
    }
  }

  walk(root)
  return files
}

function listCssFiles(root) {
  if (!existsSync(root)) {
    return []
  }

  const files = []

  function walk(current) {
    const stat = lstatSync(current)
    if (stat.isDirectory()) {
      for (const entry of readdirSync(current).sort()) {
        walk(join(current, entry))
      }
      return
    }

    if (stat.isFile() && /\.css$/.test(current)) {
      files.push(current)
    }
  }

  walk(root)
  return files
}

function patchLinuxRendererCopy(appDir) {
  const assetsDir = join(appDir, "content/webview/assets")
  const files = []
  let replacementCount = 0

  for (const path of listTextFiles(assetsDir)) {
    const before = readFileSync(path, "utf8")
    let after = before
    let fileReplacementCount = 0

    for (const [search, replacement] of LINUX_RENDERER_COPY_REPLACEMENTS) {
      const count = countOccurrences(after, search)
      if (count === 0) {
        continue
      }

      after = after.split(search).join(replacement)
      fileReplacementCount += count
    }

    if (after !== before) {
      writeFileSync(path, after)
      files.push(relative(appDir, path))
      replacementCount += fileReplacementCount
    }
  }

  return {
    patched: replacementCount > 0,
    files,
    replacements: replacementCount,
  }
}

function patchLinuxSidebarSurfaces(appDir) {
  const assetsDir = join(appDir, "content/webview/assets")
  const cssFiles = listCssFiles(assetsDir)

  const ruleStatuses = LINUX_SIDEBAR_SURFACE_RULES.map((rule) => {
    for (const path of cssFiles) {
      const contents = readFileSync(path, "utf8")
      if (contents.includes(rule.selector)) {
        return {
          ...rule,
          patched: false,
          present: true,
          file: relative(appDir, path),
        }
      }
    }

    return {
      ...rule,
      patched: false,
      present: false,
      file: null,
    }
  })

  const missingRules = ruleStatuses.filter((rule) => !rule.present)

  const target = cssFiles.find((path) => {
    const contents = readFileSync(path, "utf8")
    return contents.includes(".app-shell-left-panel") || contents.includes(".main-surface")
  }) ?? cssFiles[0]

  if (missingRules.length > 0 && target) {
    const before = readFileSync(target, "utf8")
    const separator = before.endsWith("\n") ? "" : "\n"
    writeFileSync(target, `${before}${separator}${missingRules.map((rule) => rule.css).join("\n")}\n`)

    const targetFile = relative(appDir, target)
    for (const rule of missingRules) {
      rule.patched = true
      rule.present = true
      rule.file = targetFile
    }
  }

  const files = Array.from(new Set(ruleStatuses.flatMap((rule) => rule.file ? [rule.file] : [])))
  return {
    patched: ruleStatuses.some((rule) => rule.patched),
    present: ruleStatuses.every((rule) => rule.present),
    files,
    rules: ruleStatuses.map((rule) => ({
      key: rule.key,
      selector: rule.selector,
      patched: rule.patched,
      present: rule.present,
      file: rule.file,
    })),
  }
}

function patchLinuxIconVisibility(appDir) {
  const assetsDir = join(appDir, "content/webview/assets")
  const cssFiles = listCssFiles(assetsDir)
  const target = cssFiles.find((path) => {
    const contents = readFileSync(path, "utf8")
    return contents.includes(".app-shell-left-panel") || contents.includes(".main-surface")
  }) ?? cssFiles[0]

  for (const path of cssFiles) {
    const contents = readFileSync(path, "utf8")
    if (contents.includes(LINUX_ICON_VISIBILITY_RULE.selector)) {
      return {
        patched: false,
        present: true,
        file: relative(appDir, path),
        rule: LINUX_ICON_VISIBILITY_RULE,
      }
    }
  }

  if (!target) {
    return {
      patched: false,
      present: false,
      file: null,
      rule: LINUX_ICON_VISIBILITY_RULE,
    }
  }

  const before = readFileSync(target, "utf8")
  const separator = before.endsWith("\n") ? "" : "\n"
  writeFileSync(target, `${before}${separator}${LINUX_ICON_VISIBILITY_RULE.css}\n`)

  return {
    patched: true,
    present: true,
    file: relative(appDir, target),
    rule: LINUX_ICON_VISIBILITY_RULE,
  }
}

function copyLinuxWebviewAppIcons(appDir) {
  const sourceDir = join(appDir, "content/webview/apps")
  const targetDir = join(appDir, "content/webview/assets/apps")

  if (!existsSync(sourceDir)) {
    return {
      copied: false,
      source: relative(appDir, sourceDir),
      target: relative(appDir, targetDir),
      files: [],
    }
  }

  const files = readdirSync(sourceDir)
    .filter((name) => /\.(?:png|svg|webp|jpg|jpeg)$/i.test(name))
    .sort()

  if (files.length === 0) {
    return {
      copied: false,
      source: relative(appDir, sourceDir),
      target: relative(appDir, targetDir),
      files: [],
    }
  }

  mkdirSync(targetDir, { recursive: true })
  for (const file of files) {
    cpSync(join(sourceDir, file), join(targetDir, file), { dereference: false })
  }

  return {
    copied: true,
    source: relative(appDir, sourceDir),
    target: relative(appDir, targetDir),
    files: files.map((file) => relative(appDir, join(targetDir, file))),
  }
}

function patchLinuxWebviewServerStaleDetection(appDir) {
  const launcherPath = join(appDir, "start.sh")
  if (!existsSync(launcherPath)) {
    return { patched: false, file: null }
  }

  const before = readFileSync(launcherPath, "utf8")
  const search = `pid_is_stale_webview_server() {
    local pid="$1"
    local cwd
    local deleted_webview_dir

    pid_has_webview_server_cmdline "$pid" || return 1
    cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
    deleted_webview_dir="$(canonical_path "$WEBVIEW_DIR") (deleted)"
    [ "$cwd" = "$deleted_webview_dir" ]
}`
  const replacement = `pid_is_stale_webview_server() {
    local pid="$1"
    local cwd
    local current_webview_dir

    pid_has_webview_server_cmdline "$pid" || return 1
    cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
    current_webview_dir="$(canonical_path "$WEBVIEW_DIR")"

    # A Homebrew cask prune/reinstall can leave a user-owned webview server
    # serving an older bundle on the same fixed port. Treat any Codex webview
    # server that is not serving this bundle as stale when no live app owns it.
    [ -z "$cwd" ] || [ "$cwd" != "$current_webview_dir" ]
}`

  if (!before.includes(search)) {
    return {
      patched: before.includes("current_webview_dir=\"$(canonical_path \"$WEBVIEW_DIR\")\""),
      file: relative(appDir, launcherPath),
    }
  }

  writeFileSync(launcherPath, before.replace(search, replacement))
  return { patched: true, file: relative(appDir, launcherPath) }
}

function linuxFeaturesEnabled() {
  const configPath = process.env.CODEX_LINUX_FEATURES_CONFIG?.trim()
  if (!configPath || !existsSync(configPath)) {
    return []
  }

  try {
    const config = JSON.parse(readFileSync(configPath, "utf8"))
    if (!Array.isArray(config.enabled)) {
      return []
    }
    return config.enabled
      .filter((feature) => typeof feature === "string" && feature.length > 0)
      .sort()
  } catch {
    return []
  }
}

function loadLinuxFeatureMainBundlePatches() {
  const featureIds = linuxFeaturesEnabled()
  if (featureIds.length === 0) {
    return []
  }

  const conversionRoot = process.env.CODEX_LINUX_FEATURES_ROOT?.trim()
    ? resolve(process.env.CODEX_LINUX_FEATURES_ROOT.trim())
    : process.cwd()
  const requireFromConversion = createRequire(join(conversionRoot, "package.json"))
  const patches = []

  for (const featureId of featureIds) {
    const manifestPath = join(conversionRoot, "linux-features", featureId, "feature.json")
    if (!existsSync(manifestPath)) {
      continue
    }

    let manifest
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
    } catch {
      continue
    }

    const entrypoint = manifest?.entrypoints?.mainBundlePatch
    if (typeof entrypoint !== "string" || entrypoint.length === 0 || entrypoint.includes("..")) {
      continue
    }

    const patchPath = join(conversionRoot, "linux-features", featureId, entrypoint)
    if (!existsSync(patchPath)) {
      continue
    }

    const moduleExports = requireFromConversion(patchPath)
    const apply = moduleExports.applyMainBundlePatch ?? moduleExports.apply ?? moduleExports
    if (typeof apply === "function") {
      patches.push({ id: featureId, apply })
    }
  }

  return patches
}

function findAsset(appDir, pattern) {
  const assetsDir = join(appDir, "content/webview/assets")
  if (!existsSync(assetsDir)) {
    return null
  }

  const entry = readdirSync(assetsDir)
    .filter((name) => pattern.test(name))
    .sort()[0]

  return entry ? join(assetsDir, entry) : null
}

function resolveIconSource(appDir, explicitIcon) {
  const officialAppIcon = findAsset(appDir, /^app-[A-Za-z0-9_-]+\.png$/)
  const officialLogoIcon = findAsset(appDir, /^codex-app-ga-logo--[A-Za-z0-9_-]+\.png$/)
  const candidates = [
    explicitIcon ? { path: resolve(explicitIcon), kind: "explicit" } : null,
    officialAppIcon ? { path: officialAppIcon, kind: "official-webview-app-asset" } : null,
    officialLogoIcon ? { path: officialLogoIcon, kind: "official-webview-logo-asset" } : null,
    {
      path: join(appDir, ".codex-linux/codex-desktop.png"),
      kind: "upstream-linux-fallback",
    },
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (existsSync(candidate.path)) {
      return candidate
    }
  }

  return null
}

function launcherScript() {
  return `#!/usr/bin/env bash
set -euo pipefail

script_path="$(readlink -f "\${BASH_SOURCE[0]}")"
root="$(cd "$(dirname "$script_path")/.." && pwd)"
app_dir="$root/share/codex-desktop/app"
app_launcher="$app_dir/start.sh"
metadata="$root/share/codex-desktop/release.json"
renderer_report="$root/share/codex-desktop/renderer-report.json"
launcher_log="\${XDG_CACHE_HOME:-$HOME/.cache}/codex-desktop/launcher.log"

launcher_note() {
  mkdir -p "$(dirname "$launcher_log")"
  printf '%s %s\\n' "$(date -Iseconds 2>/dev/null || date)" "$*" >> "$launcher_log" 2>/dev/null || true
}

redact_deep_link_arg() {
  local arg="$1"

  if [ "\${CODEX_DESKTOP_LOG_FULL_DEEP_LINKS:-0}" = "1" ]; then
    printf '%s\\n' "$arg"
    return 0
  fi

  local without_fragment="\${arg%%#*}"
  local base="$without_fragment"
  local query=""

  case "$without_fragment" in
    *\\?*)
      base="\${without_fragment%%\\?*}"
      query="\${without_fragment#*\\?}"
      ;;
  esac

  if [ -z "$query" ]; then
    printf '%s\\n' "$base"
    return 0
  fi

  local query_keys
  query_keys="$(printf '%s\\n' "$query" | tr '&' '\\n' | sed -n 's/^\\([^=]*\\).*/\\1/p' | sed '/^$/d' | sort -u | paste -sd, -)"

  if [ -n "$query_keys" ]; then
    printf '%s?query_keys=%s\\n' "$base" "$query_keys"
  else
    printf '%s\\n' "$base"
  fi
}

log_deep_link_args() {
  local -a redacted=()
  local arg

  for arg in "$@"; do
    case "$arg" in
      *://*) redacted+=("$(redact_deep_link_arg "$arg")") ;;
    esac
  done

  [ "\${#redacted[@]}" -gt 0 ] || return 0
  launcher_note "deep-link args: \${redacted[*]}"
}

path_prepend_if_dir() {
  local dir="$1"
  [ -d "$dir" ] || return 0
  case ":\${PATH:-}:" in
    *":$dir:"*) ;;
    *) PATH="$dir\${PATH:+:$PATH}" ;;
  esac
}

prepare_runtime_path() {
  local brew_prefix=""

  case "$script_path" in
    */Caskroom/*) brew_prefix="\${script_path%%/Caskroom/*}" ;;
  esac

  PATH="\${PATH:-/usr/local/bin:/usr/bin:/bin}"
  path_prepend_if_dir "$brew_prefix/bin"
  path_prepend_if_dir "$brew_prefix/sbin"
  path_prepend_if_dir "$HOME/.local/bin"
  path_prepend_if_dir "$HOME/bin"
  path_prepend_if_dir "$HOME/.cargo/bin"
  path_prepend_if_dir "$HOME/.deno/bin"
  path_prepend_if_dir "$HOME/.bun/bin"
  path_prepend_if_dir "$HOME/go/bin"
  path_prepend_if_dir "$HOME/.opencode/bin"
  path_prepend_if_dir "$HOME/.local/share/mise/shims"
  export PATH
}

flatpak_app_installed() {
  local app_id="$1"
  has_command flatpak || return 1
  flatpak info "$app_id" >/dev/null 2>&1
}

flatpak_host_spawn_permission_enabled() {
  local app_id="$1"
  has_command flatpak || return 1
  flatpak info --show-permissions "$app_id" 2>/dev/null | grep -Eq '^org\\.freedesktop\\.Flatpak=talk$'
}

ensure_flatpak_host_spawn_permission() {
  local app_id="$1"
  flatpak_app_installed "$app_id" || return 0
  flatpak_host_spawn_permission_enabled "$app_id" && return 0

  if flatpak override --user --talk-name=org.freedesktop.Flatpak "$app_id" >/dev/null 2>&1; then
    launcher_note "enabled Flatpak host-spawn permission for $app_id; fully restart the browser if it was already running"
    return 0
  fi

  launcher_note "failed to enable Flatpak host-spawn permission for $app_id"
  return 1
}

write_flatpak_browser_shim() {
  local shim_dir="$1"
  local command_name="$2"
  local app_id="$3"
  local shim="$shim_dir/$command_name"

  mkdir -p "$shim_dir"
  cat > "$shim" <<SHIM
#!/usr/bin/env sh
exec flatpak run $app_id "\\$@"
SHIM
  chmod 755 "$shim"
}

chrome_plugin_arch() {
  case "$(uname -m)" in
    x86_64) echo "x64" ;;
    aarch64|arm64) echo "arm64" ;;
    *) return 1 ;;
  esac
}

chrome_plugin_host_path() {
  local arch
  arch="$(chrome_plugin_arch)" || return 1

  local candidate
  for candidate in \
    "$app_dir/resources/plugins/openai-bundled/plugins/chrome/extension-host/linux/$arch/extension-host" \
    "$HOME/.codex/plugins/cache/openai-bundled/chrome/latest/extension-host/linux/$arch/extension-host"
  do
    if [ -x "$candidate" ]; then
      readlink -f "$candidate" 2>/dev/null || printf '%s\\n' "$candidate"
      return 0
    fi
  done

  return 1
}

json_escape() {
  printf '%s' "$1" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g'
}

chrome_plugin_metadata() {
  local field="$1"
  local fallback="$2"
  local extension_json="$app_dir/resources/plugins/openai-bundled/plugins/chrome/scripts/extension-id.json"
  local install_manifest="$app_dir/resources/plugins/openai-bundled/plugins/chrome/scripts/installManifest.mjs"
  local value=""

  if [ -f "$extension_json" ]; then
    value="$(sed -nE "s/.*\\\"$field\\\"[[:space:]]*:[[:space:]]*\\\"([^\\\"]+)\\\".*/\\1/p" "$extension_json" | head -n 1 || true)"
  fi
  if [ -z "$value" ] && [ -f "$install_manifest" ]; then
    value="$(sed -nE "s/.*$field[[:space:]]*:[[:space:]]*\\\"([^\\\"]+)\\\".*/\\1/p" "$install_manifest" | head -n 1 || true)"
  fi

  printf '%s\\n' "\${value:-$fallback}"
}

write_flatpak_native_host_manifest() {
  local app_id="$1"
  local browser_config_dir="$2"
  local host_path="$3"
  local extension_id="$4"
  local host_name="$5"
  local native_dir="$HOME/.var/app/$app_id/config/$browser_config_dir/NativeMessagingHosts"
  local wrapper_dir="$HOME/.var/app/$app_id/config/codex-desktop"
  local wrapper="$wrapper_dir/$host_name"
  local manifest="$native_dir/$host_name.json"

  mkdir -p "$native_dir" "$wrapper_dir"
  cat > "$wrapper" <<WRAPPER
#!/usr/bin/env sh
exec /usr/bin/flatpak-spawn --host "$host_path" "\\$@"
WRAPPER
  chmod 755 "$wrapper"

  printf '{"name":"%s","description":"Codex chrome native messaging host","type":"stdio","path":"%s","allowed_origins":["chrome-extension://%s/"]}' \
    "$(json_escape "$host_name")" \
    "$(json_escape "$wrapper")" \
    "$(json_escape "$extension_id")" > "$manifest"
}

prepare_flatpak_browser_integration() {
  local shim_dir="\${XDG_CACHE_HOME:-$HOME/.cache}/codex-desktop/flatpak-bin"
  local google_chrome_profile="$HOME/.var/app/com.google.Chrome/config/google-chrome"
  local chromium_profile="$HOME/.var/app/org.chromium.Chromium/config/chromium"
  local brave_profile="$HOME/.var/app/com.brave.Browser/config/BraveSoftware/Brave-Browser"
  local host_path=""
  local extension_id=""
  local host_name=""

  if ! has_command google-chrome && ! has_command chrome && flatpak_app_installed com.google.Chrome; then
    write_flatpak_browser_shim "$shim_dir" google-chrome com.google.Chrome
    write_flatpak_browser_shim "$shim_dir" chrome com.google.Chrome
    path_prepend_if_dir "$shim_dir"
  fi

  if ! has_command chromium && ! has_command chromium-browser && flatpak_app_installed org.chromium.Chromium; then
    write_flatpak_browser_shim "$shim_dir" chromium org.chromium.Chromium
    write_flatpak_browser_shim "$shim_dir" chromium-browser org.chromium.Chromium
    path_prepend_if_dir "$shim_dir"
  fi

  if ! has_command brave-browser && ! has_command brave && flatpak_app_installed com.brave.Browser; then
    write_flatpak_browser_shim "$shim_dir" brave-browser com.brave.Browser
    write_flatpak_browser_shim "$shim_dir" brave com.brave.Browser
    path_prepend_if_dir "$shim_dir"
  fi

  if [ -z "\${CODEX_CHROME_USER_DATA_DIR:-}" ]; then
    if flatpak_app_installed com.google.Chrome; then
      mkdir -p "$google_chrome_profile/NativeMessagingHosts"
      export CODEX_CHROME_USER_DATA_DIR="$google_chrome_profile"
    elif flatpak_app_installed com.brave.Browser; then
      mkdir -p "$brave_profile/NativeMessagingHosts"
      export CODEX_CHROME_USER_DATA_DIR="$brave_profile"
    elif flatpak_app_installed org.chromium.Chromium; then
      mkdir -p "$chromium_profile/NativeMessagingHosts"
      export CODEX_CHROME_USER_DATA_DIR="$chromium_profile"
    fi
  fi

  host_path="$(chrome_plugin_host_path || true)"
  [ -n "$host_path" ] || return 0
  extension_id="$(chrome_plugin_metadata extensionId hehggadaopoacecdllhhajmbjkdcmajg)"
  host_name="$(chrome_plugin_metadata extensionHostName com.openai.codexextension)"

  if flatpak_app_installed com.google.Chrome; then
    mkdir -p "$google_chrome_profile/NativeMessagingHosts"
    ensure_flatpak_host_spawn_permission com.google.Chrome || true
    write_flatpak_native_host_manifest com.google.Chrome google-chrome "$host_path" "$extension_id" "$host_name" || true
  fi
  if flatpak_app_installed org.chromium.Chromium; then
    mkdir -p "$chromium_profile/NativeMessagingHosts"
    ensure_flatpak_host_spawn_permission org.chromium.Chromium || true
    write_flatpak_native_host_manifest org.chromium.Chromium chromium "$host_path" "$extension_id" "$host_name" || true
  fi
  if flatpak_app_installed com.brave.Browser; then
    mkdir -p "$brave_profile/NativeMessagingHosts"
    ensure_flatpak_host_spawn_permission com.brave.Browser || true
    write_flatpak_native_host_manifest com.brave.Browser BraveSoftware/Brave-Browser "$host_path" "$extension_id" "$host_name" || true
  fi

  export PATH
}

first_available_editor() {
  local editor_command
  for editor_command in code-insiders code cursor codium; do
    if has_command "$editor_command"; then
      command -v "$editor_command"
      return 0
    fi
  done

  return 1
}

prepare_editor_integration() {
  local editor_path=""
  editor_path="$(first_available_editor || true)"
  [ -n "$editor_path" ] || return 0

  if [ -z "\${VISUAL:-}" ]; then
    export VISUAL="$editor_path"
  fi
  if [ -z "\${EDITOR:-}" ]; then
    export EDITOR="$editor_path"
  fi
  if [ -z "\${GIT_EDITOR:-}" ]; then
    export GIT_EDITOR="\${EDITOR:-$editor_path}"
  fi
}

os_release_text() {
  local os_release_file="\${CODEX_DESKTOP_OS_RELEASE_FILE:-/etc/os-release}"
  [ -r "$os_release_file" ] || return 1
  cat "$os_release_file" 2>/dev/null || true
}

is_bluefin_like() {
  local text
  text="$(os_release_text || true)"
  case "$text" in
    *Bluefin*|*bluefin*|*Universal*Blue*|*universal-blue*|*ublue*|*ublue-os*|*VARIANT_ID=bluefin*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

has_explicit_electron_rendering_arg() {
  local arg
  for arg in "$@"; do
    case "$arg" in
      --x11|--wayland|--safe-mode|--disable-gpu|--enable-gpu|--ozone-platform|--ozone-platform=*|--ozone-platform-hint|--ozone-platform-hint=*)
        return 0
        ;;
    esac
  done
  return 1
}

desired_desktop_rendering_mode() {
  if has_explicit_electron_rendering_arg "$@"; then
    echo "explicit"
    return 0
  fi

  case "\${CODEX_DESKTOP_LINUX_OZONE:-auto}" in
    x11|X11)
      echo "x11"
      ;;
    wayland|WAYLAND)
      echo "wayland"
      ;;
    auto|"")
      if is_bluefin_like; then
        echo "x11"
      else
        echo "auto"
      fi
      ;;
    default|off|none)
      echo "auto"
      ;;
    *)
      echo "Invalid CODEX_DESKTOP_LINUX_OZONE='\${CODEX_DESKTOP_LINUX_OZONE:-}'; using auto" >&2
      if is_bluefin_like; then
        echo "x11"
      else
        echo "auto"
      fi
      ;;
  esac
}

usage() {
  cat <<'USAGE'
Usage: codex-desktop [command] [args]

Commands:
  desktop                 Launch Codex Desktop
  serve [args]            Run the Codex Desktop app launcher serve mode
  logs [--follow|--path]  Show the Codex Desktop launcher log
  doctor                  Check Bluefin/Linux runtime readiness
  --help, -h, help        Show this help

Running codex-desktop with no command launches desktop mode.
USAGE
}

has_command() {
  command -v "$1" >/dev/null 2>&1
}

check_path() {
  local label="$1"
  local path="$2"
  local missing=0

  if [ -e "$path" ]; then
    echo "ok: $label: $path"
  else
    echo "missing: $label: $path"
    missing=1
  fi

  return "$missing"
}

warn_path() {
  local label="$1"
  local path="$2"

  if [ -e "$path" ]; then
    echo "ok: $label: $path"
  else
    echo "warning: optional $label missing: $path"
  fi
}

chrome_extension_detector_path() {
  local candidate
  for candidate in \
    "$app_dir/resources/plugins/openai-bundled/plugins/chrome/scripts/check-extension-installed.js" \
    "$HOME/.codex/plugins/cache/openai-bundled/chrome/latest/scripts/check-extension-installed.js"
  do
    if [ -f "$candidate" ]; then
      printf '%s\\n' "$candidate"
      return 0
    fi
  done

  return 1
}

chrome_extension_doctor() {
  local node_path="$app_dir/resources/node-runtime/bin/node"
  local detector_path=""
  local extension_output=""
  local extension_status=0

  detector_path="$(chrome_extension_detector_path || true)"
  if [ -z "$detector_path" ]; then
    echo "warning: Chrome extension detector script is not bundled"
    return 0
  fi
  if [ ! -x "$node_path" ]; then
    echo "missing: managed Node runtime for Chrome extension detector"
    return 1
  fi

  echo "ok: Chrome extension detector: $detector_path"
  if [ -n "\${CODEX_CHROME_USER_DATA_DIR:-}" ]; then
    echo "ok: CODEX_CHROME_USER_DATA_DIR: $CODEX_CHROME_USER_DATA_DIR"
  fi

  set +e
  extension_output="$(CODEX_CHROME_USER_DATA_DIR="\${CODEX_CHROME_USER_DATA_DIR:-}" "$node_path" "$detector_path" --json 2>&1)"
  extension_status=$?
  set -e

  if printf '%s\\n' "$extension_output" | grep -q '"installed"[[:space:]]*:[[:space:]]*true' &&
      printf '%s\\n' "$extension_output" | grep -q '"registered"[[:space:]]*:[[:space:]]*true' &&
      printf '%s\\n' "$extension_output" | grep -q '"enabled"[[:space:]]*:[[:space:]]*true'; then
    echo "ok: Codex Chrome extension detected and enabled"
    return 0
  fi

  if printf '%s\\n' "$extension_output" | grep -q '"installed"[[:space:]]*:[[:space:]]*true'; then
    echo "warning: Codex Chrome extension is installed but not enabled/registered"
    printf '%s\\n' "$extension_output" | sed -n '1,12p'
    return 0
  fi

  echo "missing: Codex Chrome extension was not detected by the bundled detector"
  if [ -n "$extension_output" ]; then
    printf '%s\\n' "$extension_output" | sed -n '1,12p'
  else
    echo "Chrome extension detector exited with status $extension_status and no output"
  fi
  return 1
}

editor_doctor() {
  local found=0
  local editor_command
  local editor_path

  echo "Linux editor integration"
  for editor_command in code-insiders code cursor codium; do
    editor_path="$(command -v "$editor_command" 2>/dev/null || true)"
    if [ -n "$editor_path" ]; then
      echo "ok: editor command $editor_command: $editor_path"
      found=1
    fi
  done

  if [ "$found" -eq 0 ]; then
    echo "warning: no known desktop editor command found in PATH"
  fi
  if [ -n "\${EDITOR:-}" ]; then
    echo "ok: EDITOR: $EDITOR"
  fi
  if [ -n "\${VISUAL:-}" ]; then
    echo "ok: VISUAL: $VISUAL"
  fi
}

computer_use_doctor() {
  local backend="$app_dir/resources/plugins/openai-bundled/plugins/computer-use/bin/codex-computer-use-linux"
  local cosmic_helper="$app_dir/resources/plugins/openai-bundled/plugins/computer-use/bin/codex-computer-use-cosmic"
  local socket_path="\${YDOTOOL_SOCKET:-\${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/.ydotool_socket}"

  echo "Linux Computer Use readiness"
  warn_path "Computer Use backend" "$backend"
  warn_path "Computer Use COSMIC helper" "$cosmic_helper"

  if [ -x "$backend" ]; then
    echo "ok: Computer Use backend is bundled"
  else
    echo "warning: Computer Use backend is not executable; rebuild from the upstream DMG conversion before testing it"
  fi

  if has_command ydotool; then
    echo "ok: ydotool: $(command -v ydotool)"
  else
    echo "warning: ydotool is not available; Computer Use input synthesis will not work"
  fi

  if [ -e /dev/uinput ]; then
    if [ -r /dev/uinput ] && [ -w /dev/uinput ]; then
      echo "ok: /dev/uinput is readable and writable"
    else
      echo "warning: /dev/uinput exists but is not readable/writable by this user"
    fi
  else
    echo "warning: /dev/uinput is missing; ydotoold cannot synthesize input without it"
  fi

  if [ -S "$socket_path" ]; then
    echo "ok: ydotool socket: $socket_path"
  else
    echo "warning: ydotool socket not found: $socket_path"
  fi

  if [ "\${CODEX_DESKTOP_RUN_COMPUTER_USE_DOCTOR:-0}" = "1" ] && [ -x "$backend" ]; then
    "$backend" doctor || true
  else
    echo "info: run CODEX_DESKTOP_RUN_COMPUTER_USE_DOCTOR=1 codex-desktop doctor to invoke the backend doctor"
  fi
}

doctor() {
  local missing=0
  local data_home="\${XDG_DATA_HOME:-$HOME/.local/share}"
  echo "Codex Desktop Linux doctor"
  echo "metadata: $metadata"
  echo "launcher log: $launcher_log"

  check_path "converted app launcher" "$app_launcher" || missing=1
  check_path "Electron runtime" "$app_dir/electron" || missing=1
  check_path "patched app.asar" "$app_dir/resources/app.asar" || missing=1
  check_path "managed Node runtime" "$app_dir/resources/node-runtime/bin/node" || missing=1
  check_path "desktop entry" "$data_home/applications/codex-desktop.desktop" || missing=1

  if has_command codex; then
    echo "ok: codex CLI: $(command -v codex)"
  else
    echo "missing: codex CLI. Install or expose @openai/codex before relying on desktop/app-server flows."
    missing=1
  fi

  if has_command chromium || has_command chromium-browser || has_command google-chrome || has_command google-chrome-stable; then
    echo "ok: Chromium/Chrome is available for browser research"
  elif flatpak_app_installed com.google.Chrome; then
    echo "ok: Google Chrome Flatpak is available for browser research"
    if [ -n "\${CODEX_CHROME_USER_DATA_DIR:-}" ]; then
      echo "ok: Chrome Flatpak profile: $CODEX_CHROME_USER_DATA_DIR"
    fi
  else
    echo "missing: Chromium/Chrome for browser research"
  fi

  if flatpak_app_installed com.google.Chrome; then
    local chrome_shim="\${XDG_CACHE_HOME:-$HOME/.cache}/codex-desktop/flatpak-bin/google-chrome"
    local chrome_host_name
    local chrome_manifest
    local chrome_wrapper
    local chrome_host_path
    chrome_host_name="$(chrome_plugin_metadata extensionHostName com.openai.codexextension)"
    chrome_manifest="$HOME/.var/app/com.google.Chrome/config/google-chrome/NativeMessagingHosts/$chrome_host_name.json"
    chrome_wrapper="$HOME/.var/app/com.google.Chrome/config/codex-desktop/$chrome_host_name"
    chrome_host_path="$(chrome_plugin_host_path || true)"
    check_path "Google Chrome Flatpak command shim" "$chrome_shim" || missing=1
    check_path "Google Chrome Flatpak native host wrapper" "$chrome_wrapper" || missing=1
    check_path "Google Chrome Flatpak native messaging manifest" "$chrome_manifest" || missing=1
    if flatpak_host_spawn_permission_enabled com.google.Chrome; then
      echo "ok: Google Chrome Flatpak host-spawn permission"
    else
      echo "missing: Google Chrome Flatpak host-spawn permission. Run: flatpak override --user --talk-name=org.freedesktop.Flatpak com.google.Chrome; then fully restart Chrome."
      missing=1
    fi
    if [ -n "$chrome_host_path" ] && [ -x "$chrome_host_path" ]; then
      echo "ok: Google Chrome native host binary: $chrome_host_path"
      if [ -f "$chrome_wrapper" ] && grep -F "$chrome_host_path" "$chrome_wrapper" >/dev/null 2>&1; then
        echo "ok: Google Chrome Flatpak native host wrapper targets current package"
      else
        echo "missing: Google Chrome Flatpak native host wrapper targets current package"
        missing=1
      fi
    else
      echo "missing: Google Chrome native host binary"
      missing=1
    fi
    chrome_extension_doctor || missing=1
  fi

  editor_doctor

  if is_bluefin_like; then
    case "\${CODEX_DESKTOP_LINUX_OZONE:-auto}" in
      wayland|WAYLAND)
        echo "ok: Bluefin rendering default overridden: Wayland"
        ;;
      x11|X11)
        echo "ok: Bluefin rendering default overridden: X11/XWayland"
        ;;
      *)
        echo "ok: Bluefin rendering default: X11/XWayland"
        ;;
    esac
  fi

  if [ -d "\${XDG_DATA_HOME:-$HOME/.local/share}/applications" ] ||
      mkdir -p "\${XDG_DATA_HOME:-$HOME/.local/share}/applications"; then
    echo "ok: user-local application directory is writable"
  else
    echo "missing: writable user-local application directory"
    missing=1
  fi

  computer_use_doctor

  return "$missing"
}

install_desktop_entry() {
  local data_home="\${XDG_DATA_HOME:-$HOME/.local/share}"
  local applications_dir="$data_home/applications"
  local icon_dir="$data_home/icons/hicolor/512x512/apps"
  local legacy_icon_dir="$data_home/icons/hicolor/256x256/apps"
  local desktop_target="$applications_dir/codex-desktop.desktop"
  local icon_target="$icon_dir/codex-desktop.png"
  local legacy_icon_target="$legacy_icon_dir/codex-desktop.png"
  local icon_source="$root/share/icons/hicolor/512x512/apps/codex-desktop.png"
  local legacy_icon_source="$root/share/icons/hicolor/256x256/apps/codex-desktop.png"
  local desktop_bin="\${CODEX_DESKTOP_BIN:-}"
  local desktop_contents

  if [ -z "$desktop_bin" ]; then
    desktop_bin="$(command -v codex-desktop 2>/dev/null || true)"
  fi
  if [ -z "$desktop_bin" ]; then
    desktop_bin="$(readlink -f "$script_path" 2>/dev/null || printf '%s\\n' "$script_path")"
  fi

  mkdir -p "$applications_dir" "$icon_dir" "$legacy_icon_dir"
  if [ -f "$icon_source" ]; then
    cp "$icon_source" "$icon_target"
  elif [ -f "$legacy_icon_source" ]; then
    cp "$legacy_icon_source" "$icon_target"
  fi
  if [ -f "$legacy_icon_source" ]; then
    cp "$legacy_icon_source" "$legacy_icon_target"
  fi

  desktop_contents="$(cat "$root/share/applications/codex-desktop.desktop")"
  desktop_contents="$(printf '%s\\n' "$desktop_contents" | sed "s|^Exec=.*|Exec=$desktop_bin desktop %U|")"
  if [ -f "$icon_target" ]; then
    desktop_contents="$(printf '%s\\n' "$desktop_contents" | sed "s|^Icon=.*|Icon=$icon_target|")"
  fi
  if printf '%s\\n' "$desktop_contents" | grep -q '^MimeType='; then
    desktop_contents="$(printf '%s\\n' "$desktop_contents" | sed 's|^MimeType=.*|MimeType=${linuxProtocolMimeTypes()}|')"
  else
    desktop_contents="$(printf '%s\\nMimeType=${linuxProtocolMimeTypes()}' "$desktop_contents")"
  fi
  printf '%s\\n' "$desktop_contents" > "$desktop_target"
  chmod 755 "$desktop_target"

  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$applications_dir" >/dev/null 2>&1 || true
  fi
  if command -v xdg-mime >/dev/null 2>&1; then
    xdg-mime default codex-desktop.desktop x-scheme-handler/codex >/dev/null 2>&1 || true
    xdg-mime default codex-desktop.desktop x-scheme-handler/codex-browser-sidebar >/dev/null 2>&1 || true
  fi

  echo "Installed user-local desktop entry: $desktop_target"
}

logs_mode() {
  case "\${1:-}" in
    --path|path)
      echo "$launcher_log"
      ;;
    -f|--follow|follow)
      mkdir -p "$(dirname "$launcher_log")"
      touch "$launcher_log"
      exec tail -n "\${CODEX_DESKTOP_LOG_LINES:-200}" -f "$launcher_log"
      ;;
    ""|tail)
      if [ ! -f "$launcher_log" ]; then
        echo "No launcher log yet: $launcher_log"
        return 0
      fi
      exec tail -n "\${CODEX_DESKTOP_LOG_LINES:-200}" "$launcher_log"
      ;;
    *)
      echo "Usage: codex-desktop logs [--follow|--path]" >&2
      exit 64
      ;;
  esac
}

launch_desktop() {
  if [ ! -x "$app_launcher" ]; then
    echo "Converted Codex Desktop launcher is missing or not executable: $app_launcher" >&2
    exit 70
  fi

  local -a args=("$@")
  local rendering_mode
  rendering_mode="$(desired_desktop_rendering_mode "\${args[@]}")"
  case "$rendering_mode" in
    safe)
      args=(--safe-mode "\${args[@]}")
      ;;
    x11)
      args=(--x11 "\${args[@]}")
      ;;
    wayland)
      args=(--wayland "\${args[@]}")
      ;;
  esac

  log_deep_link_args "\${args[@]}"
  unset ELECTRON_RUN_AS_NODE
  exec "$app_launcher" "\${args[@]}"
}

serve_mode() {
  if [ ! -x "$app_launcher" ]; then
    echo "Converted Codex Desktop launcher is missing or not executable: $app_launcher" >&2
    exit 70
  fi

  unset ELECTRON_RUN_AS_NODE
  exec "$app_launcher" serve "$@"
}

web_mode() {
  if [ ! -x "$app_launcher" ]; then
    echo "Converted Codex Desktop launcher is missing or not executable: $app_launcher" >&2
    exit 70
  fi

  if [ "\${1:-}" = "--inspect" ]; then
    unset ELECTRON_RUN_AS_NODE
    exec "$app_launcher" web --inspect
  fi

  echo "Browser renderer mode is served by: codex-desktop serve --workspace <path> --profile <path>" >&2
  exit 64
}

bridge_mode() {
  cat <<'BRIDGE'
The browser bridge is not started by the packaged desktop runtime yet.
The intended boundary is loopback-only and should connect to codex app-server
rather than reimplementing Codex client logic.
BRIDGE
}

case "\${1:-desktop}" in
  --help|-h|help)
    usage
    ;;
  desktop)
    shift
    prepare_runtime_path
    prepare_flatpak_browser_integration
    prepare_editor_integration
    launch_desktop "$@"
    ;;
  serve)
    shift
    prepare_runtime_path
    serve_mode "$@"
    ;;
  logs)
    shift
    logs_mode "$@"
    ;;
  web)
    shift
    web_mode "$@"
    ;;
  bridge)
    bridge_mode
    ;;
  doctor)
    prepare_runtime_path
    prepare_flatpak_browser_integration
    prepare_editor_integration
    doctor
    ;;
  install-desktop-entry)
    prepare_runtime_path
    install_desktop_entry
    ;;
  *)
    prepare_runtime_path
    launch_desktop "$@"
    ;;
esac
`
}

function desktopEntry() {
  return `[Desktop Entry]
Type=Application
Name=Codex Desktop
Comment=Run the converted Codex Desktop Electron app on Linux
Exec=codex-desktop desktop %U
Icon=codex-desktop
Terminal=false
Categories=Development;
MimeType=${linuxProtocolMimeTypes()}
StartupNotify=true
`
}

function sidebarSurfaceRule(sidebarSurfacePatch, key) {
  return sidebarSurfacePatch.rules.find((rule) => rule.key === key) ?? {
    patched: false,
    present: false,
    file: null,
  }
}

function rendererReport(
  rebuildReport,
  patchReport,
  linuxRendererCopyPatch,
  linuxSidebarSurfacePatch,
  linuxIconVisibilityPatch,
) {
  const settingsSidebarSurface = sidebarSurfaceRule(linuxSidebarSurfacePatch, "settings")
  const appShellSidebarSurface = sidebarSurfaceRule(linuxSidebarSurfacePatch, "app_shell")

  return {
    package: "codex-desktop-linux",
    browser_mode_status: "research",
    serves_extracted_renderer: false,
    loopback_only_default: true,
    extracted_webview_present: Boolean(rebuildReport?.appDir),
    main_bundle: patchReport?.mainBundle ?? null,
    patch_count: Array.isArray(patchReport?.patches) ? patchReport.patches.length : null,
    linux_renderer_copy_patched: linuxRendererCopyPatch.patched,
    linux_renderer_copy_replacements: linuxRendererCopyPatch.replacements,
    linux_renderer_copy_files: linuxRendererCopyPatch.files,
    linux_sidebar_surfaces_patched: linuxSidebarSurfacePatch.patched,
    linux_sidebar_surfaces_present: linuxSidebarSurfacePatch.present,
    linux_sidebar_surface_files: linuxSidebarSurfacePatch.files,
    linux_sidebar_surface_rules: linuxSidebarSurfacePatch.rules,
    linux_settings_sidebar_surface_patched: settingsSidebarSurface.patched,
    linux_settings_sidebar_surface_present: settingsSidebarSurface.present,
    linux_settings_sidebar_surface_files: settingsSidebarSurface.file ? [settingsSidebarSurface.file] : [],
    linux_app_shell_sidebar_surface_patched: appShellSidebarSurface.patched,
    linux_app_shell_sidebar_surface_present: appShellSidebarSurface.present,
    linux_app_shell_sidebar_surface_files: appShellSidebarSurface.file ? [appShellSidebarSurface.file] : [],
    linux_icon_visibility_patched: linuxIconVisibilityPatch.patched,
    linux_icon_visibility_present: linuxIconVisibilityPatch.present,
    linux_icon_visibility_file: linuxIconVisibilityPatch.file,
    linux_icon_visibility_rule: linuxIconVisibilityPatch.rule,
    next_steps: [
      "Serve the extracted webview assets from 127.0.0.1.",
      "Inventory Electron/preload globals expected by the renderer.",
      "Shim one native call path through a loopback bridge to codex app-server.",
    ],
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const appDir = resolve(requiredArg(args, "app-dir"))
  const version = requiredArg(args, "version")
  const outputPath = resolve(requiredArg(args, "output"))
  const conversionRepo = args["conversion-repo"] ?? DEFAULT_CONVERSION_REPO
  const conversionCommit = args["conversion-commit"] ?? DEFAULT_CONVERSION_COMMIT
  const codexDmg = args["codex-dmg"] ? resolve(args["codex-dmg"]) : undefined
  const iconSource = resolveIconSource(appDir, args.icon)
  const rebuildReportPath = args["rebuild-report"] ? resolve(args["rebuild-report"]) : undefined
  const patchReportPath = args["patch-report"] ? resolve(args["patch-report"]) : undefined
  const metadataOutput = args["metadata-output"] ? resolve(args["metadata-output"]) : undefined
  const computerUseUiEnabled = args["computer-use-ui-enabled"] === "true"

  assertConvertedApp(appDir)
  const linuxEditorOpenTargetsPatch = patchLinuxEditorOpenTargets(appDir)
  const linuxFeatureMainBundlePatches = patchLinuxFeatureMainBundles(appDir)
  const linuxRendererCopyPatch = patchLinuxRendererCopy(appDir)
  const linuxSidebarSurfacePatch = patchLinuxSidebarSurfaces(appDir)
  const linuxIconVisibilityPatch = patchLinuxIconVisibility(appDir)
  const linuxWebviewAppIconsCopy = copyLinuxWebviewAppIcons(appDir)
  const linuxWebviewServerStaleDetectionPatch = patchLinuxWebviewServerStaleDetection(appDir)

  if (codexDmg && !existsSync(codexDmg)) {
    throw new Error(`Codex DMG input does not exist: ${codexDmg}`)
  }

  const rebuildReport = readJsonIfPresent(rebuildReportPath)
  const patchReport = readJsonIfPresent(patchReportPath)
  const appTreeSha256 = hashDirectory(appDir)
  const settingsSidebarSurface = sidebarSurfaceRule(linuxSidebarSurfacePatch, "settings")
  const appShellSidebarSurface = sidebarSurfaceRule(linuxSidebarSurfacePatch, "app_shell")
  const computerUseBackend = join(
    appDir,
    "resources/plugins/openai-bundled/plugins/computer-use/bin/codex-computer-use-linux",
  )
  const metadata = {
    package: "codex-desktop-linux",
    version,
    upstream_conversion_repo: conversionRepo,
    upstream_conversion_commit: conversionCommit,
    codex_dmg_sha256: codexDmg ? sha256File(codexDmg) : null,
    electron_version: electronVersion(appDir, rebuildReport),
    electron_binary_sha256: sha256File(join(appDir, "electron")),
    managed_node_version: managedNodeVersion(appDir),
    managed_node_runtime_tree_sha256: existsSync(join(appDir, "resources/node-runtime"))
      ? hashDirectory(join(appDir, "resources/node-runtime"))
      : null,
    app_payload_tree_sha256: appTreeSha256,
    desktop_icon_source: iconSource ? iconSource.kind : null,
    desktop_icon_sha256: iconSource ? sha256File(iconSource.path) : null,
    computer_use_backend_included: fileIsExecutable(computerUseBackend),
    linux_computer_use_ui_enabled: computerUseUiEnabled,
    linux_editor_open_targets_patched: linuxEditorOpenTargetsPatch.patched,
    linux_editor_open_targets_main_bundle: linuxEditorOpenTargetsPatch.main_bundle,
    linux_editor_open_targets: linuxEditorOpenTargetsPatch.targets,
    linux_feature_main_bundle_patches: linuxFeatureMainBundlePatches,
    linux_renderer_copy_patched: linuxRendererCopyPatch.patched,
    linux_renderer_copy_replacements: linuxRendererCopyPatch.replacements,
    linux_renderer_copy_files: linuxRendererCopyPatch.files,
    linux_sidebar_surfaces_patched: linuxSidebarSurfacePatch.patched,
    linux_sidebar_surfaces_present: linuxSidebarSurfacePatch.present,
    linux_sidebar_surface_files: linuxSidebarSurfacePatch.files,
    linux_sidebar_surface_rules: linuxSidebarSurfacePatch.rules,
    linux_settings_sidebar_surface_patched: settingsSidebarSurface.patched,
    linux_settings_sidebar_surface_present: settingsSidebarSurface.present,
    linux_settings_sidebar_surface_files: settingsSidebarSurface.file ? [settingsSidebarSurface.file] : [],
    linux_app_shell_sidebar_surface_patched: appShellSidebarSurface.patched,
    linux_app_shell_sidebar_surface_present: appShellSidebarSurface.present,
    linux_app_shell_sidebar_surface_files: appShellSidebarSurface.file ? [appShellSidebarSurface.file] : [],
    linux_icon_visibility_patched: linuxIconVisibilityPatch.patched,
    linux_icon_visibility_present: linuxIconVisibilityPatch.present,
    linux_icon_visibility_file: linuxIconVisibilityPatch.file,
    linux_icon_visibility_rule: linuxIconVisibilityPatch.rule,
    linux_webview_app_icons_copied: linuxWebviewAppIconsCopy.copied,
    linux_webview_app_icons_source: linuxWebviewAppIconsCopy.source,
    linux_webview_app_icons_target: linuxWebviewAppIconsCopy.target,
    linux_webview_app_icons_files: linuxWebviewAppIconsCopy.files,
    linux_webview_server_stale_detection_patched: linuxWebviewServerStaleDetectionPatch.patched,
    linux_webview_server_stale_detection_file: linuxWebviewServerStaleDetectionPatch.file,
    linux_features_enabled: linuxFeaturesEnabled(),
    linux_protocol_schemes: LINUX_PROTOCOL_SCHEMES,
    updater_enabled: false,
    browser_mode_status: "research",
    artifact_role: "converted-dmg-linux-runtime",
    rebuild_report_included: Boolean(rebuildReport),
    patch_report_included: Boolean(patchReport),
  }

  const stageRoot = mkdtempSync(join(tmpdir(), "codex-desktop-linux-"))
  const packageDir = join(stageRoot, "package")
  const metadataDir = join(packageDir, "share/codex-desktop")

  try {
    mkdirSync(join(packageDir, "bin"), { recursive: true })
    mkdirSync(metadataDir, { recursive: true })
    mkdirSync(join(packageDir, "share/applications"), { recursive: true })
    mkdirSync(join(packageDir, "share/icons/hicolor/512x512/apps"), { recursive: true })
    mkdirSync(join(packageDir, "share/icons/hicolor/256x256/apps"), { recursive: true })

    cpSync(appDir, join(metadataDir, "app"), { recursive: true, dereference: false })
    writeExecutable(join(packageDir, "bin/codex-desktop"), launcherScript())
    writeFileSync(join(packageDir, "share/applications/codex-desktop.desktop"), desktopEntry(), { mode: 0o755 })
    if (iconSource) {
      copyIfExists(iconSource.path, join(packageDir, "share/icons/hicolor/512x512/apps/codex-desktop.png"))
      copyIfExists(iconSource.path, join(packageDir, "share/icons/hicolor/256x256/apps/codex-desktop.png"))
    }
    writeFileSync(join(metadataDir, "release.json"), `${JSON.stringify(metadata, null, 2)}\n`)
    writeFileSync(
      join(metadataDir, "renderer-report.json"),
      `${JSON.stringify(
        rendererReport(
          rebuildReport,
          patchReport,
          linuxRendererCopyPatch,
          linuxSidebarSurfacePatch,
          linuxIconVisibilityPatch,
        ),
        null,
        2,
      )}\n`,
    )

    if (rebuildReportPath && existsSync(rebuildReportPath)) {
      cpSync(rebuildReportPath, join(metadataDir, "rebuild-report.json"))
    }
    if (patchReportPath && existsSync(patchReportPath)) {
      cpSync(patchReportPath, join(metadataDir, "patch-report.json"))
    }
    if (metadataOutput) {
      mkdirSync(dirname(metadataOutput), { recursive: true })
      writeFileSync(metadataOutput, `${JSON.stringify(metadata, null, 2)}\n`)
    }

    mkdirSync(dirname(outputPath), { recursive: true })
    execFileSync(
      "tar",
      [
        "--sort=name",
        "--mtime=@0",
        "--owner=0",
        "--group=0",
        "--numeric-owner",
        "--use-compress-program=gzip -n",
        "-cf",
        outputPath,
        "-C",
        packageDir,
        ".",
      ],
      { stdio: "inherit" },
    )

    console.log(outputPath)
  } finally {
    rmSync(stageRoot, { recursive: true, force: true })
  }
}

main()

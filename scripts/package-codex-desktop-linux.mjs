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

const DEFAULT_CONVERSION_REPO = "https://github.com/ilysenko/codex-desktop-linux"
const DEFAULT_CONVERSION_COMMIT = "43c8bd1b5d4ab2eb4be8eb474528d6050c51db9a"

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
      "Usage: package-codex-desktop-linux.mjs --app-dir <converted-codex-app> --version <version> --output <tar.gz> [--codex-dmg <Codex.dmg>] [--rebuild-report <json>] [--patch-report <json>] [--metadata-output <json>]",
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

function launcherScript() {
  return `#!/usr/bin/env bash
set -euo pipefail

script_path="$(readlink -f "\${BASH_SOURCE[0]}")"
root="$(cd "$(dirname "$script_path")/.." && pwd)"
app_dir="$root/share/codex-desktop/app"
app_launcher="$app_dir/start.sh"
metadata="$root/share/codex-desktop/release.json"
renderer_report="$root/share/codex-desktop/renderer-report.json"

usage() {
  cat <<'USAGE'
Usage: codex-desktop [command] [args]

Commands:
  desktop                 Launch the converted Linux Electron Codex Desktop app
  web --inspect           Print browser-renderer research status for this build
  bridge                  Print loopback bridge status
  doctor                  Check Bluefin/Linux runtime readiness
  install-desktop-entry   Install user-local XDG desktop entry and icon
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

doctor() {
  local missing=0
  echo "Codex Desktop Linux doctor"
  echo "metadata: $metadata"

  check_path "converted app launcher" "$app_launcher" || missing=1
  check_path "Electron runtime" "$app_dir/electron" || missing=1
  check_path "patched app.asar" "$app_dir/resources/app.asar" || missing=1
  check_path "managed Node runtime" "$app_dir/resources/node-runtime/bin/node" || missing=1

  if has_command codex; then
    echo "ok: codex CLI: $(command -v codex)"
  else
    echo "missing: codex CLI. Install or expose @openai/codex before relying on desktop/app-server flows."
    missing=1
  fi

  if has_command chromium || has_command chromium-browser || has_command google-chrome || has_command google-chrome-stable; then
    echo "ok: Chromium/Chrome is available for browser research"
  else
    echo "missing: Chromium/Chrome for browser research"
  fi

  if [ -d "\${XDG_DATA_HOME:-$HOME/.local/share}/applications" ] ||
      mkdir -p "\${XDG_DATA_HOME:-$HOME/.local/share}/applications"; then
    echo "ok: user-local application directory is writable"
  else
    echo "missing: writable user-local application directory"
    missing=1
  fi

  return "$missing"
}

install_desktop_entry() {
  local data_home="\${XDG_DATA_HOME:-$HOME/.local/share}"
  mkdir -p "$data_home/applications" "$data_home/icons/hicolor/256x256/apps"
  cp "$root/share/applications/codex-desktop.desktop" "$data_home/applications/codex-desktop.desktop"
  if [ -f "$root/share/icons/hicolor/256x256/apps/codex-desktop.png" ]; then
    cp "$root/share/icons/hicolor/256x256/apps/codex-desktop.png" "$data_home/icons/hicolor/256x256/apps/codex-desktop.png"
  fi
  echo "Installed user-local desktop entry: $data_home/applications/codex-desktop.desktop"
}

launch_desktop() {
  if [ ! -x "$app_launcher" ]; then
    echo "Converted Codex Desktop launcher is missing or not executable: $app_launcher" >&2
    exit 70
  fi

  exec "$app_launcher" "$@"
}

web_mode() {
  if [ "\${1:-}" = "--inspect" ]; then
    cat "$renderer_report"
    return 0
  fi

  echo "Browser renderer mode is still research-only for this package. Run: codex-desktop web --inspect" >&2
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
    launch_desktop "$@"
    ;;
  web)
    shift
    web_mode "$@"
    ;;
  bridge)
    bridge_mode
    ;;
  doctor)
    doctor
    ;;
  install-desktop-entry)
    install_desktop_entry
    ;;
  *)
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
StartupNotify=true
`
}

function rendererReport(rebuildReport, patchReport) {
  return {
    package: "codex-desktop-linux",
    browser_mode_status: "research",
    serves_extracted_renderer: false,
    loopback_only_default: true,
    extracted_webview_present: Boolean(rebuildReport?.appDir),
    main_bundle: patchReport?.mainBundle ?? null,
    patch_count: Array.isArray(patchReport?.patches) ? patchReport.patches.length : null,
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
  const iconPath = args.icon ? resolve(args.icon) : join(appDir, ".codex-linux/codex-desktop.png")
  const rebuildReportPath = args["rebuild-report"] ? resolve(args["rebuild-report"]) : undefined
  const patchReportPath = args["patch-report"] ? resolve(args["patch-report"]) : undefined
  const metadataOutput = args["metadata-output"] ? resolve(args["metadata-output"]) : undefined

  assertConvertedApp(appDir)

  if (codexDmg && !existsSync(codexDmg)) {
    throw new Error(`Codex DMG input does not exist: ${codexDmg}`)
  }

  const rebuildReport = readJsonIfPresent(rebuildReportPath)
  const patchReport = readJsonIfPresent(patchReportPath)
  const appTreeSha256 = hashDirectory(appDir)
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
    mkdirSync(join(packageDir, "share/icons/hicolor/256x256/apps"), { recursive: true })

    cpSync(appDir, join(metadataDir, "app"), { recursive: true, dereference: false })
    writeExecutable(join(packageDir, "bin/codex-desktop"), launcherScript())
    writeFileSync(join(packageDir, "share/applications/codex-desktop.desktop"), desktopEntry())
    copyIfExists(iconPath, join(packageDir, "share/icons/hicolor/256x256/apps/codex-desktop.png"))
    writeFileSync(join(metadataDir, "release.json"), `${JSON.stringify(metadata, null, 2)}\n`)
    writeFileSync(
      join(metadataDir, "renderer-report.json"),
      `${JSON.stringify(rendererReport(rebuildReport, patchReport), null, 2)}\n`,
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

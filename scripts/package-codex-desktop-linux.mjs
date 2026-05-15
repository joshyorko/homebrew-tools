#!/usr/bin/env node

import { createHash } from "node:crypto"
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
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

function sha256(path) {
  const hash = createHash("sha256")
  hash.update(readFileSync(path))
  return hash.digest("hex")
}

function writeExecutable(path, contents) {
  writeFileSync(path, contents, { mode: 0o755 })
}

function launcherScript() {
  return `#!/bin/bash
set -euo pipefail

root="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
metadata="$root/share/codex-desktop/release.json"
renderer_report="$root/share/codex-desktop/renderer-report.json"
app_dir="$root/share/codex-desktop/app"

usage() {
  cat <<'USAGE'
Usage: codex-desktop [--help] <command>

Commands:
  desktop                 Launch the Linux Electron Codex Desktop runtime
  web [--inspect]         Research browser-renderer mode status
  bridge                  Start the loopback bridge placeholder
  doctor                  Check Bluefin/Linux runtime readiness
  install-desktop-entry   Install user-local XDG desktop entry and icon

This public tap artifact is metadata-only and does not redistribute the
proprietary Codex Desktop application payload. Build with an explicit Codex.dmg
input before expecting the Electron app bundle to exist.
USAGE
}

has_command() {
  command -v "$1" >/dev/null 2>&1
}

doctor() {
  local missing=0
  echo "Codex Desktop Linux doctor"
  echo "metadata: $metadata"

  if has_command codex; then
    echo "ok: codex CLI found at $(command -v codex)"
  else
    echo "missing: codex CLI (install it before launching desktop/app-server flows)"
    missing=1
  fi

  if has_command electron || [ -n "\${CODEX_DESKTOP_ELECTRON:-}" ]; then
    echo "ok: Electron runtime is discoverable"
  else
    echo "missing: Electron runtime (set CODEX_DESKTOP_ELECTRON or install electron)"
    missing=1
  fi

  if has_command chromium || has_command chromium-browser || has_command google-chrome || has_command google-chrome-stable; then
    echo "ok: Chromium/Chrome browser is discoverable for web research"
  else
    echo "missing: Chromium/Chrome browser for 'codex-desktop web --inspect'"
  fi

  if has_command xdg-open; then
    echo "ok: xdg-open found"
  else
    echo "missing: xdg-open for desktop/browser integration"
  fi

  if [ -d "$HOME/.local/share/applications" ] || mkdir -p "$HOME/.local/share/applications"; then
    echo "ok: user-local application directory is writable"
  else
    echo "missing: writable ~/.local/share/applications"
    missing=1
  fi

  return "$missing"
}

install_desktop_entry() {
  mkdir -p "$HOME/.local/share/applications" "$HOME/.local/share/icons/hicolor/scalable/apps"
  cp "$root/share/applications/codex-desktop.desktop" "$HOME/.local/share/applications/codex-desktop.desktop"
  cp "$root/share/icons/hicolor/scalable/apps/codex-desktop.svg" "$HOME/.local/share/icons/hicolor/scalable/apps/codex-desktop.svg"
  echo "Installed user-local desktop entry: $HOME/.local/share/applications/codex-desktop.desktop"
}

launch_desktop() {
  if [ ! -d "$app_dir" ]; then
    cat >&2 <<EOF_DESKTOP
Codex Desktop app payload is not installed at:
  $app_dir

This formula currently installs the conservative metadata/runtime skeleton only.
Use the Dagger Codex DMG inspection/conversion targets with an explicit official
Codex.dmg input to produce a private runtime artifact before launching desktop mode.
EOF_DESKTOP
    exit 64
  fi

  local electron="\${CODEX_DESKTOP_ELECTRON:-}"
  if [ -z "$electron" ]; then
    electron="$(command -v electron || true)"
  fi
  if [ -z "$electron" ]; then
    echo "Electron runtime not found. Set CODEX_DESKTOP_ELECTRON=/path/to/electron." >&2
    exit 69
  fi

  exec "$electron" "$app_dir" "$@"
}

web_mode() {
  if [ "\${1:-}" = "--inspect" ]; then
    echo "Renderer shim research report: $renderer_report"
    cat "$renderer_report"
    return 0
  fi

  echo "Browser renderer mode is research-only; run: codex-desktop web --inspect" >&2
  exit 64
}

bridge_mode() {
  cat <<'EOF_BRIDGE'
The loopback bridge is intentionally not started by this skeleton artifact.
Future bridge work must stay bound to 127.0.0.1 and should connect to the
supported 'codex app-server' boundary rather than bypassing authentication or
reimplementing Codex client logic.
EOF_BRIDGE
}

case "\${1:---help}" in
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
    usage >&2
    exit 64
    ;;
esac
`
}

function desktopEntry() {
  return `[Desktop Entry]
Type=Application
Name=Codex Desktop
Comment=Personal Linux runtime for the official Codex Desktop app
Exec=codex-desktop desktop %U
Icon=codex-desktop
Terminal=false
Categories=Development;
StartupNotify=true
`
}

function iconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="28" fill="#111827"/>
  <path d="M34 38h60v12H50v28h44v12H34z" fill="#f9fafb"/>
  <path d="M56 56h38v12H56z" fill="#60a5fa"/>
</svg>
`
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const outputPathArg = args.output
  const version = args.version
  const conversionCommit = args["conversion-commit"] ?? DEFAULT_CONVERSION_COMMIT
  const codexDmgArg = args["codex-dmg"]

  if (!outputPathArg || !version) {
    throw new Error(
      "Usage: package-codex-desktop-linux.mjs --version <version> --output <tar.gz> [--codex-dmg <Codex.dmg>] [--conversion-commit <sha>]",
    )
  }

  const outputPath = resolve(outputPathArg)
  const stageRoot = mkdtempSync(join(tmpdir(), "codex-desktop-linux-"))
  const packageDir = join(stageRoot, "package")
  const metadataDir = join(packageDir, "share/codex-desktop")
  const binDir = join(packageDir, "bin")
  const applicationsDir = join(packageDir, "share/applications")
  const iconDir = join(packageDir, "share/icons/hicolor/scalable/apps")

  try {
    mkdirSync(metadataDir, { recursive: true })
    mkdirSync(binDir, { recursive: true })
    mkdirSync(applicationsDir, { recursive: true })
    mkdirSync(iconDir, { recursive: true })

    const dmgPath = codexDmgArg ? resolve(codexDmgArg) : undefined
    if (dmgPath && !existsSync(dmgPath)) {
      throw new Error(`Codex DMG input does not exist: ${dmgPath}`)
    }

    const metadata = {
      package: "codex-desktop-linux",
      upstream_conversion_repo: DEFAULT_CONVERSION_REPO,
      upstream_conversion_commit: conversionCommit,
      codex_dmg_sha256: dmgPath ? sha256(dmgPath) : null,
      electron_version: null,
      managed_node_version: process.versions.node,
      updater_enabled: false,
      browser_mode_status: "research",
      redistributes_openai_payload: false,
      artifact_role: "metadata-only-runtime-skeleton",
    }

    const rendererReport = {
      status: "not_started",
      serves_extracted_renderer: false,
      loopback_only_default: true,
      codex_app_server_boundary: "planned",
      missing_research_questions: [
        "Detect renderer Electron/preload globals from an explicit Codex.dmg input",
        "Inventory IPC channels and native methods without copying proprietary source",
        "Test whether the extracted renderer loads from 127.0.0.1 in Chromium",
        "Shim one native/preload call path to a local loopback bridge",
      ],
    }

    writeFileSync(join(metadataDir, "release.json"), `${JSON.stringify(metadata, null, 2)}\n`)
    writeFileSync(join(metadataDir, "renderer-report.json"), `${JSON.stringify(rendererReport, null, 2)}\n`)
    writeFileSync(join(applicationsDir, "codex-desktop.desktop"), desktopEntry())
    writeFileSync(join(iconDir, "codex-desktop.svg"), iconSvg())
    writeExecutable(join(binDir, "codex-desktop"), launcherScript())

    if (dmgPath) {
      cpSync(dmgPath, join(metadataDir, "Codex.dmg.input"))
      rmSync(join(metadataDir, "Codex.dmg.input"), { force: true })
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

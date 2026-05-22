import test from "node:test"
import assert from "node:assert/strict"
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFileSync, spawnSync } from "node:child_process"

const repoRoot = new URL("../../..", import.meta.url)
const scriptPath = new URL("../../../scripts/package-codex-desktop-linux.mjs", import.meta.url)
const conversionPatchScriptPath = new URL(
  "../../../scripts/patch-codex-desktop-conversion.mjs",
  import.meta.url,
)

function writeExecutable(path: string, contents: string): void {
  writeFileSync(path, contents, { mode: 0o755 })
}

function symlinkSystemCommand(binDir: string, command: string): void {
  const target = existsSync(`/usr/bin/${command}`) ? `/usr/bin/${command}` : `/bin/${command}`
  symlinkSync(target, join(binDir, command))
}

function createConvertedAppFixture(root: string): string {
  const appDir = join(root, "codex-app")
  mkdirSync(join(appDir, "resources/node-runtime/bin"), { recursive: true })
  mkdirSync(join(appDir, "resources/plugins/openai-bundled/plugins/computer-use/bin"), { recursive: true })
  mkdirSync(join(appDir, "resources/plugins/openai-bundled/plugins/chrome/extension-host/linux/x64"), {
    recursive: true,
  })
  mkdirSync(join(appDir, "resources/plugins/openai-bundled/plugins/chrome/scripts"), { recursive: true })
  mkdirSync(join(appDir, ".codex-linux"), { recursive: true })
  mkdirSync(join(appDir, "content/webview/assets"), { recursive: true })
  mkdirSync(join(appDir, "content/webview/apps"), { recursive: true })

  writeExecutable(
    join(appDir, "start.sh"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "if [ \"${1:-}\" = web ] && [ \"${2:-}\" = --inspect ]; then",
      "  printf '%s\\n' '{\"package\":\"codex-desktop-linux\",\"mode\":\"devcontainer-web\",\"loopback_only_default\":true}'",
      "  exit 0",
      "fi",
      "if [ \"${1:-}\" = web ]; then",
      "  echo 'codex-desktop web is now served by: codex-desktop serve --workspace <path> --profile <path>' >&2",
      "  exit 64",
      "fi",
      "echo \"fixture desktop launch:$*\"",
      "echo \"fixture codex path:$(command -v codex || true)\"",
      "echo \"fixture chrome user data:${CODEX_CHROME_USER_DATA_DIR:-}\"",
      "echo \"fixture editor:${EDITOR:-}\"",
      "pid_is_stale_webview_server() {",
      "    local pid=\"$1\"",
      "    local cwd",
      "    local deleted_webview_dir",
      "",
      "    pid_has_webview_server_cmdline \"$pid\" || return 1",
      "    cwd=\"$(readlink -f \"/proc/$pid/cwd\" 2>/dev/null || true)\"",
      "    deleted_webview_dir=\"$(canonical_path \"$WEBVIEW_DIR\") (deleted)\"",
      "    [ \"$cwd\" = \"$deleted_webview_dir\" ]",
      "}",
      "",
    ].join("\n"),
  )
  writeExecutable(join(appDir, "electron"), "#!/usr/bin/env bash\necho electron fixture\n")
  writeExecutable(
    join(appDir, "resources/node-runtime/bin/node"),
    [
      "#!/usr/bin/env bash",
      "case \"${1:-}\" in",
      "  -v) echo v22.22.2 ;;",
      "  *check-extension-installed.js) echo '{\"installed\":true,\"registered\":true,\"enabled\":true}' ;;",
      "  *) echo node fixture ;;",
      "esac",
      "",
    ].join("\n"),
  )
  writeExecutable(
    join(appDir, "resources/plugins/openai-bundled/plugins/computer-use/bin/codex-computer-use-linux"),
    "#!/usr/bin/env bash\necho computer use fixture\n",
  )
  writeExecutable(
    join(appDir, "resources/plugins/openai-bundled/plugins/computer-use/bin/codex-computer-use-cosmic"),
    "#!/usr/bin/env bash\necho cosmic fixture\n",
  )
  writeExecutable(
    join(appDir, "resources/plugins/openai-bundled/plugins/chrome/extension-host/linux/x64/extension-host"),
    "#!/usr/bin/env bash\necho chrome native host fixture\n",
  )
  writeFileSync(
    join(appDir, "resources/plugins/openai-bundled/plugins/chrome/scripts/extension-id.json"),
    `${JSON.stringify({ extensionId: "hehggadaopoacecdllhhajmbjkdcmajg", extensionHostName: "com.openai.codexextension" })}\n`,
  )
  writeFileSync(
    join(appDir, "resources/plugins/openai-bundled/plugins/chrome/scripts/check-extension-installed.js"),
    "#!/usr/bin/env node\n",
  )
  writeFileSync(join(appDir, "resources/app.asar"), "fixture-asar")
  writeFileSync(join(appDir, "version"), "41.3.0\n")
  writeFileSync(join(appDir, ".codex-linux/codex-desktop.png"), "fallback-linux-icon")
  writeFileSync(join(appDir, ".codex-linux/remote-control-hosts.mjs"), "#!/usr/bin/env node\nconsole.log('remote hosts fixture')\n")
  writeFileSync(join(appDir, "content/webview/assets/app-fixture_hash.png"), "official-app-icon")
  writeFileSync(join(appDir, "content/webview/apps/vscode.png"), "vscode-icon")
  writeFileSync(join(appDir, "content/webview/apps/vscode-insiders.png"), "vscode-insiders-icon")
  writeFileSync(join(appDir, "content/webview/apps/file-explorer.png"), "file-explorer-icon")
  writeFileSync(
    join(appDir, "content/webview/assets/app-main-fixture.css"),
    [
      "body{background-color:#0000}",
      "[data-codex-window-type=electron]:not([data-codex-os=win32]) body{background:0 0}",
      "[data-codex-window-type=electron]:not([data-codex-os=win32]) .app-shell-left-panel{background:color-mix(in srgb, var(--color-token-editor-background) 55%, transparent)}",
      ".main-surface{background-color:var(--color-token-main-surface-primary)}",
      "",
    ].join("\n"),
  )
  writeFileSync(
    join(appDir, "content/webview/assets/remote-connections-settings-fixture.js"),
    [
      "const sshTitle = `SSH connections from this Mac`",
      "",
    ].join("\n"),
  )

  return appDir
}

test("codex desktop artifact packages a converted DMG app layout", () => {
  const tmp = mkdtempSync(join(tmpdir(), "codex-desktop-test-"))
  const output = join(tmp, "codex-desktop-linux-test.tar.gz")
  const extractDir = join(tmp, "extract")
  const appDir = createConvertedAppFixture(tmp)
  const dmgPath = join(tmp, "Codex.dmg")
  const rebuildReportPath = join(tmp, "rebuild-report.json")
  const patchReportPath = join(tmp, "patch-report.json")
  const metadataOutput = join(tmp, "metadata.json")

  try {
    writeFileSync(dmgPath, "fixture-dmg")
    writeFileSync(
      rebuildReportPath,
      `${JSON.stringify({ electronVersion: "41.3.0", appDir }, null, 2)}\n`,
    )
    writeFileSync(
      patchReportPath,
      `${JSON.stringify({ mainBundle: "main.js", patches: [{ id: "linux-launch", status: "changed" }] }, null, 2)}\n`,
    )

    execFileSync(
      process.execPath,
      [
        scriptPath.pathname,
        "--app-dir",
        appDir,
        "--version",
        "dmg.test",
        "--conversion-commit",
        "3a419707886b680db15f2694299fa406a93b1878",
        "--codex-dmg",
        dmgPath,
        "--rebuild-report",
        rebuildReportPath,
        "--patch-report",
        patchReportPath,
        "--metadata-output",
        metadataOutput,
        "--output",
        output,
      ],
      { cwd: repoRoot.pathname, stdio: "inherit" },
    )

    execFileSync("mkdir", ["-p", extractDir])
    execFileSync("tar", ["-xzf", output, "-C", extractDir])

    const metadata = JSON.parse(readFileSync(join(extractDir, "share/codex-desktop/release.json"), "utf8"))
    assert.equal(metadata.package, "codex-desktop-linux")
    assert.equal(metadata.updater_enabled, false)
    assert.equal(metadata.electron_version, "41.3.0")
    assert.equal(metadata.managed_node_version, "v22.22.2")
    assert.equal(metadata.desktop_icon_source, "official-webview-app-asset")
    assert.equal(metadata.computer_use_backend_included, true)
    assert.equal(metadata.linux_computer_use_ui_enabled, false)
    assert.match(metadata.codex_dmg_sha256, /^[a-f0-9]{64}$/)
    assert.equal(metadata.linux_renderer_copy_patched, true)
    assert.equal(metadata.linux_sidebar_surfaces_patched, true)
    assert.equal(metadata.linux_sidebar_surfaces_present, true)
    assert.equal(metadata.linux_settings_sidebar_surface_patched, true)
    assert.equal(metadata.linux_settings_sidebar_surface_present, true)
    assert.equal(metadata.linux_app_shell_sidebar_surface_patched, true)
    assert.equal(metadata.linux_app_shell_sidebar_surface_present, true)
    assert.equal(metadata.linux_icon_visibility_patched, true)
    assert.equal(metadata.linux_icon_visibility_present, true)
    assert.equal(metadata.linux_webview_app_icons_copied, true)
    assert.deepEqual(metadata.linux_webview_app_icons_files, [
      "content/webview/assets/apps/file-explorer.png",
      "content/webview/assets/apps/vscode-insiders.png",
      "content/webview/assets/apps/vscode.png",
    ])
    assert.equal(metadata.linux_webview_server_stale_detection_patched, true)
    assert.equal(metadata.linux_webview_server_stale_detection_file, "start.sh")
    assert.equal(metadata.linux_remote_mobile_control_autostart_marker, false)
    assert.deepEqual(metadata.linux_features_enabled, [])
    assert.deepEqual(metadata.linux_feature_main_bundle_patches, [])
    assert.deepEqual(metadata.linux_protocol_schemes, ["codex", "codex-browser-sidebar"])

    const exportedMetadata = JSON.parse(readFileSync(metadataOutput, "utf8"))
    assert.equal(exportedMetadata.app_payload_tree_sha256, metadata.app_payload_tree_sha256)
    assert.equal(exportedMetadata.linux_renderer_copy_patched, true)
    assert.equal(exportedMetadata.linux_sidebar_surfaces_present, true)
    assert.equal(exportedMetadata.linux_settings_sidebar_surface_present, true)
    assert.equal(exportedMetadata.linux_app_shell_sidebar_surface_present, true)

    assert.equal(
      readFileSync(join(extractDir, "share/icons/hicolor/512x512/apps/codex-desktop.png"), "utf8"),
      "official-app-icon",
    )
    assert.equal(
      readFileSync(join(extractDir, "share/icons/hicolor/256x256/apps/codex-desktop.png"), "utf8"),
      "official-app-icon",
    )
    assert.equal(
      readFileSync(join(extractDir, "share/codex-desktop/app/content/webview/assets/apps/vscode.png"), "utf8"),
      "vscode-icon",
    )
    assert.equal(
      readFileSync(
        join(extractDir, "share/codex-desktop/app/content/webview/assets/apps/vscode-insiders.png"),
        "utf8",
      ),
      "vscode-insiders-icon",
    )
    assert.equal(
      readFileSync(
        join(extractDir, "share/codex-desktop/app/content/webview/assets/apps/file-explorer.png"),
        "utf8",
      ),
      "file-explorer-icon",
    )
    const launcher = readFileSync(join(extractDir, "share/codex-desktop/app/start.sh"), "utf8")
    assert.match(launcher, /current_webview_dir="\$\(canonical_path "\$WEBVIEW_DIR"\)"/)
    assert.match(launcher, /\[ -z "\$cwd" \] \|\| \[ "\$cwd" != "\$current_webview_dir" \]/)

    const report = JSON.parse(readFileSync(join(extractDir, "share/codex-desktop/renderer-report.json"), "utf8"))
    assert.equal(report.loopback_only_default, true)
    assert.equal(report.serves_extracted_renderer, false)
    assert.equal(report.patch_count, 1)
    assert.equal(report.linux_renderer_copy_patched, true)
    assert.equal(report.linux_sidebar_surfaces_present, true)
    assert.equal(report.linux_settings_sidebar_surface_present, true)
    assert.equal(report.linux_app_shell_sidebar_surface_present, true)
    assert.equal(report.linux_icon_visibility_patched, true)
    assert.equal(report.linux_icon_visibility_present, true)

    const rendererCopy = readFileSync(
      join(extractDir, "share/codex-desktop/app/content/webview/assets/remote-connections-settings-fixture.js"),
      "utf8",
    )
    assert.doesNotMatch(rendererCopy, /SSH connections from this Mac/)
    assert.match(rendererCopy, /SSH connections from this computer/)

    const settingsCss = readFileSync(
      join(extractDir, "share/codex-desktop/app/content/webview/assets/app-main-fixture.css"),
      "utf8",
    )
    assert.match(
      settingsCss,
      /\[data-codex-window-type=electron\]\[data-codex-os=linux\] \.window-fx-sidebar-surface\{background:var\(--color-token-bg-primary\)\}/,
    )
    assert.match(
      settingsCss,
      /\[data-codex-window-type=electron\]\[data-codex-os=linux\] \.app-shell-left-panel\{background:var\(--color-token-bg-primary\)\}/,
    )
    assert.match(
      settingsCss,
      /\[data-codex-window-type=electron\]\[data-codex-os=linux\] \[role=menu\] \[role=menuitem\] :is\(img,svg\)\{width:20px;height:20px;min-width:20px;min-height:20px\}/,
    )

    const help = execFileSync(join(extractDir, "bin/codex-desktop"), ["--help"], { encoding: "utf8" })
    assert.match(help, /Usage: codex-desktop/)
    assert.match(help, /desktop/)
    assert.match(help, /serve/)
    assert.match(help, /remote-control hosts/)

    const remoteControlHosts = execFileSync(join(extractDir, "bin/codex-desktop"), ["remote-control", "hosts", "--help"], { encoding: "utf8" })
    assert.match(remoteControlHosts, /fixture desktop launch:remote-control hosts --help/)

    const serveOsReleasePath = join(tmp, "serve-os-release")
    writeFileSync(serveOsReleasePath, "NAME=Bluefin\nVARIANT_ID=bluefin\nID_LIKE=\"ublue fedora\"\n")
    const serve = execFileSync(join(extractDir, "bin/codex-desktop"), ["serve", "--smoke"], {
      encoding: "utf8",
      env: {
        ...process.env,
        CODEX_DESKTOP_OS_RELEASE_FILE: serveOsReleasePath,
      },
    })
    assert.match(serve, /fixture desktop launch:serve --smoke/)
    assert.doesNotMatch(serve, /fixture desktop launch:--x11 serve --smoke/)

    const webInspect = JSON.parse(
      execFileSync(join(extractDir, "bin/codex-desktop"), ["web", "--inspect"], { encoding: "utf8" }),
    )
    assert.equal(webInspect.mode, "devcontainer-web")
    assert.equal(webInspect.loopback_only_default, true)

    const webLaunch = spawnSync(join(extractDir, "bin/codex-desktop"), ["web"], { encoding: "utf8" })
    assert.equal(webLaunch.status, 64)
    assert.match(webLaunch.stderr, /codex-desktop serve --workspace/)

    const dataHome = join(tmp, "xdg-data")
    const cacheHome = join(tmp, "xdg-cache")
    const caskPrefix = join(tmp, "homebrew")
    const caskRoot = join(caskPrefix, "Caskroom/codex-desktop/dmg.test")
    const flatpakBin = join(tmp, ".local/bin")
    const pathBin = join(tmp, "path-bin")
    const flatpakChromeProfile = join(tmp, ".var/app/com.google.Chrome/config/google-chrome")
    const osReleasePath = join(tmp, "os-release")
    const nonBluefinOsReleasePath = join(tmp, "non-bluefin-os-release")
    writeFileSync(nonBluefinOsReleasePath, "NAME=Debian\nID=debian\n")

    const launch = execFileSync(join(extractDir, "bin/codex-desktop"), ["desktop", "--smoke"], {
      encoding: "utf8",
      env: {
        ...process.env,
        CODEX_DESKTOP_OS_RELEASE_FILE: nonBluefinOsReleasePath,
      },
    })
    assert.match(launch, /fixture desktop launch:--smoke/)
    const deepLinkLaunch = execFileSync(
      join(extractDir, "bin/codex-desktop"),
      ["desktop", "codex://threads/new?prompt=secret&foo=bar", "--smoke"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          CODEX_DESKTOP_OS_RELEASE_FILE: nonBluefinOsReleasePath,
          XDG_CACHE_HOME: cacheHome,
        },
      },
    )
    assert.match(deepLinkLaunch, /fixture desktop launch:codex:\/\/threads\/new\?prompt=secret&foo=bar --smoke/)
    const launcherLog = readFileSync(join(cacheHome, "codex-desktop/launcher.log"), "utf8")
    assert.match(launcherLog, /deep-link args: codex:\/\/threads\/new\?query_keys=foo,prompt/)
    assert.doesNotMatch(launcherLog, /secret/)
    mkdirSync(join(caskPrefix, "bin"), { recursive: true })
    mkdirSync(caskRoot, { recursive: true })
    mkdirSync(join(flatpakChromeProfile, "Default"), { recursive: true })
    mkdirSync(join(flatpakChromeProfile, "NativeMessagingHosts"), { recursive: true })
    mkdirSync(flatpakBin, { recursive: true })
    mkdirSync(pathBin, { recursive: true })
    for (const command of [
      "bash",
      "cat",
      "chmod",
      "date",
      "dirname",
      "grep",
      "head",
      "id",
      "mkdir",
      "paste",
      "pwd",
      "readlink",
      "sed",
      "sort",
      "touch",
      "tr",
      "uname",
    ]) {
      symlinkSystemCommand(pathBin, command)
    }
    cpSync(join(extractDir, "bin"), join(caskRoot, "bin"), { recursive: true })
    cpSync(join(extractDir, "share"), join(caskRoot, "share"), { recursive: true })
    writeExecutable(join(caskPrefix, "bin/codex"), "#!/usr/bin/env bash\necho codex cli fixture\n")
    writeExecutable(join(caskPrefix, "bin/code-insiders"), "#!/usr/bin/env bash\necho code insiders fixture\n")
    writeExecutable(
      join(flatpakBin, "flatpak"),
      [
        "#!/usr/bin/env bash",
        "printf '%s\\n' \"$*\" >> \"$HOME/flatpak.log\"",
        "case \"${1:-}:${2:-}\" in",
        "  info:com.google.Chrome) exit 0 ;;",
        "  info:--show-permissions)",
        "    [ \"${3:-}\" = com.google.Chrome ] || exit 1",
        "    printf '[Context]\\nfilesystems=home;\\n\\n[Session Bus Policy]\\n'",
        "    [ -f \"$HOME/flatpak-host-spawn-enabled\" ] && printf 'org.freedesktop.Flatpak=talk\\n'",
        "    exit 0",
        "    ;;",
        "  override:--user)",
        "    case \"$*\" in",
        "      *'--talk-name=org.freedesktop.Flatpak com.google.Chrome'*) touch \"$HOME/flatpak-host-spawn-enabled\"; exit 0 ;;",
        "    esac",
        "    exit 1",
        "    ;;",
        "  run:com.google.Chrome) shift 2; echo flatpak chrome launch:\"$@\" ;;",
        "  *) exit 1 ;;",
        "esac",
      ].join("\n"),
    )
    mkdirSync(join(flatpakChromeProfile, "Default/Extensions/hehggadaopoacecdllhhajmbjkdcmajg/1.1.4_0"), {
      recursive: true,
    })
    writeFileSync(
      join(flatpakChromeProfile, "Default/Preferences"),
      `${JSON.stringify({
        extensions: {
          settings: {
            hehggadaopoacecdllhhajmbjkdcmajg: {
              state: 1,
            },
          },
        },
      })}\n`,
    )
    writeFileSync(osReleasePath, "NAME=Bluefin\nVARIANT_ID=bluefin\nID_LIKE=\"ublue fedora\"\n")

    const bluefinWaylandEnv = {
      HOME: tmp,
      PATH: pathBin,
      XDG_CACHE_HOME: cacheHome,
      XDG_DATA_HOME: dataHome,
      XDG_SESSION_TYPE: "wayland",
      WAYLAND_DISPLAY: "wayland-0",
      XDG_CURRENT_DESKTOP: "GNOME",
      CODEX_DESKTOP_OS_RELEASE_FILE: osReleasePath,
    }

    const appGridLaunch = execFileSync(join(caskRoot, "bin/codex-desktop"), ["desktop", "--smoke"], {
      encoding: "utf8",
      env: bluefinWaylandEnv,
    })
    assert.match(appGridLaunch, /fixture desktop launch:--x11 --smoke/)
    assert.match(appGridLaunch, /fixture codex path:.*\/homebrew\/bin\/codex/)
    assert.match(appGridLaunch, new RegExp(`fixture chrome user data:${flatpakChromeProfile}`))
    assert.match(appGridLaunch, /fixture editor:.*\/homebrew\/bin\/code-insiders/)

    const flatpakShim = readFileSync(join(cacheHome, "codex-desktop/flatpak-bin/google-chrome"), "utf8")
    assert.match(flatpakShim, /flatpak run com\.google\.Chrome/)
    const flatpakChromeShim = readFileSync(join(cacheHome, "codex-desktop/flatpak-bin/chrome"), "utf8")
    assert.match(flatpakChromeShim, /flatpak run com\.google\.Chrome/)
    assert.match(
      readFileSync(join(tmp, "flatpak.log"), "utf8"),
      /override --user --talk-name=org\.freedesktop\.Flatpak com\.google\.Chrome/,
    )

    const nativeHostWrapperPath = join(
      tmp,
      ".var/app/com.google.Chrome/config/codex-desktop/com.openai.codexextension",
    )
    const nativeHostWrapper = readFileSync(nativeHostWrapperPath, "utf8")
    assert.match(nativeHostWrapper, /flatpak-spawn --host/)
    assert.match(nativeHostWrapper, /extension-host/)
    assert.match(
      nativeHostWrapper,
      new RegExp(`${caskRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/share/codex-desktop/app/resources/plugins/openai-bundled/plugins/chrome/extension-host/linux/x64/extension-host`),
    )

    const flatpakManifest = JSON.parse(
      readFileSync(
        join(flatpakChromeProfile, "NativeMessagingHosts/com.openai.codexextension.json"),
        "utf8",
      ),
    )
    assert.equal(flatpakManifest.name, "com.openai.codexextension")
    assert.equal(flatpakManifest.path, nativeHostWrapperPath)
    assert.deepEqual(flatpakManifest.allowed_origins, [
      "chrome-extension://hehggadaopoacecdllhhajmbjkdcmajg/",
    ])

    const ozoneWaylandLaunch = execFileSync(join(caskRoot, "bin/codex-desktop"), ["desktop", "--smoke"], {
      encoding: "utf8",
      env: {
        ...bluefinWaylandEnv,
        CODEX_DESKTOP_LINUX_OZONE: "wayland",
      },
    })
    assert.match(ozoneWaylandLaunch, /fixture desktop launch:--wayland --smoke/)
    assert.doesNotMatch(ozoneWaylandLaunch, /fixture desktop launch:--x11 --wayland/)

    const explicitWaylandLaunch = execFileSync(
      join(caskRoot, "bin/codex-desktop"),
      ["desktop", "--wayland", "--smoke"],
      {
        encoding: "utf8",
        env: bluefinWaylandEnv,
      },
    )
    assert.match(explicitWaylandLaunch, /fixture desktop launch:--wayland --smoke/)
    assert.doesNotMatch(explicitWaylandLaunch, /fixture desktop launch:--x11 --wayland/)

    const explicitX11Launch = execFileSync(join(caskRoot, "bin/codex-desktop"), ["desktop", "--x11", "--smoke"], {
      encoding: "utf8",
      env: bluefinWaylandEnv,
    })
    assert.match(explicitX11Launch, /fixture desktop launch:--x11 --smoke/)
    assert.doesNotMatch(explicitX11Launch, /--x11 --x11/)

    const desktopInstall = execFileSync(join(extractDir, "bin/codex-desktop"), ["install-desktop-entry"], {
      encoding: "utf8",
      env: {
        ...process.env,
        CODEX_DESKTOP_BIN: "/home/linuxbrew/.linuxbrew/bin/codex-desktop",
        XDG_DATA_HOME: dataHome,
      },
    })
    assert.match(desktopInstall, /Installed user-local desktop entry/)

    const desktopEntry = readFileSync(join(dataHome, "applications/codex-desktop.desktop"), "utf8")
    assert.match(desktopEntry, /^Exec=\/home\/linuxbrew\/\.linuxbrew\/bin\/codex-desktop desktop %U$/m)
    assert.match(desktopEntry, /^Icon=.*\/icons\/hicolor\/512x512\/apps\/codex-desktop\.png$/m)
    assert.match(desktopEntry, /^MimeType=x-scheme-handler\/codex;x-scheme-handler\/codex-browser-sidebar;$/m)
    assert.equal(statSync(join(dataHome, "applications/codex-desktop.desktop")).mode & 0o111, 0o111)
    assert.ok(existsSync(join(dataHome, "icons/hicolor/512x512/apps/codex-desktop.png")))
    assert.ok(existsSync(join(dataHome, "icons/hicolor/256x256/apps/codex-desktop.png")))

    const doctor = execFileSync(join(caskRoot, "bin/codex-desktop"), ["doctor"], {
      encoding: "utf8",
      env: bluefinWaylandEnv,
    })
    assert.match(doctor, /ok: Codex Chrome extension detected and enabled/)
    assert.match(doctor, /ok: Google Chrome Flatpak host-spawn permission/)
    assert.match(doctor, /ok: Google Chrome Flatpak native host wrapper targets current package/)
    assert.match(doctor, /ok: editor command code-insiders: .*\/homebrew\/bin\/code-insiders/)
    assert.match(doctor, /ok: EDITOR: .*\/homebrew\/bin\/code-insiders/)

    const logPath = execFileSync(join(extractDir, "bin/codex-desktop"), ["logs", "--path"], {
      encoding: "utf8",
      env: {
        ...process.env,
        XDG_CACHE_HOME: cacheHome,
      },
    }).trim()
    assert.equal(logPath, join(cacheHome, "codex-desktop/launcher.log"))
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("public codex desktop cask is disabled and points users to local install", () => {
  const cask = readFileSync(new URL("../../../Casks/codex-desktop.rb", import.meta.url), "utf8")
  const formula = readFileSync(new URL("../../../Formula/codex-desktop-linux-builder.rb", import.meta.url), "utf8")

  assert.match(cask, /cask "codex-desktop"/)
  assert.match(cask, /version "local-only"/)
  assert.match(cask, /disable! date: "2026-05-20"/)
  assert.match(cask, /converted Codex Desktop app artifacts are no longer distributed/)
  assert.match(cask, /brew install --HEAD joshyorko\/tools\/codex-desktop-linux-builder/)
  assert.match(cask, /codex-desktop-linux-builder/)
  assert.doesNotMatch(cask, /releases\/download\/codex-desktop-linux/)
  assert.doesNotMatch(cask, /binary "bin\/codex-desktop"/)
  assert.match(formula, /class CodexDesktopLinuxBuilder < Formula/)
  assert.match(formula, /head "https:\/\/github\.com\/joshyorko\/homebrew-tools\.git"/)
  assert.match(formula, /depends_on "dagger"/)
  assert.match(formula, /scripts\/install-codex-desktop-local\.sh/)
  assert.doesNotMatch(formula, /releases\/download\/codex-desktop-linux/)
})

test("codex desktop is local-only and not published by tap automation", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/tap-auto-update.yml", import.meta.url), "utf8")
  const pipeline = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8")
  const slots = readFileSync(new URL("../auto-update-slots.json", import.meta.url), "utf8")
  const localInstaller = readFileSync(new URL("../../../scripts/install-codex-desktop-local.sh", import.meta.url), "utf8")
  const localUninstaller = readFileSync(new URL("../../../scripts/uninstall-codex-desktop-local.sh", import.meta.url), "utf8")
  const makefile = readFileSync(new URL("../../../Makefile", import.meta.url), "utf8")
  const packageScript = readFileSync(new URL("../../../scripts/package-codex-desktop-linux.mjs", import.meta.url), "utf8")
  const defaultConversionRef = readFileSync(new URL("../../../codex-desktop-conversion.ref", import.meta.url), "utf8").trim()

  assert.doesNotMatch(workflow, /repository_dispatch:/)
  assert.doesNotMatch(workflow, /codex-desktop-linux-ready/)
  assert.doesNotMatch(slots, /codex-desktop-2h/)
  assert.doesNotMatch(slots, /codex-desktop-linux/)
  assert.doesNotMatch(workflow, /13 \*\/2 \* \* \*/)
  assert.match(pipeline, /codex-desktop-linux is local-only and must not be published as a release bundle/)
  assert.match(pipeline, /codex-desktop-linux is local-only and must not be published as release metadata/)
  assert.match(pipeline, /codexDesktopLocalBundle/)
  assert.match(pipeline, /CODEX_DESKTOP_LOCAL_ARTIFACT/)
  assert.match(pipeline, /No converted Codex Desktop app payload is distributed by the tap/)
  assert.match(localInstaller, /codex-desktop-local-bundle/)
  assert.match(localInstaller, /CODEX_DESKTOP_CONVERSION_COMMIT/)
  assert.match(localInstaller, /CODEX_DESKTOP_CONVERSION_REF_FILE/)
  assert.match(localInstaller, /read_default_conversion_ref/)
  assert.match(localInstaller, /CODEX_DESKTOP_CONVERSION_REPO/)
  assert.match(localInstaller, /Requested Codex Desktop Linux conversion ref/)
  assert.match(localInstaller, /Resolved Codex Desktop Linux conversion commit/)
  assert.match(localInstaller, /Resolved upstream Codex\.dmg metadata/)
  assert.match(localInstaller, /git ls-remote --exit-code "\$conversion_repo"/)
  assert.match(localInstaller, /--codex-desktop-dmg-cache-buster=\$dmg_cache_buster/)
  assert.match(localInstaller, /Built Codex Desktop Linux conversion commit/)
  assert.match(localInstaller, /brew tap-new --no-git "\$temp_tap_name"/)
  assert.match(localInstaller, /brew untap --force "\$temp_tap_name"/)
  assert.match(localInstaller, /cp "\$cask_file" "\$temp_tap_dir\/Casks\/codex-desktop\.rb"/)
  assert.match(localInstaller, /brew ruby -- -e/)
  assert.match(localInstaller, /Generated cask does not contain local artifact URL placeholder/)
  assert.match(localInstaller, /"file:\/\/" \+ artifact/)
  assert.match(localInstaller, /brew reinstall --cask --force "\$local_cask_token"/)
  assert.match(localInstaller, /brew install --cask "\$local_cask_token"/)
  assert.match(localInstaller, /rm -rf "\$bundle_dir"/)
  assert.match(localInstaller, /CODEX_DESKTOP_LOCAL_ARTIFACT="\$artifact"/)
  assert.match(localUninstaller, /brew uninstall --cask codex-desktop/)
  assert.match(localUninstaller, /\.local\/share\/applications\/codex-desktop\.desktop/)
  assert.match(localUninstaller, /\.local\/share\/icons\/hicolor\/512x512\/apps\/codex-desktop\.png/)
  assert.match(localUninstaller, /\.config\/codex-desktop/)
  assert.match(localUninstaller, /\.cache\/codex-desktop/)
  assert.match(localUninstaller, /\.local\/state\/codex-desktop/)
  assert.match(localUninstaller, /codex-local\\\/codex-desktop-local-/)
  assert.doesNotMatch(localUninstaller, /\.codex"/)
  assert.match(makefile, /codex-desktop-install:/)
  assert.equal(defaultConversionRef, "codex/remote-mobile-controller-fixes")
  assert.match(makefile, /CODEX_DESKTOP_CONVERSION_REF_FILE \?= codex-desktop-conversion\.ref/)
  assert.match(makefile, /CODEX_DESKTOP_CONVERSION_COMMIT \?= \$\(shell ref=/)
  assert.match(makefile, /\$\$\{ref:-self-hosted\}/)
  assert.match(makefile, /scripts\/install-codex-desktop-local\.sh \$\(CODEX_DESKTOP_INSTALL_ARGS\)/)
  assert.match(makefile, /codex-install: codex-desktop-install/)
  assert.match(makefile, /codex-desktop-uninstall:/)
  assert.match(makefile, /scripts\/uninstall-codex-desktop-local\.sh/)
  assert.match(makefile, /codex-desktop-zap:/)
  assert.match(makefile, /scripts\/uninstall-codex-desktop-local\.sh --zap/)
  assert.match(pipeline, /process\.env\.CODEX_DESKTOP_CONVERSION_REPO \|\|/)
  assert.match(pipeline, /process\.env\.CODEX_DESKTOP_CONVERSION_COMMIT \|\|/)
  assert.match(pipeline, /process\.env\.CODEX_DESKTOP_CONVERSION_COMMIT \|\| readDefaultCodexDesktopConversionRef\(\)/)
  assert.match(pipeline, /codex-desktop-conversion\.ref/)
  assert.match(pipeline, /codexDesktopDmgCacheBuster\?: string/)
  assert.match(pipeline, /CODEX_DESKTOP_DMG_CACHE_BUSTER/)
  assert.match(packageScript, /process\.env\.CODEX_DESKTOP_CONVERSION_COMMIT \|\| readDefaultCodexDesktopConversionRef\(\)/)
  assert.match(packageScript, /codex-desktop-conversion\.ref/)
  assert.doesNotMatch(pipeline, /078c16d68e6f1cb6ecdbff1f4054d70156ef42bb/)
  assert.doesNotMatch(packageScript, /078c16d68e6f1cb6ecdbff1f4054d70156ef42bb/)
  assert.match(pipeline, /function codexDesktopPackageVersion/)
  assert.match(pipeline, /\.conv\.\$\{compactVersionSegment\(codexDesktopConversionCommit\(conversionCommit\)\)\}/)
  assert.match(packageScript, /process\.env\.CODEX_DESKTOP_CONVERSION_REPO \|\|/)
  assert.match(packageScript, /process\.env\.CODEX_DESKTOP_CONVERSION_COMMIT \|\|/)
  assert.match(pipeline, /https:\/\/persistent\.oaistatic\.com\/codex-app-prod\/Codex\.dmg/)
  assert.match(pipeline, /scripts\/install-deps\.sh/)
  assert.match(pipeline, /CODEX_LINUX_ENABLE_COMPUTER_USE_UI", "1"/)
  assert.match(pipeline, /CODEX_DESKTOP_LINUX_FEATURES = \["remote-mobile-control", "open-target-discovery"\]/)
  assert.match(pipeline, /CODEX_LINUX_FEATURES_CONFIG", "\/work\/linux-features\.json"/)
  assert.match(pipeline, /linux_features_enabled: CODEX_DESKTOP_LINUX_FEATURES/)
  assert.match(pipeline, /remote-mobile-control-enabled/)
  assert.match(pipeline, /uninstall_postflight do/)
  assert.match(pipeline, /app-server-control\/app-server-control\.sock/)
  assert.match(pipeline, /UNIXSocket\.open\(control_socket\)\.close/)
  assert.match(pipeline, /FileUtils\.rm_f control_socket/)
  assert.match(packageScript, /linux_remote_mobile_control_autostart_marker/)
  assert.match(pipeline, /"--computer-use-ui-enabled",\s*"true"/)
  assert.match(pipeline, /depends_on cask: "codex"/)
  assert.match(pipeline, /depends_on formula: "desktop-file-utils"/)
  assert.match(pipeline, /brew install --cask test\/tap\/codex-desktop/)
  assert.match(pipeline, /patch-codex-desktop-conversion\.mjs/)
  assert.ok(
    pipeline.indexOf('if (packageId === "codex-desktop-linux")') <
      pipeline.indexOf("const ciLog = await this.ciCheck(packageId, githubToken)"),
    "releaseBundle must reject codex-desktop-linux before running ciCheck",
  )
  assert.doesNotMatch(pipeline, /--icon[\s\S]*\/conversion\/assets\/codex\.png/)
  assert.doesNotMatch(pipeline, /ca-certificates cargo curl/)
  assert.doesNotMatch(pipeline, /p7zip-full rustc sudo/)
  assert.match(pipeline, /root\/\.local\/bin:\$PATH/)
})

test("codex desktop conversion patch handles Electron 42 native modules", () => {
  const tmp = mkdtempSync(join(tmpdir(), "codex-desktop-patch-test-"))
  const conversionDir = join(tmp, "conversion")
  const moduleDir = join(tmp, "better-sqlite3")

  try {
    mkdirSync(join(conversionDir, "scripts/lib"), { recursive: true })
    mkdirSync(join(moduleDir, "src/util"), { recursive: true })

    writeFileSync(
      join(conversionDir, "scripts/lib/native-modules.sh"),
      [
        "#!/bin/bash",
        "build_native_modules() {",
        '    npm install "better-sqlite3@$bs3_build_ver" "node-pty@$npty_ver" --ignore-scripts 2>&1 >&2',
        "}",
      ].join("\n"),
    )
    writeFileSync(
      join(moduleDir, "src/better_sqlite3.cpp"),
      "\tv8::Local<v8::External> data = v8::External::New(isolate, addon);\n",
    )
    writeFileSync(
      join(moduleDir, "src/util/macros.cpp"),
      "#define OnlyAddon static_cast<Addon*>(info.Data().As<v8::External>()->Value())\n",
    )
    writeFileSync(
      join(moduleDir, "src/util/helpers.cpp"),
      ["\t\tfunc,", "\t\t0,", "\t\tdata"].join("\n"),
    )

    execFileSync(process.execPath, [conversionPatchScriptPath.pathname, "--conversion-dir", conversionDir], {
      cwd: repoRoot.pathname,
    })
    execFileSync(process.execPath, [conversionPatchScriptPath.pathname, "--better-sqlite3-dir", moduleDir], {
      cwd: repoRoot.pathname,
    })

    const nativeModules = readFileSync(join(conversionDir, "scripts/lib/native-modules.sh"), "utf8")
    assert.match(nativeModules, /patch-codex-desktop-conversion\.mjs" --better-sqlite3-dir/)

    const betterSqlite = readFileSync(join(moduleDir, "src/better_sqlite3.cpp"), "utf8")
    const macros = readFileSync(join(moduleDir, "src/util/macros.cpp"), "utf8")
    const helpers = readFileSync(join(moduleDir, "src/util/helpers.cpp"), "utf8")

    assert.match(betterSqlite, /External::New\(isolate, addon, v8::kExternalPointerTypeTagDefault\)/)
    assert.match(macros, /Value\(v8::kExternalPointerTypeTagDefault\)/)
    assert.match(helpers, /nullptr/)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("codex desktop conversion patch skips repos with native Electron 42 patch", () => {
  const tmp = mkdtempSync(join(tmpdir(), "codex-desktop-native-patch-test-"))
  const conversionDir = join(tmp, "conversion")

  try {
    mkdirSync(join(conversionDir, "scripts/lib"), { recursive: true })
    writeFileSync(
      join(conversionDir, "scripts/lib/native-modules.sh"),
      [
        "#!/bin/bash",
        "patch_better_sqlite3_for_v8_external_pointer_api() {",
        "    :",
        "}",
        "build_native_modules() {",
        '    npm install "better-sqlite3@$bs3_build_ver" "node-pty@$npty_ver" --ignore-scripts 2>&1 >&2',
        "    patch_better_sqlite3_for_v8_external_pointer_api \"$build_dir/node_modules/better-sqlite3\"",
        "}",
      ].join("\n"),
    )

    execFileSync(process.execPath, [conversionPatchScriptPath.pathname, "--conversion-dir", conversionDir], {
      cwd: repoRoot.pathname,
    })

    const nativeModules = readFileSync(join(conversionDir, "scripts/lib/native-modules.sh"), "utf8")
    assert.doesNotMatch(nativeModules, /patch-codex-desktop-conversion\.mjs" --better-sqlite3-dir/)
    assert.match(nativeModules, /patch_better_sqlite3_for_v8_external_pointer_api/)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("codex desktop packaging accepts converted open-target discovery patch", async () => {
  const { patchLinuxEditorTargets } = await import(scriptPath.href)
  const alreadyPatched = [
    "function codexLinuxIdeCommand(e){let t={vscode:[`code`,`codium`],vscodeInsiders:[`code-insiders`]}[e]??[];return null}",
    "function n({id:e,label:t,icon:n,darwinDetect:r,win32Detect:i,hidden:a}){return{id:e,platforms:{darwin:r?{}:void 0,win32:i?{}:void 0,linux:codexLinuxIdePlatform(e,t,n,a,o)}}}",
    "var targets=[a,b,...codexLinuxDiscoveredIdeTargets()]",
    "id:`vscode`,label:`VS Code`;id:`vscodeInsiders`,label:`VS Code Insiders`",
  ].join("")

  assert.equal(patchLinuxEditorTargets(alreadyPatched), alreadyPatched)
})

test("codex desktop packaging patches current VS Code target registry", async () => {
  const { patchLinuxEditorTargets } = await import(scriptPath.href)
  const currentRegistry = [
    "function gT({id:e,label:t,icon:n,darwinDetect:r,win32Detect:i,darwinEnv:a,darwinArgs:o,hidden:s}){return{id:e,platforms:{darwin:r?{label:t,icon:n,kind:`editor`,hidden:s,detect:r,env:a,args:o??_T,supportsSsh:!0}:void 0,win32:i?{label:t,icon:n,kind:`editor`,hidden:s,detect:i,args:_T,supportsSsh:!0}:void 0}}}",
    "var _T=(e,t)=>[e,t];",
    "var BE=gT({id:`vscode`,label:`VS Code`,icon:`apps/vscode.png`,darwinDetect:()=>rT([`/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code`]),win32Detect:VE});",
    "function VE(){return Qi({pathCommand:Fi(`code`),executableName:`Code.exe`,installDirName:`Microsoft VS Code`})}",
    "var HE=gT({id:`vscodeInsiders`,label:`VS Code Insiders`,icon:`apps/vscode-insiders.png`,darwinDetect:()=>rT([`/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code`]),win32Detect:UE});",
    "function UE(){return Qi({pathCommand:Fi(`code-insiders`),executableName:`Code - Insiders.exe`,installDirName:`Microsoft VS Code Insiders`})}",
  ].join("")

  const patched = patchLinuxEditorTargets(currentRegistry)
  assert.match(patched, /linuxDetect:\(\)=>Fi\(`code`\)/)
  assert.match(patched, /linuxDetect:\(\)=>Fi\(`code-insiders`\)/)
  assert.match(patched, /linux:[A-Za-z_$][\w$]*\?\{label:/)
})

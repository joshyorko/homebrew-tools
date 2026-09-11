export type ArtifactCheckPlan = Readonly<{
  homebrewPaths: readonly string[]
  kind: "formula" | "cask"
  commands: readonly string[]
  systemPackages: readonly string[]
  trustFormulas: readonly string[]
}>

const formula = (homebrewPath: string, name: string, commands: string[] = [], systemPackages: string[] = [], trustFormulas: string[] = []): ArtifactCheckPlan => ({
  homebrewPaths: [homebrewPath],
  kind: "formula",
  commands: [`brew info --json=v2 --formula test/tap/${name}`, `brew install test/tap/${name}`, ...commands],
  systemPackages,
  trustFormulas,
})

const cask = (homebrewPath: string, name: string, commands: string[] = [], systemPackages: string[] = [], trustFormulas: string[] = []): ArtifactCheckPlan => ({
  homebrewPaths: [homebrewPath],
  kind: "cask",
  commands: [`brew info --json=v2 --cask test/tap/${name}`, `brew install --cask test/tap/${name}`, ...commands],
  systemPackages,
  trustFormulas,
})

const plans: Record<string, ArtifactCheckPlan> = {
  "t3code-cli-main": formula("Formula/t3code-cli-main.rb", "t3code-cli-main", [
    "monitor=\"$(brew --prefix t3code-cli-main)/libexec/dist/resource-monitor/linux-x64/t3-resource-monitor\"",
    "test -x \"$monitor\"",
    "hello=\"$(\"$monitor\" </dev/null | head -n 1)\"",
    "\"$(brew --prefix node@24)/bin/node\" -e 'const value = JSON.parse(process.argv[1]); if (value.type !== \"hello\" || value.platform !== \"linux\" || value.arch !== \"x86_64\") process.exit(1)' \"$hello\"",
    "brew test test/tap/t3code-cli-main",
    "t3 --help",
  ]),
  "antigravity-cli": formula("Formula/antigravity-cli.rb", "antigravity-cli", [
    "brew test test/tap/antigravity-cli",
    "agy --version",
    "agy --help",
  ]),
  chatgpt: cask("Casks/chatgpt.rb", "chatgpt", [
    "test -x \"$(brew --prefix)/bin/chatgpt\"",
    "user_home=$(getent passwd \"$(id -un)\" | cut -d: -f6)",
    "test -f \"$user_home/.local/share/applications/chatgpt.desktop\"",
    "test -f \"$user_home/.local/share/pixmaps/chatgpt.png\"",
  ]),
  "codex-desktop-linux": cask("Casks/codex-desktop.rb", "codex-desktop", [
    "test -x \"$(brew --prefix)/bin/codex-desktop\"",
    "installed_dir=$(find \"$(brew --caskroom)/codex-desktop\" -mindepth 1 -maxdepth 1 -type d ! -name '.metadata' -print -quit)",
    "test -x \"$installed_dir/opt/codex-desktop/ChatGPT\"",
    "test -x \"$installed_dir/opt/codex-desktop/start.sh\"",
    "if grep -Fq 'exec /opt/codex-desktop/start.sh' \"$(brew --prefix)/bin/codex-desktop\"; then exit 1; fi",
    "codex-desktop --help >/tmp/codex-desktop-help.txt",
    "grep -q '^Usage:' /tmp/codex-desktop-help.txt",
    "test ! -e \"$installed_dir/usr/bin/codex-update-manager\"",
    "test -f \"$HOME/.local/share/applications/codex-desktop.desktop\"",
    "grep -Fq \"Exec=$(brew --prefix)/bin/codex-desktop %u\" \"$HOME/.local/share/applications/codex-desktop.desktop\"",
    "test -f \"$HOME/.local/share/icons/hicolor/256x256/apps/codex-desktop.png\"",
  ], ["desktop-file-utils", "xdg-utils"]),
  "headroom-self-hosted": formula("Formula/headroom-self-hosted.rb", "headroom-self-hosted", [
    "brew test test/tap/headroom-self-hosted",
    "test -x \"$(brew --prefix)/bin/headroom\"",
    "headroom --help",
    "headroom proxy --help",
  ]),
  devsy: formula("Formula/devsy.rb", "devsy", [
    "brew audit --formula test/tap/devsy",
    "brew test --verbose test/tap/devsy",
    "devsy_home=/tmp/devsy-artifact-check-home",
    "mkdir -p \"$devsy_home\"",
    "test \"$(DEVSY_HOME=\"$devsy_home\" devsy --version)\" = \"v$(brew info --json=v2 --formula test/tap/devsy | jq -r '.formulae[0].versions.stable')\"",
    "test -z \"$(find \"$devsy_home\" -type f -print -quit)\"",
  ]),
  "devsy-desktop": {
    homebrewPaths: ["Casks/devsy-desktop.rb", "Formula/devsy.rb"],
    kind: "cask",
    commands: [
      "brew info --json=v2 --cask test/tap/devsy-desktop",
      "brew info --json=v2 --formula test/tap/devsy",
      "brew audit --formula test/tap/devsy",
      "brew style --cask test/tap/devsy-desktop",
      "brew install test/tap/devsy",
      "brew install --cask test/tap/devsy-desktop",
      "brew test test/tap/devsy",
      "test \"$(devsy --version)\" = \"v$(brew info --json=v2 --formula test/tap/devsy | jq -r '.formulae[0].versions.stable')\"",
      "test \"$(readlink -f \"$(brew --prefix)/bin/devsy\")\" = \"$(brew --cellar)/devsy/$(brew info --json=v2 --formula test/tap/devsy | jq -r '.formulae[0].versions.stable')/bin/devsy\"",
      "test -x \"$(brew --prefix)/bin/devsy-desktop\"",
      "if grep -q -- '--no-sandbox' \"$(brew --prefix)/bin/devsy-desktop\"; then exit 1; fi",
      "test -f \"$HOME/.local/share/applications/devsy-desktop.desktop\"",
      "grep -q 'Exec=.*/bin/devsy-desktop %U' \"$HOME/.local/share/applications/devsy-desktop.desktop\"",
      "grep -q 'x-scheme-handler/devsy' \"$HOME/.local/share/applications/devsy-desktop.desktop\"",
      "test -f \"$HOME/.local/share/icons/hicolor/128x128/apps/devsy-desktop.png\"",
      "embedded_cli=$(find \"$(brew --prefix)/Caskroom/devsy-desktop\" -path '*/squashfs-root/resources/bin/devsy' -type f -print -quit)",
      "test -n \"$embedded_cli\"",
      "cli_sha=$(brew info --json=v2 --formula test/tap/devsy | jq -r '.formulae[0].urls.stable.checksum')",
      "test \"$(sha256sum \"$embedded_cli\" | awk '{print $1}')\" = \"$cli_sha\"",
      "test -n \"$(find \"$(brew --prefix)/Caskroom/devsy-desktop\" -path '*/squashfs-root/usr/lib/libappindicator.so.1' -type f -print -quit)\"",
      "grep -q 'squashfs-root/AppRun' \"$(brew --prefix)/bin/devsy-desktop\"",
      "if grep -q 'exec .*\\.AppImage' \"$(brew --prefix)/bin/devsy-desktop\"; then exit 1; fi",
      "test -n \"$(find \"$(brew --prefix)/Caskroom/devsy-desktop\" -path '*/squashfs-root/AppRun' -type f -perm -111 -print -quit)\"",
      "test -n \"$(find \"$(brew --prefix)/Caskroom/devsy-desktop\" -name 'Devsy_linux_x86_64.AppImage' -type f -perm -111 -print -quit)\"",
    ],
    systemPackages: ["desktop-file-utils"],
    trustFormulas: [],
  },
  "buzz-linux": cask("Casks/buzz-linux.rb", "buzz-linux", [
    "test -x \"$(brew --prefix)/bin/buzz\"",
    "wrapper=$(readlink -f \"$(brew --prefix)/bin/buzz\")",
    "bash -n \"$wrapper\"",
    "grep -q 'gst-inspect-1.0' \"$wrapper\"",
    "grep -q 'GST_PLUGIN_PATH_1_0' \"$wrapper\"",
    "grep -q 'GST_PLUGIN_SCANNER_1_0' \"$wrapper\"",
    "grep -q 'GST_REGISTRY_1_0' \"$wrapper\"",
    "mkdir -p /tmp/buzz-runtime-fixture/plugins /tmp/buzz-runtime-fixture/bin",
    "printf '#!/bin/bash\\nprintf \"  Filename                 /tmp/buzz-runtime-fixture/plugins/libgstapp.so\\\\n\"\\n' > /tmp/buzz-runtime-fixture/bin/gst-inspect-1.0",
    "printf '#!/bin/bash\\nexit 0\\n' > /tmp/buzz-runtime-fixture/bin/gst-plugin-scanner",
    "chmod +x /tmp/buzz-runtime-fixture/bin/gst-inspect-1.0 /tmp/buzz-runtime-fixture/bin/gst-plugin-scanner",
    "mkdir -p /tmp/buzz-runtime-fixture/data/Buzz/node-tools/bin /tmp/buzz-runtime-fixture/data/Buzz/runtimes/node/v24.11.0/linux-x64/bin",
    "runtime_env=$(XDG_DATA_HOME=/tmp/buzz-runtime-fixture/data PATH=\"/tmp/buzz-runtime-fixture/bin:/usr/bin\" BUZZ_PRINT_RUNTIME_ENV=1 \"$wrapper\")",
    "printf '%s\\n' \"$runtime_env\" | grep -q 'GST_PLUGIN_PATH_1_0=/tmp/buzz-runtime-fixture/plugins'",
    "printf '%s\\n' \"$runtime_env\" | grep -q 'GST_PLUGIN_SCANNER_1_0=/tmp/buzz-runtime-fixture/bin/gst-plugin-scanner'",
    "printf '%s\\n' \"$runtime_env\" | grep -q '^PATH=/tmp/buzz-runtime-fixture/data/Buzz/node-tools/bin:/tmp/buzz-runtime-fixture/data/Buzz/runtimes/node/v24.11.0/linux-x64/bin:/tmp/buzz-runtime-fixture/bin:/usr/bin$'",
    "runtime_probe=$(APPIMAGE_EXTRACT_AND_RUN=1 XDG_DATA_HOME=/tmp/buzz-runtime-fixture/data PATH=\"/tmp/buzz-runtime-fixture/bin:/usr/bin\" \"$wrapper\" --print-agent-access-owner-only)",
    "printf '%s\\n' \"$runtime_probe\" | grep -Eq '^(true|false)$'",
    "test -f \"$HOME/.local/share/applications/buzz.desktop\"",
    "test -f \"$HOME/.local/share/icons/hicolor/128x128/apps/buzz.png\"",
    "grep -q \"Exec=$(brew --prefix)/bin/buzz %U\" \"$HOME/.local/share/applications/buzz.desktop\"",
    "grep -q 'x-scheme-handler/buzz' \"$HOME/.local/share/applications/buzz.desktop\"",
  ], ["desktop-file-utils", "xdg-utils", "libasound2t64", "libgtk-3-0", "libgstreamer-plugins-base1.0-0", "libgstreamer-gl1.0-0"]),
  "fizzy-cli-master": formula("Formula/fizzy-cli-master.rb", "fizzy-cli-master", [
    "brew test test/tap/fizzy-cli-master",
    "fizzy --version",
  ]),
  "fizzy-popper-self-hosted": formula("Formula/fizzy-popper-self-hosted.rb", "fizzy-popper-self-hosted", [
    "brew test test/tap/fizzy-popper-self-hosted",
    "fizzy-popper --help",
  ]),
  "fizzy-symphony": formula("Formula/fizzy-symphony.rb", "fizzy-symphony", [
    "brew test test/tap/fizzy-symphony",
    "fizzy-symphony --help",
  ]),
  "vscode-insiders-linux": cask("Casks/vscode-insiders-linux.rb", "vscode-insiders-linux", [
    "mkdir -p \"$HOME/.local/share/applications\" \"$HOME/.local/share/icons/hicolor/512x512/apps\"",
    "printf '[Desktop Entry]\\nName=Legacy VS Code Insiders\\n' > \"$HOME/.local/share/applications/vscode-insiders-linux.desktop\"",
    "printf '[Desktop Entry]\\nName=Legacy VS Code Insiders URL Handler\\n' > \"$HOME/.local/share/applications/vscode-insiders-linux-url-handler.desktop\"",
    "printf 'legacy-icon' > \"$HOME/.local/share/icons/hicolor/512x512/apps/vscode-insiders-linux.png\"",
    "brew reinstall --cask test/tap/vscode-insiders-linux",
    "test -x \"$(brew --prefix)/bin/code-insiders\"",
    "test -x \"$(brew --prefix)/bin/code-tunnel-insiders\"",
    "test -f \"$HOME/.local/share/applications/code-insiders.desktop\"",
    "test -f \"$HOME/.local/share/applications/code-insiders-url-handler.desktop\"",
    "test -f \"$HOME/.local/share/mime/packages/code-insiders-workspace.xml\"",
    "test -f \"$HOME/.local/share/icons/hicolor/512x512/apps/vscode-insiders.png\"",
    "test ! -e \"$HOME/.local/share/applications/vscode-insiders-linux.desktop\"",
    "test ! -e \"$HOME/.local/share/applications/vscode-insiders-linux-url-handler.desktop\"",
    "test ! -e \"$HOME/.local/share/icons/hicolor/512x512/apps/vscode-insiders-linux.png\"",
    "grep -q 'CHROME_DESKTOP=code-insiders.desktop' \"$HOME/.local/share/applications/code-insiders.desktop\"",
    "grep -q 'Icon=.*/vscode-insiders.png' \"$HOME/.local/share/applications/code-insiders.desktop\"",
    "grep -q 'application/x-code-insiders-workspace;' \"$HOME/.local/share/applications/code-insiders.desktop\"",
    "grep -q -- '--open-url %U' \"$HOME/.local/share/applications/code-insiders-url-handler.desktop\"",
    "grep -q 'Icon=.*/vscode-insiders.png' \"$HOME/.local/share/applications/code-insiders-url-handler.desktop\"",
    "grep -q 'x-scheme-handler/vscode-insiders;' \"$HOME/.local/share/applications/code-insiders-url-handler.desktop\"",
    "xdg-mime query default x-scheme-handler/vscode-insiders",
    "xdg-settings get default-url-scheme-handler vscode-insiders || true",
  ], ["desktop-file-utils", "libglib2.0-bin", "shared-mime-info", "xdg-utils"]),
  voxtype: formula("Formula/voxtype.rb", "voxtype", [
    "test -x \"$(brew --prefix)/bin/voxtype\"",
    "test -f \"$(brew --prefix)/share/voxtype/default.toml\"",
    "brew test test/tap/voxtype",
  ]),
  eitype: formula("Formula/eitype.rb", "eitype", [
    "brew test test/tap/eitype",
    "test -x \"$(brew --prefix)/bin/eitype\"",
  ]),
  rcc: cask("Casks/rcc.rb", "rcc", [
    "test -x \"$(brew --prefix)/bin/rcc\"",
    "rcc --version",
  ]),
  "action-server": cask("Casks/action-server.rb", "action-server", [
    "test -x \"$(brew --prefix)/bin/action-server\"",
    "test \"$(action-server version)\" = \"$(brew info --json=v2 --cask test/tap/action-server | jq -r '.casks[0].version')\"",
    "action-server start --help",
    "cp \"$tap_dir/Casks/action-server.rb\" /tmp/runtime-action-server.rb",
    "cp /tap/dagger/tap-pipeline/tests/fixtures/action-server-1.2.6.rb \"$tap_dir/Casks/action-server.rb\"",
    "brew reinstall --cask test/tap/action-server",
    "brew list --cask --versions action-server | grep -F '1.2.6'",
    "test \"$(action-server version)\" = \"1.2.6\"",
    "cp /tmp/runtime-action-server.rb \"$tap_dir/Casks/action-server.rb\"",
    "brew reinstall --cask test/tap/action-server",
    "test \"$(action-server version)\" = \"$(brew info --json=v2 --cask test/tap/action-server | jq -r '.casks[0].version')\"",
  ]),
  "devpod-linux": {
    homebrewPaths: ["Casks/devpod-linux.rb", "Formula/devpod-appindicator-runtime-tools.rb"],
    kind: "cask",
    commands: [
      "brew info --json=v2 --cask test/tap/devpod-linux",
      "brew info --json=v2 --formula test/tap/devpod-appindicator-runtime-tools",
      "brew install --cask test/tap/devpod-linux",
      "test -x \"$(brew --prefix)/bin/devpod\"",
    "test -x \"$(brew --prefix)/bin/devpod-desktop\"",
    "test -f \"$HOME/.local/share/applications/sh.loft.devpod.desktop\"",
    "grep -q 'Exec=.*/bin/devpod-desktop %U' \"$HOME/.local/share/applications/sh.loft.devpod.desktop\"",
    "grep -q 'x-scheme-handler/devpod' \"$HOME/.local/share/applications/sh.loft.devpod.desktop\"",
    "test -f \"$HOME/.local/share/icons/hicolor/256x256@2/apps/devpod-desktop.png\"",
    "devpod version",
    ],
    systemPackages: ["binutils", "zstd"],
    trustFormulas: ["devpod-appindicator-runtime-tools"],
  },
  "t3-code-linux": cask("Casks/t3-code-linux.rb", "t3-code-linux", [
    "test -x \"$(brew --prefix)/bin/t3-code-linux\"",
    "installed_dir=$(dirname \"$(readlink -f \"$(brew --prefix)/bin/t3-code-linux\")\")",
    "test -x \"$installed_dir/squashfs-root/AppRun\"",
    "grep -Fq 'squashfs-root/AppRun' \"$(brew --prefix)/bin/t3-code-linux\"",
    "if grep -Eq '^exec .*AppImage' \"$(brew --prefix)/bin/t3-code-linux\"; then exit 1; fi",
    "test -f \"$HOME/.local/share/applications/t3-code-linux.desktop\"",
    "grep -q 'Exec=.*/bin/t3-code-linux %U' \"$HOME/.local/share/applications/t3-code-linux.desktop\"",
    "test -f \"$HOME/.local/share/icons/hicolor/512x512/apps/t3-code-linux.png\"",
  ], ["desktop-file-utils", "xdg-utils"]),
}

export function artifactCheckPlan(packageId: string): ArtifactCheckPlan {
  const plan = plans[packageId]
  if (!plan) {
    throw new Error(`Unknown package artifact check: ${packageId}`)
  }
  return plan
}

export function rejectForbiddenShaCommand(recipePath: string): string {
  return `if grep -Eq 'sha256.*(no_check|:no_check)' "${recipePath}"; then exit 1; fi`
}

export function buzzArtifactVerificationCommands(artifactPath: string): string[] {
  const directory = artifactPath.slice(0, artifactPath.lastIndexOf("/")) || "."
  const name = artifactPath.slice(artifactPath.lastIndexOf("/") + 1)
  return [
    "set -euxo pipefail",
    `chmod +x ${artifactPath}`,
    `cd ${directory}`,
    `./${name} --appimage-extract >/dev/null`,
    "test -x squashfs-root/AppRun",
    "test -x squashfs-root/usr/bin/buzz-desktop",
    "test -x squashfs-root/usr/bin/buzz-desktop.bin",
    "grep -q 'GST_PLUGIN_SYSTEM_PATH_1_0' squashfs-root/usr/bin/buzz-desktop",
    "grep -q 'unset \"$var\"' squashfs-root/usr/bin/buzz-desktop",
    "test ! -e squashfs-root/usr/etc/fonts/fonts.conf",
    "test -z \"$(find squashfs-root/usr/lib -maxdepth 1 -name 'libwayland-client.so*' -print -quit)\"",
    "test -z \"$(find squashfs-root/usr/lib -maxdepth 1 -name 'libglib-2.0.so*' -print -quit)\"",
    "test -z \"$(find squashfs-root/usr/lib -maxdepth 1 -name 'libgst*.so*' -print -quit)\"",
  ]
}

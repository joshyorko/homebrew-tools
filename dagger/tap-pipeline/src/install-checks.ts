export type ArtifactCheckPlan = Readonly<{
  homebrewPaths: readonly string[]
  kind: "formula" | "cask"
  commands: readonly string[]
  systemPackages: readonly string[]
  trustFormulas: readonly string[]
}>

/**
 * Public T3 Connect configuration shipped inside both Homebrew T3 artifacts.
 *
 * These are the production public identifiers from upstream `.env.example` at
 * the pinned source commit (`docs/operations/connect-setup.md`). They are
 * client-visible values, not secrets: never add a Clerk secret key, relay
 * credential, OAuth token, or a developer's local `.env` here.
 *
 * Both `buildT3Artifact` and `buildT3CodeArtifact` inject this single allowlist
 * into the build container before compilation; the same builders describe the
 * runtime acceptance checks that prove the values reached the shipped artifacts.
 */

export type T3PublicConnectSetting = {
  readonly name: string
  readonly value: string
}

export const T3_PUBLIC_CONNECT_ENV = [
  "T3CODE_CLERK_PUBLISHABLE_KEY",
  "T3CODE_CLERK_JWT_TEMPLATE",
  "T3CODE_CLERK_CLI_OAUTH_CLIENT_ID",
  "T3CODE_RELAY_URL",
] as const

export const T3_PUBLIC_CONNECT_CONFIG: readonly T3PublicConnectSetting[] = [
  { name: "T3CODE_CLERK_PUBLISHABLE_KEY", value: "pk_live_Y2xlcmsudDMuY29kZXMk" },
  { name: "T3CODE_CLERK_JWT_TEMPLATE", value: "t3-relay" },
  { name: "T3CODE_CLERK_CLI_OAUTH_CLIENT_ID", value: "hzxSgY2cH10sDU2r" },
  { name: "T3CODE_RELAY_URL", value: "https://relay.t3.codes" },
]

/** Upstream files and markers proving the pinned source still consumes the config. */
export const T3_PUBLIC_CONNECT_UPSTREAM_MARKERS: ReadonlyArray<readonly [string, string]> = [
  ["scripts/lib/public-config.ts", "baseEnv = process.env"],
  ["scripts/lib/public-config.ts", "loadRepoEnv"],
  ["apps/server/vite.config.ts", "loadRepoEnv("],
  ["apps/server/vite.config.ts", "repoEnv.T3CODE_CLERK_PUBLISHABLE_KEY"],
  ["apps/server/vite.config.ts", "repoEnv.T3CODE_CLERK_CLI_OAUTH_CLIENT_ID"],
  ["apps/server/vite.config.ts", "repoEnv.T3CODE_RELAY_URL"],
  ["apps/server/vite.config.ts", "__T3CODE_BUILD_CLERK_PUBLISHABLE_KEY__"],
  ["apps/server/vite.config.ts", "__T3CODE_BUILD_CLERK_CLI_OAUTH_CLIENT_ID__"],
  ["apps/server/vite.config.ts", "__T3CODE_BUILD_RELAY_URL__"],
  ["apps/web/vite.config.ts", "loadRepoEnv"],
  ["apps/web/vite.config.ts", "repoEnv.VITE_CLERK_PUBLISHABLE_KEY"],
  ["apps/web/vite.config.ts", "repoEnv.VITE_CLERK_JWT_TEMPLATE"],
  ["apps/web/vite.config.ts", "repoEnv.VITE_CLERK_CLI_OAUTH_CLIENT_ID"],
  ["apps/web/vite.config.ts", "repoEnv.VITE_T3CODE_RELAY_URL"],
  ["apps/desktop/vite.config.ts", "loadRepoEnv"],
  ["apps/desktop/vite.config.ts", "repoEnv.T3CODE_CLERK_PUBLISHABLE_KEY"],
  ["apps/desktop/vite.config.ts", "__T3CODE_BUILD_CLERK_PUBLISHABLE_KEY__"],
]

/** The real `t3 connect` description, present only when the build gate is open. */
export const T3_CONNECT_CLI_GATE_MARKER = "Set up T3 Connect for this machine"
/** The placeholder description shown only when public config was compiled out. */
export const T3_CONNECT_UNAVAILABLE_MARKER = "unavailable in builds without public configuration"

function fail(message: string): never {
  throw new Error(`T3 public Connect configuration: ${message}`)
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

/**
 * Validate the audited allowlist, failing closed on missing, empty, malformed,
 * duplicated, or unexpected settings.
 */
export function validateT3PublicConnectConfig(
  config: readonly T3PublicConnectSetting[] = T3_PUBLIC_CONNECT_CONFIG,
): readonly T3PublicConnectSetting[] {
  const expected = new Set<string>(T3_PUBLIC_CONNECT_ENV)
  const seen = new Set<string>()

  for (const { name, value } of config) {
    if (!expected.has(name)) fail(`unexpected setting ${name}`)
    if (seen.has(name)) fail(`duplicate setting ${name}`)
    seen.add(name)
    if (value.length === 0 || value.trim() !== value) {
      fail(`${name} must be a non-empty trimmed value`)
    }
  }
  for (const name of expected) {
    if (!seen.has(name)) fail(`missing required setting ${name}`)
  }

  const values = new Map(config.map((setting) => [setting.name, setting.value] as const))
  if (!/^pk_(?:live|test)_[A-Za-z0-9_-]+$/.test(values.get("T3CODE_CLERK_PUBLISHABLE_KEY") ?? "")) {
    fail("T3CODE_CLERK_PUBLISHABLE_KEY is not a Clerk publishable key")
  }
  if (!/^\S+$/.test(values.get("T3CODE_CLERK_JWT_TEMPLATE") ?? "")) {
    fail("T3CODE_CLERK_JWT_TEMPLATE is malformed")
  }
  if (!/^[A-Za-z0-9_-]+$/.test(values.get("T3CODE_CLERK_CLI_OAUTH_CLIENT_ID") ?? "")) {
    fail("T3CODE_CLERK_CLI_OAUTH_CLIENT_ID is malformed")
  }
  const relayUrl = values.get("T3CODE_RELAY_URL") ?? ""
  let relay: URL
  try {
    relay = new URL(relayUrl)
  } catch {
    return fail("T3CODE_RELAY_URL is not an absolute URL")
  }
  if (relay.protocol !== "https:" || relay.pathname !== "/" || relay.search !== "" || relay.hash !== "") {
    fail("T3CODE_RELAY_URL must be a secure HTTPS origin")
  }

  return config
}

/** Validated `[name, value]` pairs for the build container environment. */
export function t3PublicConnectEnv(
  config: readonly T3PublicConnectSetting[] = T3_PUBLIC_CONNECT_CONFIG,
): ReadonlyArray<readonly [string, string]> {
  return validateT3PublicConnectConfig(config).map(({ name, value }) => [name, value] as const)
}

/**
 * Shell command that fails the build when the pinned upstream source no longer
 * documents or consumes the audited public Connect configuration.
 */
export function t3PublicConnectDriftGuardCommand(upstreamDir = "/upstream"): string {
  const lines = [
    "set -euo pipefail",
    `cd ${shellQuote(upstreamDir)}`,
    'fail() { printf "T3 Connect drift guard: %s\\n" "$1" >&2; exit 1; }',
    'test -f .env.example || fail "the pinned source no longer ships .env.example"',
  ]

  for (const { name, value } of validateT3PublicConnectConfig()) {
    lines.push(
      `grep -Fxq ${shellQuote(`${name}=${value}`)} .env.example || fail "the pinned .env.example no longer documents the audited ${name}"`,
    )
  }
  for (const [file, marker] of T3_PUBLIC_CONNECT_UPSTREAM_MARKERS) {
    lines.push(
      `test -f ${shellQuote(file)} || fail "the pinned source is missing ${file}"`,
      `grep -Fq ${shellQuote(marker)} ${shellQuote(file)} || fail "${file} no longer consumes public Connect configuration (${marker})"`,
    )
  }

  return lines.join("\n")
}

/**
 * Runtime proof that the installed Homebrew CLI exposes Connect without any
 * manual public-config environment and without signing in.
 */
export function t3CliConnectGateChecks(
  homeDir = "/tmp/t3-connect-ci-home",
  helpFile = "/tmp/t3-connect-help.txt",
): readonly string[] {
  const unset = T3_PUBLIC_CONNECT_ENV.map((name) => `-u ${name}`).join(" ")
  const help = shellQuote(helpFile)
  return [
    `mkdir -p ${shellQuote(homeDir)}`,
    `env ${unset} HOME=${shellQuote(homeDir)} timeout 60 t3 connect --help > ${help} 2>&1 || { cat ${help} >&2; exit 1; }`,
    `if grep -q ${shellQuote(T3_CONNECT_UNAVAILABLE_MARKER)} ${help}; then echo "T3 Connect was compiled out of the installed CLI" >&2; exit 1; fi`,
    `grep -q ${shellQuote(T3_CONNECT_CLI_GATE_MARKER)} ${help} || { echo "T3 Connect command is unavailable in the installed CLI" >&2; exit 1; }`,
  ]
}

/**
 * Runtime proof that the shipped Desktop AppImage embeds public Connect
 * configuration in its compiled frontend and embedded server. The caller
 * defines `$asar` as the extracted `resources/app.asar` and mounts the verifier
 * from the tap at `/tap/scripts/check-t3-connect-asar.mjs`.
 */
export function t3PublicConnectAsarChecks(asarVariable = "asar"): readonly string[] {
  const asar = `"$${asarVariable}"`
  return [
    `test -s ${asar} || { echo "T3 Code AppImage has no app.asar" >&2; exit 1; }`,
    `node /tap/scripts/check-t3-connect-asar.mjs ${asar} ${shellQuote(JSON.stringify(validateT3PublicConnectConfig()))}`,
  ]
}

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
  review: formula("Formula/review.rb", "review", [
    "brew test test/tap/review",
    "review --help",
    'test -s "$(brew --prefix review)/libexec/launcher/review.sif"',
    'test -f "$(brew --prefix review)/libexec/build.json"',
  ]),
  "t3code-cli-main": formula("Formula/t3code-cli-main.rb", "t3code-cli-main", [
    "monitor=\"$(brew --prefix t3code-cli-main)/libexec/dist/resource-monitor/linux-x64/t3-resource-monitor\"",
    "test -x \"$monitor\"",
    "hello=\"$(\"$monitor\" </dev/null | head -n 1)\"",
    "\"$(brew --prefix node@24)/bin/node\" -e 'const value = JSON.parse(process.argv[1]); if (value.type !== \"hello\" || value.platform !== \"linux\" || value.arch !== \"x86_64\") process.exit(1)' \"$hello\"",
    "grep -Eq '^[[:space:]]*export T3CODE_TELEMETRY_ENABLED=false$' \"$(brew --prefix)/bin/t3\"",
    "brew test test/tap/t3code-cli-main",
    "t3 --help",
    ...t3CliConnectGateChecks(),
  ]),
  chatgpt: cask("Casks/chatgpt-linux.rb", "chatgpt-linux", [
    "test -x \"$(brew --prefix)/bin/chatgpt\"",
    "user_home=$(getent passwd \"$(id -un)\" | cut -d: -f6)",
    "test -f \"$user_home/.local/share/applications/chatgpt.desktop\"",
    "grep -qx 'Icon=chatgpt' \"$user_home/.local/share/applications/chatgpt.desktop\"",
    "test -f \"$user_home/.local/share/icons/hicolor/512x512@2/apps/chatgpt.png\"",
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
  "codex-memoryd": formula("Formula/codex-memoryd.rb", "codex-memoryd", [
    "brew test test/tap/codex-memoryd",
    "codex-memoryd --version",
    "codex-memoryd init --port 8989",
    "codex-memoryd up",
    "codex-memoryd status",
    "codex-memoryd down",
    "test -s \"$HOME/.codex-memoryd/memory.db\"",
  ]),
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
      "grep -qx 'Icon=devsy-desktop' \"$HOME/.local/share/applications/devsy-desktop.desktop\"",
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
  "fizzy-cli-master": formula("Formula/fizzy-cli-master.rb", "fizzy-cli-master", [
    "brew test test/tap/fizzy-cli-master",
    "fizzy --version",
  ]),
  "fizzy-popper-self-hosted": formula("Formula/fizzy-popper-self-hosted.rb", "fizzy-popper-self-hosted", [
    "brew test test/tap/fizzy-popper-self-hosted",
    "fizzy-popper --help",
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
    "grep -q '^Icon=vscode-insiders$' \"$HOME/.local/share/applications/code-insiders.desktop\"",
    "grep -q 'application/x-code-insiders-workspace;' \"$HOME/.local/share/applications/code-insiders.desktop\"",
    "grep -q -- '--open-url %U' \"$HOME/.local/share/applications/code-insiders-url-handler.desktop\"",
    "grep -q '^Icon=vscode-insiders$' \"$HOME/.local/share/applications/code-insiders-url-handler.desktop\"",
    "grep -q 'x-scheme-handler/vscode-insiders;' \"$HOME/.local/share/applications/code-insiders-url-handler.desktop\"",
    "xdg-mime query default x-scheme-handler/vscode-insiders",
    "xdg-settings get default-url-scheme-handler vscode-insiders || true",
  ], ["desktop-file-utils", "libglib2.0-bin", "shared-mime-info", "xdg-utils"]),
  voxtype: formula("Formula/voxtype.rb", "voxtype", [
    "test -x \"$(brew --prefix)/bin/voxtype\"",
    "test -f \"$(brew --prefix)/share/voxtype/default.toml\"",
    "brew test test/tap/voxtype",
    "voxtype --version",
  ], ["libasound2t64", "libvulkan1", "libxkbcommon0"]),
  eitype: formula("Formula/eitype.rb", "eitype", [
    "brew test test/tap/eitype",
    "test -x \"$(brew --prefix)/bin/eitype\"",
    "eitype --help",
  ], ["libxkbcommon0"]),
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
    "grep -qx 'Icon=devpod-desktop' \"$HOME/.local/share/applications/sh.loft.devpod.desktop\"",
    "grep -q 'Exec=.*/bin/devpod-desktop %U' \"$HOME/.local/share/applications/sh.loft.devpod.desktop\"",
    "grep -q 'x-scheme-handler/devpod' \"$HOME/.local/share/applications/sh.loft.devpod.desktop\"",
    "test -f \"$HOME/.local/share/icons/hicolor/256x256@2/apps/devpod-desktop.png\"",
    "devpod version",
    ],
    systemPackages: ["binutils", "zstd"],
    trustFormulas: ["devpod-appindicator-runtime-tools"],
  },
  "t3-code-linux": cask("Casks/t3-code-linux.rb", "t3-code-linux", [
    "grep -Eq '^[[:space:]]*export T3CODE_TELEMETRY_ENABLED=false$' \"$(brew --prefix)/bin/t3-code-linux\"",
    "test -x \"$(brew --prefix)/bin/t3-code-linux\"",
    "installed_dir=$(dirname \"$(readlink -f \"$(brew --prefix)/bin/t3-code-linux\")\")",
    "test -x \"$installed_dir/squashfs-root/AppRun\"",
    "grep -Fq 'squashfs-root/AppRun' \"$(brew --prefix)/bin/t3-code-linux\"",
    "if grep -Eq '^exec .*AppImage' \"$(brew --prefix)/bin/t3-code-linux\"; then exit 1; fi",
    "test -f \"$HOME/.local/share/applications/t3-code-linux.desktop\"",
    "grep -qx 'Icon=t3-code-linux' \"$HOME/.local/share/applications/t3-code-linux.desktop\"",
    "grep -q 'Exec=.*/bin/t3-code-linux %U' \"$HOME/.local/share/applications/t3-code-linux.desktop\"",
    "test -f \"$HOME/.local/share/icons/hicolor/512x512/apps/t3-code-linux.png\"",
    "app_dir=\"$installed_dir/squashfs-root\"",
    "asar=\"$app_dir/resources/app.asar\"",
    ...t3PublicConnectAsarChecks(),
  ], ["desktop-file-utils", "xdg-utils", "nodejs"]),
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

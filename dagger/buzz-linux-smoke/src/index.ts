import { dag, Container, Directory, File, object, func } from "@dagger.io/dagger"

const DEFAULT_SOURCE_REPOSITORY = "https://github.com/block/buzz.git"
const DEFAULT_SOURCE_REF = "95154bee4034ca7a40b33095c2ddbde8c9aa1614"
const DEFAULT_VERSION = "0.5.20"
const BUILD_IMAGE =
  "ubuntu:22.04@sha256:0e0a0fc6d18feda9db1590da249ac93e8d5abfea8f4c3c0c849ce512b5ef8982"
const BREW_IMAGE = "homebrew/brew:latest"
const CASK_PATH = "Casks/buzz-linux.rb"
const TAP_REPOSITORY = "joshyorko/homebrew-tools"

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

type BuzzSourceIdentity = Readonly<{
  repository: string
  ref: string
}>

type BuzzBuild = {
  assetName: string
  artifactPath: string
  source: BuzzSourceIdentity
  container: Container
}

@object()
export class BuzzLinuxSmoke {
  private artifactCheck(image: string, artifact: File): Container {
    return dag
      .container()
      .from(image)
      .withEnvVariable("APPIMAGE_EXTRACT_AND_RUN", "1")
      .withFile("/tmp/Buzz.AppImage", artifact)
      .withExec([
        "bash",
        "-lc",
        [
          "set -euxo pipefail",
          "chmod +x /tmp/Buzz.AppImage",
          "cd /tmp",
          "./Buzz.AppImage --appimage-extract >/dev/null",
          "test -x squashfs-root/AppRun",
          "test -x squashfs-root/usr/bin/buzz-desktop",
          "test -x squashfs-root/usr/bin/buzz-desktop.bin",
          "grep -q 'GST_PLUGIN_SYSTEM_PATH_1_0' squashfs-root/usr/bin/buzz-desktop",
          "grep -q 'unset \"\\$var\"' squashfs-root/usr/bin/buzz-desktop",
          "! test -e squashfs-root/usr/etc/fonts/fonts.conf",
          "! find squashfs-root/usr/lib -maxdepth 1 -name 'libwayland-client.so*' | grep -q .",
          "! find squashfs-root/usr/lib -maxdepth 1 -name 'libglib-2.0.so*' | grep -q .",
          "! find squashfs-root/usr/lib -maxdepth 1 -name 'libgst*.so*' | grep -q .",
        ].join("\n"),
      ])
  }

  private sourceBuild(
    tap: Directory,
    sourceRepository: string,
    sourceRef: string,
    version: string,
    revision: string,
  ): BuzzBuild {
    const assetName = `buzz-linux-${version}-${revision}-x86_64.AppImage`
    const artifactPath = `/out/${assetName}`
    const appimagePath = `desktop/src-tauri/target/release/bundle/appimage/Buzz_${version}_amd64.AppImage`
    const source = Object.freeze({ repository: sourceRepository, ref: sourceRef })
    const dependencies = [
      "build-essential",
      "ca-certificates",
      "curl",
      "desktop-file-utils",
      "file",
      "fontconfig",
      "git",
      "libasound2-dev",
      "libayatana-appindicator3-dev",
      "libgtk-3-dev",
      "librsvg2-dev",
      "libssl-dev",
      "libwebkit2gtk-4.1-dev",
      "libxdo-dev",
      "patchelf",
      "pkg-config",
      "squashfs-tools",
      "wget",
      "xdg-utils",
    ].join(" ")

    const container = dag
      .container()
      .from(BUILD_IMAGE)
      .withMountedCache(
        "/root/.cache/hermit",
        dag.cacheVolume("buzz-linux-hermit-cache"),
      )
      .withMountedCache(
        "/root/.cargo/registry",
        dag.cacheVolume("buzz-linux-cargo-registry-cache"),
      )
      .withMountedCache(
        "/root/.cargo/git",
        dag.cacheVolume("buzz-linux-cargo-git-cache"),
      )
      .withEnvVariable("DEBIAN_FRONTEND", "noninteractive")
      .withEnvVariable("APPIMAGE_EXTRACT_AND_RUN", "1")
      .withExec([
        "bash",
        "-lc",
        `apt-get update && apt-get install -y --no-install-recommends ${dependencies} && rm -rf /var/lib/apt/lists/*`,
      ])
      .withExec([
        "bash",
        "-lc",
        [
          "set -euo pipefail",
          `git clone --filter=blob:none "${sourceRepository}" /src`,
          "cd /src",
          `git checkout --detach "${sourceRef}"`,
          `test "$(git rev-parse HEAD)" = "${sourceRef}"`,
          "test -f desktop/src-tauri/src/linux_media.rs",
          "grep -q set_enable_media_stream desktop/src-tauri/src/linux_media.rs",
          "grep -q linux_media::enable_media_capture desktop/src-tauri/src/lib.rs",
          "test -f desktop/src-tauri/src/webkit_rendering.rs",
          "grep -q WEBKIT_DMABUF_RENDERER_FORCE_SHM desktop/src-tauri/src/webkit_rendering.rs",
          "grep -q WEBKIT_DISABLE_COMPOSITING_MODE desktop/src-tauri/src/webkit_rendering.rs",
          "grep -q 'webkit_rendering::apply' desktop/src-tauri/src/main.rs",
          "for package in buzz-acp buzz-agent buzz-backend-kubernetes buzz-dev-mcp git-credential-nostr buzz-cli; do",
          "  printf 'BUZZ_SOURCE_PACKAGE_CHECK name=%s status=start\\n' \"$package\"",
          "  if test -f \"crates/$package/Cargo.toml\" && grep -q \"crates/$package\" Cargo.toml; then",
          "    printf 'BUZZ_SOURCE_PACKAGE_CHECK name=%s status=present\\n' \"$package\"",
          "  else",
          "    printf 'BUZZ_SOURCE_PACKAGE_CHECK name=%s status=missing\\n' \"$package\" >&2",
          "    exit 1",
          "  fi",
          "done",
        ].join("\n"),
      ])
      .withMountedCache(
        "/root/.local/share/pnpm/store",
        dag.cacheVolume("buzz-linux-pnpm-store-cache"),
      )
      .withMountedCache(
        "/src/target",
        dag.cacheVolume("buzz-linux-sidecar-target-cache"),
      )
      .withMountedCache(
        "/src/desktop/src-tauri/target",
        dag.cacheVolume("buzz-linux-cargo-target-cache"),
      )
      .withExec([
        "bash",
        "-lc",
        [
          "set -euo pipefail",
          "wget -q -O /tmp/appimagetool https://github.com/AppImage/appimagetool/releases/download/1.9.1/appimagetool-x86_64.AppImage",
          "echo 'ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0  /tmp/appimagetool' | sha256sum -c",
          "install -m 755 /tmp/appimagetool /usr/local/bin/appimagetool",
          "wget -q -O /tmp/appimage-runtime https://github.com/AppImage/type2-runtime/releases/download/20251108/runtime-x86_64",
          "echo '2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d  /tmp/appimage-runtime' | sha256sum -c",
          "install -D -m 644 /tmp/appimage-runtime /usr/local/lib/appimage-runtime",
        ].join("\n"),
      ])
      .withEnvVariable("APPIMAGETOOL_RUNTIME_FILE", "/usr/local/lib/appimage-runtime")
      .withExec([
        "bash",
        "-lc",
        [
          "set -euo pipefail",
          "cd /src",
          "source bin/activate-hermit",
          "just desktop-install-ci",
          `cd desktop && node scripts/set-version-from-tag.mjs "${version}"`,
          "cd /src",
          `rm -f "${appimagePath}"`,
          "cat > desktop/src-tauri/tauri.canary.conf.json <<'JSON'",
          '{"bundle":{"createUpdaterArtifacts":false}}',
          "JSON",
          "cargo build --release -p buzz-acp -p buzz-agent -p buzz-backend-kubernetes -p buzz-dev-mcp -p git-credential-nostr -p buzz-cli",
          "./scripts/bundle-sidecars.sh",
          "cd desktop",
          "CMAKE_POLICY_VERSION_MINIMUM=3.5 pnpm tauri build --ci --bundles appimage --config src-tauri/tauri.canary.conf.json",
        ].join("\n"),
      ])
      .withDirectory("/tap", tap)
      .withExec([
        "bash",
        "-lc",
        [
          "set -euo pipefail",
          "cd /src",
          "run_post_repack_check() {",
          "  local name=$1",
          "  shift",
          "  printf 'BUZZ_POST_REPACK_CHECK_START name=%s\\n' \"$name\" >&2",
          "  if \"$@\"; then",
          "    printf 'BUZZ_POST_REPACK_CHECK_PASS name=%s\\n' \"$name\" >&2",
          "  else",
          "    status=$?",
          "    printf 'BUZZ_POST_REPACK_CHECK_FAIL name=%s status=%s command=%q\\n' \"$name\" \"$status\" \"$*\" >&2",
          "    return \"$status\"",
          "  fi",
          "}",
          `write_checksum() { sha256sum "$1" | awk '{print $1}' > "$2"; }`,
          "check_webkit_rendering_behavior() {",
          "  local output",
          "  local status",
          "  if output=$(WEBKIT_DMABUF_RENDERER_FORCE_SHM=0 timeout 5s ./squashfs-root/AppRun --safe-rendering 2>&1); then",
          "    printf '%s\\n' \"$output\" >&2",
          "    return 1",
          "  else",
          "    status=$?",
          "  fi",
          "  test \"$status\" -eq 1 || return 1",
          "  printf '%s\\n' \"$output\" | grep -q -- '--safe-rendering cannot be applied:' || return 1",
          "  printf '%s\\n' \"$output\" | grep -q -- 'WEBKIT_DMABUF_RENDERER_FORCE_SHM=0' || return 1",
          "}",
          "check_host_fontconfig() {",
          "  local font",
          "  font=$(fc-match -f '%{file}\\n' sans-serif) || return 1",
          "  test -n \"$font\" || return 1",
          "  test -f \"$font\" || return 1",
          "}",
          "check_gstreamer_shim_behavior() {",
          "  local fixture=/tmp/buzz-shim-check",
          "  local appdir",
          "  local output",
          "  rm -rf \"$fixture\" || return 1",
          "  mkdir -p \"$fixture/AppDir/usr/bin\" || return 1",
          "  cp squashfs-root/usr/bin/buzz-desktop \"$fixture/AppDir/usr/bin/buzz-desktop\" || return 1",
          "  appdir=\"$fixture/AppDir\"",
          "  printf '%s\\n' '#!/usr/bin/env bash' 'printf \"GST_PLUGIN_SYSTEM_PATH_1_0=%s\\n\" \"${GST_PLUGIN_SYSTEM_PATH_1_0-}\"' 'printf \"GST_PLUGIN_SYSTEM_PATH=%s\\n\" \"${GST_PLUGIN_SYSTEM_PATH-}\"' 'printf \"GST_PLUGIN_PATH_1_0=%s\\n\" \"${GST_PLUGIN_PATH_1_0-}\"' 'printf \"GST_PLUGIN_PATH=%s\\n\" \"${GST_PLUGIN_PATH-}\"' 'printf \"GST_PLUGIN_SCANNER_1_0=%s\\n\" \"${GST_PLUGIN_SCANNER_1_0-}\"' 'printf \"GST_PLUGIN_SCANNER=%s\\n\" \"${GST_PLUGIN_SCANNER-}\"' 'printf \"args=%s\\n\" \"$*\"' > \"$appdir/usr/bin/buzz-desktop.bin\" || return 1",
          "  chmod +x \"$appdir/usr/bin/buzz-desktop\" \"$appdir/usr/bin/buzz-desktop.bin\" || return 1",
          "  output=$(GST_PLUGIN_SYSTEM_PATH_1_0=\"$appdir/usr/lib/gstreamer-1.0\" GST_PLUGIN_SYSTEM_PATH=\"$appdir/usr/lib/gstreamer-1.0\" GST_PLUGIN_PATH_1_0=\"$appdir/usr/lib/gstreamer-1.0\" GST_PLUGIN_PATH=/host/gstreamer GST_PLUGIN_SCANNER_1_0=\"$appdir/usr/lib/gstreamer-1.0/gst-plugin-scanner\" GST_PLUGIN_SCANNER=/host/scanner \"$appdir/usr/bin/buzz-desktop\" shim-test) || return 1",
          "  printf '%s\\n' \"$output\" | grep -q '^GST_PLUGIN_SYSTEM_PATH_1_0=$' || return 1",
          "  printf '%s\\n' \"$output\" | grep -q '^GST_PLUGIN_SYSTEM_PATH=$' || return 1",
          "  printf '%s\\n' \"$output\" | grep -q '^GST_PLUGIN_PATH_1_0=$' || return 1",
          "  printf '%s\\n' \"$output\" | grep -q '^GST_PLUGIN_PATH=/host/gstreamer$' || return 1",
          "  printf '%s\\n' \"$output\" | grep -q '^GST_PLUGIN_SCANNER_1_0=$' || return 1",
          "  printf '%s\\n' \"$output\" | grep -q '^GST_PLUGIN_SCANNER=/host/scanner$' || return 1",
          "  printf '%s\\n' \"$output\" | grep -q '^args=shim-test$' || return 1",
          "}",
          "run_post_repack_check fix-appimage-script grep -q 'APPRUN_WRAPPED=' desktop/scripts/fix-appimage.sh",
          "run_post_repack_check gstreamer-shim-script grep -q 'Installing GStreamer launcher shim' desktop/scripts/fix-appimage.sh",
          `appimage="${appimagePath}"`,
          "run_post_repack_check appimage-present test -s \"$appimage\"",
          "appimage=$(run_post_repack_check appimage-realpath realpath \"$appimage\")",
          "run_post_repack_check appimage-repack bash desktop/scripts/fix-appimage.sh \"$appimage\"",
          "rm -rf /tmp/buzz-verify && mkdir -p /tmp/buzz-verify && cd /tmp/buzz-verify",
          "run_post_repack_check appimage-extract \"$appimage\" --appimage-extract >/dev/null",
          "run_post_repack_check webkit-rendering-binary test -x squashfs-root/usr/bin/buzz-desktop.bin",
          "run_post_repack_check webkit-rendering-force-shm grep -a -q WEBKIT_DMABUF_RENDERER_FORCE_SHM squashfs-root/usr/bin/buzz-desktop.bin",
          "run_post_repack_check webkit-rendering-safe-mode grep -a -q WEBKIT_DISABLE_COMPOSITING_MODE squashfs-root/usr/bin/buzz-desktop.bin",
          "run_post_repack_check webkit-rendering-behavior check_webkit_rendering_behavior",
          "run_post_repack_check fontconfig-no-stale-override test ! -e squashfs-root/usr/etc/fonts/fonts.conf",
          "run_post_repack_check fontconfig-host-default check_host_fontconfig",
          "run_post_repack_check desktop-launcher test -x squashfs-root/usr/bin/buzz-desktop",
          "run_post_repack_check desktop-binary test -x squashfs-root/usr/bin/buzz-desktop.bin",
          "run_post_repack_check gstreamer-system-path grep -q 'GST_PLUGIN_SYSTEM_PATH_1_0' squashfs-root/usr/bin/buzz-desktop",
          "run_post_repack_check launcher-variable-unset grep -q 'unset \"\\$var\"' squashfs-root/usr/bin/buzz-desktop",
          "run_post_repack_check gstreamer-shim-behavior check_gstreamer_shim_behavior",
          "cd /src",
          "mkdir -p /out",
          `run_post_repack_check artifact-copy cp "$appimage" "${artifactPath}"`,
          `run_post_repack_check checksum-write write_checksum "$appimage" "${artifactPath}.sha256"`,
          `run_post_repack_check checksum-present test -s "${artifactPath}.sha256"`,
          `run_post_repack_check checksum-format grep -Eq '^[0-9a-f]{64}$' "${artifactPath}.sha256"`,
        ].join("\n"),
      ])

    return { assetName, artifactPath, source, container }
  }

  @func()
  async packageArtifact(
    tap: Directory,
    sourceRepository = DEFAULT_SOURCE_REPOSITORY,
    sourceRef = DEFAULT_SOURCE_REF,
    version = DEFAULT_VERSION,
    revision = "1",
  ): Promise<File> {
    const build = this.sourceBuild(tap, sourceRepository, sourceRef, version, revision)
    return build.container.file(build.artifactPath)
  }

  @func()
  async releaseBundle(
    tap: Directory,
    sourceRepository = DEFAULT_SOURCE_REPOSITORY,
    sourceRef = DEFAULT_SOURCE_REF,
    version = DEFAULT_VERSION,
    revision = "1",
  ): Promise<Directory> {
    const build = this.sourceBuild(tap, sourceRepository, sourceRef, version, revision)
    const verification = await this.verifyBuild(tap, build, version, revision)
    const sha256 = verification.sha256
    const source = build.source
    const releaseTag = `buzz-linux-${version}-${revision}`
    const downloadUrl = `https://github.com/${TAP_REPOSITORY}/releases/download/${releaseTag}/${build.assetName}`
    const caskContents = await tap.file(CASK_PATH).contents()
    const updatedCask = caskContents
      .replace(/version ".*"/, `version "${version},${revision}"`)
      .replace(/url ".*"/, `url "${downloadUrl}"`)
      .replace(/sha256 x86_64_linux: ".*"/, `sha256 x86_64_linux: "${sha256}"`)
    const release = {
      package: "buzz-linux",
      kind: "source_build_rust_appimage_cask",
      homebrew_path: CASK_PATH,
      version: `${version},${revision}`,
      release_tag: releaseTag,
      asset_name: build.assetName,
      artifact_sha256: sha256,
      download_url: downloadUrl,
      release_title: `Buzz Linux ${version}-${revision}`,
      release_notes: `Portable x86_64 Linux build compiled from block/buzz@${source.ref}.`,
      commit_message: `Update buzz-linux cask to ${version}-${revision}`,
      upstream: {
        kind: "git",
        repo: source.repository,
        ref: source.ref,
        version,
        commit: source.ref,
      },
    }
    const ciLog = [
      "Buzz Linux smoke test passed.",
      `source_repository=${source.repository}`,
      `source_ref=${source.ref}`,
      `artifact=artifacts/${build.assetName}`,
      `sha256=${sha256}`,
      verification.output,
      "",
    ].join("\n")

    return dag.directory()
      .withFile(`artifacts/${build.assetName}`, build.container.file(build.artifactPath))
      .withFile("homebrew/buzz-linux.rb", dag.file("buzz-linux.rb", updatedCask))
      .withFile("release.json", dag.file("release.json", json(release)))
      .withFile("ci.log", dag.file("ci.log", ciLog))
  }

  private async verifyBuild(
    tap: Directory,
    build: BuzzBuild,
    version: string,
    revision: string,
  ): Promise<{ output: string; sha256: string }> {
    try {
      await build.container.sync()
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(
        `BUZZ_POST_REPACK_EXECUTION_FAIL source_ref=${build.source.ref} artifact=${build.artifactPath} ${detail}`,
        { cause: error },
      )
    }
    const artifact = build.container.file(build.artifactPath)
    let sha256: string
    try {
      sha256 = (await build.container.file(`${build.artifactPath}.sha256`).contents()).trim()
      if (!/^[0-9a-f]{64}$/.test(sha256)) {
        throw new Error(`invalid SHA-256 value length=${sha256.length}`)
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(
        `BUZZ_CHECKSUM_OBSERVATION_FAIL path=${build.artifactPath}.sha256 ${detail}`,
        { cause: error },
      )
    }
    await Promise.all([
      this.artifactCheck("ubuntu:24.04", artifact).sync(),
      this.artifactCheck("fedora:latest", artifact).sync(),
      this.artifactCheck("archlinux:latest", artifact).sync(),
    ])
    const caskContents = await tap.file(CASK_PATH).contents()
    const updatedCask = caskContents
      .replace(/version ".*"/, `version "${version},${revision}"`)
      .replace(/url ".*"/, `url "file:///artifacts/${build.assetName}"`)
      .replace(/sha256 x86_64_linux: ".*"/, `sha256 x86_64_linux: "${sha256}"`)
    const smokeTap = tap.withFile(CASK_PATH, dag.file("buzz-linux.rb", updatedCask))

    const output = await dag
      .container()
      .from(BREW_IMAGE)
      .withUser("root")
      .withEnvVariable("HOMEBREW_NO_AUTO_UPDATE", "1")
      .withEnvVariable("HOMEBREW_NO_INSTALL_FROM_API", "1")
      .withExec([
        "bash",
        "-lc",
        [
          "set -euxo pipefail",
          "rm -f /etc/apt/sources.list.d/github-cli.list",
          "apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends desktop-file-utils xdg-utils libasound2 libgtk-3-0 libgstreamer-plugins-base1.0-0 libgstreamer-gl1.0-0 && rm -rf /var/lib/apt/lists/*",
        ].join("\n"),
      ])
      .withUser("linuxbrew")
      .withDirectory("/tap", smokeTap)
      .withFile(`/artifacts/${build.assetName}`, artifact)
      .withExec([
        "bash",
        "-lc",
        [
          "set -euxo pipefail",
          "check_exported_artifact_checksum() {",
          `  local actual=$(sha256sum "/artifacts/${build.assetName}" | awk '{print $1}')`,
          `  if test "$actual" = "${sha256}"; then`,
          "    printf 'BUZZ_EXPORTED_ARTIFACT_CHECK status=pass sha256=%s\\n' \"$actual\"",
          "  else",
          `    printf 'BUZZ_EXPORTED_ARTIFACT_CHECK status=fail expected=%s actual=%s\\n' "${sha256}" "$actual" >&2`,
          "    return 1",
          "  fi",
          "}",
          "check_exported_artifact_checksum",
          "repo=$(brew --repository)",
          "tap_dir=\"$repo/Library/Taps/test/homebrew-tap\"",
          "mkdir -p \"$tap_dir/Casks\"",
          "cp /tap/Casks/buzz-linux.rb \"$tap_dir/Casks/\"",
          "brew install --cask test/tap/buzz-linux",
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
          "mkdir -p /tmp/buzz-runtime-fixture/data/Buzz/node-tools/bin",
          "mkdir -p /tmp/buzz-runtime-fixture/data/Buzz/runtimes/node/v24.11.0/linux-x64/bin",
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
          `appimage_count=$(find "$(brew --prefix)/Caskroom/buzz-linux" -type f -name "${build.assetName}" | wc -l)`,
          "test \"$appimage_count\" -eq 1",
          `appimage=$(find "$(brew --prefix)/Caskroom/buzz-linux" -type f -name "${build.assetName}" -print -quit)`,
          "APPIMAGE_EXTRACT_AND_RUN=1 \"$appimage\" --appimage-extract >/dev/null",
          "test ! -e squashfs-root/usr/etc/fonts/fonts.conf",
          `echo "source_repository=${build.source.repository}"`,
          `echo "source_ref=${build.source.ref}"`,
          `echo "artifact_sha256=${sha256}"`,
        ].join("\n"),
      ])
      .stdout()

    return { output, sha256 }
  }

  @func()
  async smokeTest(
    tap: Directory,
    sourceRepository = DEFAULT_SOURCE_REPOSITORY,
    sourceRef = DEFAULT_SOURCE_REF,
    version = DEFAULT_VERSION,
    revision = "1",
  ): Promise<string> {
    const build = this.sourceBuild(tap, sourceRepository, sourceRef, version, revision)
    return (await this.verifyBuild(tap, build, version, revision)).output
  }
}

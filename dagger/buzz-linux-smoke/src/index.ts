import { dag, Container, Directory, File, object, func } from "@dagger.io/dagger"

const DEFAULT_SOURCE_REPOSITORY = "https://github.com/block/buzz.git"
const DEFAULT_SOURCE_REF = "cacebaf5d5fe876b68ec563e68a3b84c60620779"
const DEFAULT_VERSION = "0.5.0"
const BUILD_IMAGE =
  "ubuntu:22.04@sha256:0e0a0fc6d18feda9db1590da249ac93e8d5abfea8f4c3c0c849ce512b5ef8982"
const BREW_IMAGE = "homebrew/brew:latest"
const CASK_PATH = "Casks/buzz-linux.rb"

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
          "test -x squashfs-root/AppRun.wrapped",
          "grep -q WEBKIT_SKIA_ENABLE_CPU_RENDERING squashfs-root/AppRun",
          "grep -q 'Noto Color Emoji' squashfs-root/usr/etc/fonts/fonts.conf",
          "! find squashfs-root/usr/lib -maxdepth 1 -name 'libwayland-client.so*' | grep -q .",
          "! find squashfs-root/usr/lib -maxdepth 1 -name 'libglib-2.0.so*' | grep -q .",
        ].join("\n"),
      ])
  }

  private sourceBuild(
    tap: Directory,
    sourceRepository: string,
    sourceRef: string,
    version: string,
    revision: string,
  ): { assetName: string; artifactPath: string; container: Container } {
    const assetName = `buzz-linux-${version}-${revision}-x86_64.AppImage`
    const artifactPath = `/out/${assetName}`
    const dependencies = [
      "build-essential",
      "ca-certificates",
      "curl",
      "desktop-file-utils",
      "file",
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
        ].join("\n"),
      ])
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
          "cd src-tauri && cargo update --workspace",
          "cd /src",
          "cat > desktop/src-tauri/tauri.canary.conf.json <<'JSON'",
          '{"bundle":{"createUpdaterArtifacts":false}}',
          "JSON",
          "cargo build --release -p buzz-acp -p buzz-agent -p buzz-dev-mcp -p git-credential-nostr -p buzz-cli",
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
          "git apply --check /tap/patches/buzz-linux-apprun-hooks.patch",
          "git apply /tap/patches/buzz-linux-apprun-hooks.patch",
          "appimage=$(find desktop/src-tauri/target/release/bundle/appimage -name '*.AppImage' -type f -print -quit)",
          "test -n \"$appimage\"",
          "appimage=$(realpath \"$appimage\")",
          "bash desktop/scripts/fix-appimage.sh \"$appimage\"",
          "rm -rf /tmp/buzz-verify && mkdir -p /tmp/buzz-verify && cd /tmp/buzz-verify",
          "\"$appimage\" --appimage-extract >/dev/null",
          "grep -q WEBKIT_SKIA_ENABLE_CPU_RENDERING squashfs-root/AppRun",
          "grep -q FONTCONFIG_FILE squashfs-root/AppRun",
          "cd /src",
          "mkdir -p /out",
          `cp "$appimage" "${artifactPath}"`,
        ].join("\n"),
      ])

    return { assetName, artifactPath, container }
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
  async smokeTest(
    tap: Directory,
    sourceRepository = DEFAULT_SOURCE_REPOSITORY,
    sourceRef = DEFAULT_SOURCE_REF,
    version = DEFAULT_VERSION,
    revision = "1",
  ): Promise<string> {
    const build = this.sourceBuild(tap, sourceRepository, sourceRef, version, revision)
    const artifact = build.container.file(build.artifactPath)
    const sha256 = (
      await build.container.withExec(["sha256sum", build.artifactPath]).stdout()
    ).trim().split(/\s+/)[0]
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
        "apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends desktop-file-utils xdg-utils && rm -rf /var/lib/apt/lists/*",
      ])
      .withUser("linuxbrew")
      .withDirectory("/tap", smokeTap)
      .withFile(`/artifacts/${build.assetName}`, artifact)
      .withExec([
        "bash",
        "-lc",
        [
          "set -euo pipefail",
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
          "test -f \"$HOME/.local/share/applications/buzz.desktop\"",
          "test -f \"$HOME/.local/share/icons/hicolor/128x128/apps/buzz.png\"",
          "grep -q \"Exec=$(brew --prefix)/bin/buzz %U\" \"$HOME/.local/share/applications/buzz.desktop\"",
          "grep -q 'x-scheme-handler/buzz' \"$HOME/.local/share/applications/buzz.desktop\"",
          "appimage=$(find \"$(brew --prefix)/Caskroom/buzz-linux\" -name '*.AppImage' -type f -print -quit)",
          "APPIMAGE_EXTRACT_AND_RUN=1 \"$appimage\" --appimage-extract >/dev/null",
          "grep -q WEBKIT_SKIA_ENABLE_CPU_RENDERING squashfs-root/AppRun",
          "grep -q 'Noto Color Emoji' squashfs-root/usr/etc/fonts/fonts.conf",
          `echo "source_ref=${sourceRef}"`,
          `echo "artifact_sha256=${sha256}"`,
        ].join("\n"),
      ])
      .stdout()

    return output
  }
}

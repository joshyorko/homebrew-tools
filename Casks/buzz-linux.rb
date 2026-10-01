cask "buzz-linux" do
  arch intel: "x86_64"
  os linux: "linux"

  version "0.5.25,1"
  sha256 x86_64_linux: "4ea6d69eee525e9e664c1e5de6cc32cd7d9de730a100643dd7083c9dd08c0335"

  url "https://github.com/joshyorko/homebrew-tools/releases/download/buzz-linux-0.5.25-1/buzz-linux-0.5.25-1-x86_64.AppImage"
  name "Buzz"
  desc "Portable Linux desktop client for the Buzz collaboration platform"
  homepage "https://github.com/block/buzz"

  livecheck do
    skip "Updated by the tap's release workflow."
  end

  depends_on arch: :x86_64
  container type: :naked

  binary "buzz-linux-wrapper", target: "buzz"
  artifact "buzz.desktop",
           target: "#{Dir.home}/.local/share/applications/buzz.desktop"
  artifact "buzz.png",
           target: "#{Dir.home}/.local/share/icons/hicolor/128x128/apps/buzz.png"

  preflight_steps do
    set_permissions "buzz-linux-*.AppImage", "0755"

    run "/bin/bash",
        chdir: "{{staged_path}}",
        args:  ["-euo", "pipefail", "-c", <<~'SH']
          shopt -s nullglob
          appimages=(buzz-linux-*.AppImage)
          (( ${#appimages[@]} == 1 ))
          "./${appimages[0]}" --appimage-extract >/dev/null

          desktop_source="squashfs-root/usr/share/applications/Buzz.desktop"
          icon_source="squashfs-root/usr/share/icons/hicolor/128x128/apps/buzz-desktop.png"
          test -f "$desktop_source"
          test -f "$icon_source"

          sed \
            -e 's|^Exec=.*|Exec={{HOMEBREW_PREFIX}}/bin/buzz %U|' \
            -e "s|^Icon=.*|Icon=$HOME/.local/share/icons/hicolor/128x128/apps/buzz.png|" \
            "$desktop_source" > buzz.desktop
          cp "$icon_source" buzz.png
        SH

    mkdir_p ".local/share/applications", base: :home
    mkdir_p ".local/share/icons/hicolor/128x128/apps", base: :home

    write_file "buzz-linux-wrapper", <<~'SH'
      #!/bin/bash
      buzz_data_root="${XDG_DATA_HOME:-$HOME/.local/share}/Buzz"
      buzz_runtime_path="$buzz_data_root/node-tools/bin"
      for managed_node_bin in "$buzz_data_root"/runtimes/node/*/linux-x64/bin; do
        if [[ -d "$managed_node_bin" ]]; then
          buzz_runtime_path="$buzz_runtime_path:$managed_node_bin"
        fi
      done
      export PATH="$buzz_runtime_path:$PATH"

      gst_inspect="${GST_INSPECT_1_0:-$(command -v gst-inspect-1.0 2>/dev/null || true)}"
      if [[ -n "$gst_inspect" ]]; then
        gst_app_plugin="$("$gst_inspect" appsink 2>/dev/null | awk '/^[[:space:]]*Filename[[:space:]]+/ { print $2; exit }')"
        if [[ -n "$gst_app_plugin" ]]; then
          gst_plugin_dir="$(dirname "$gst_app_plugin")"
          export GST_PLUGIN_PATH_1_0="${GST_PLUGIN_PATH_1_0:-$gst_plugin_dir}"
          export GST_PLUGIN_SYSTEM_PATH_1_0="${GST_PLUGIN_SYSTEM_PATH_1_0:-$gst_plugin_dir}"
        fi
      fi

      if [[ -z "${GST_PLUGIN_SCANNER_1_0:-}" ]]; then
        for candidate in \
          "$(command -v gst-plugin-scanner 2>/dev/null || true)" \
          "/usr/libexec/gstreamer-1.0/gst-plugin-scanner" \
          "/usr/lib/gstreamer-1.0/gst-plugin-scanner" \
          "/usr/lib/x86_64-linux-gnu/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner" \
          "/usr/lib/aarch64-linux-gnu/gstreamer1.0/gst-plugin-scanner"; do
          if [[ -n "$candidate" && -x "$candidate" ]]; then
            export GST_PLUGIN_SCANNER_1_0="$candidate"
            export GST_PLUGIN_SCANNER="$candidate"
            break
          fi
        done
      fi

      cache_root="${XDG_CACHE_HOME:-$HOME/.cache}/buzz"
      mkdir -p "$cache_root"
      export GST_REGISTRY_1_0="${GST_REGISTRY_1_0:-$cache_root/gstreamer-registry.bin}"
      export GST_REGISTRY="${GST_REGISTRY:-$GST_REGISTRY_1_0}"

      if [[ "${BUZZ_PRINT_RUNTIME_ENV:-}" == "1" ]]; then
        printf 'GST_PLUGIN_PATH_1_0=%s\n' "${GST_PLUGIN_PATH_1_0:-}"
        printf 'GST_PLUGIN_SCANNER_1_0=%s\n' "${GST_PLUGIN_SCANNER_1_0:-}"
        printf 'GST_REGISTRY_1_0=%s\n' "${GST_REGISTRY_1_0:-}"
        printf 'PATH=%s\n' "$PATH"
        exit 0
      fi

      shopt -s nullglob
      appimages=("{{staged_path}}"/buzz-linux-*.AppImage)
      if (( ${#appimages[@]} != 1 )); then
        printf 'expected exactly one staged Buzz AppImage, found %d\n' "${#appimages[@]}" >&2
        exit 1
      fi
      exec "${appimages[0]}" "$@"
    SH
    set_permissions "buzz-linux-wrapper", "0755"
  end

  postflight_steps do
    run "/bin/bash",
        writable_paths: [".config", ".local/share/applications"],
        writable_base:  :home,
        args:           ["-euo", "pipefail", "-c", <<~'SH']
          xdg_mime=""
          for candidate in \
            /usr/bin/xdg-mime \
            /bin/xdg-mime \
            "{{HOMEBREW_PREFIX}}/bin/xdg-mime"; do
            if [[ -x "$candidate" ]]; then
              xdg_mime="$candidate"
              break
            fi
          done
          if [[ -n "$xdg_mime" ]]; then
            "$xdg_mime" default buzz.desktop x-scheme-handler/buzz || true
          fi

          update_desktop_database=""
          for candidate in \
            /usr/bin/update-desktop-database \
            /bin/update-desktop-database \
            "{{HOMEBREW_PREFIX}}/bin/update-desktop-database"; do
            if [[ -x "$candidate" ]]; then
              update_desktop_database="$candidate"
              break
            fi
          done
          if [[ -n "$update_desktop_database" ]]; then
            "$update_desktop_database" "$HOME/.local/share/applications" || true
          fi
        SH
  end

  zap trash: [
    "#{Dir.home}/.local/share/applications/buzz.desktop",
    "#{Dir.home}/.local/share/icons/hicolor/128x128/apps/buzz.png",
  ]

  caveats <<~EOS
    Launch Buzz from the desktop menu or run:
      buzz

    This x86_64 glibc build uses the host graphics, WebKitGTK, GStreamer, and
    font libraries. It is intended for current Fedora, Arch, and Ubuntu-family
    systems running Wayland or X11.
  EOS
end

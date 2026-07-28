cask "buzz-linux" do
  arch intel: "x86_64"
  os linux: "linux"

  version "0.5.0,3"
  sha256 x86_64_linux: "4d9884169869577471249f9f45f93de7da76bdb02ce801e19ea1d452fbf4f1a0"

  url "https://github.com/joshyorko/homebrew-tools/releases/download/buzz-linux-0.5.0-3/buzz-linux-0.5.0-3-x86_64.AppImage"
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

  preflight do
    appimage = "#{staged_path}/buzz-linux-#{version.csv.first}-#{version.csv.second}-#{arch}.AppImage"
    FileUtils.chmod 0755, appimage
    system appimage, "--appimage-extract", chdir: staged_path, out: File::NULL

    desktop_source = "#{staged_path}/squashfs-root/usr/share/applications/Buzz.desktop"
    icon_source = "#{staged_path}/squashfs-root/usr/share/icons/hicolor/128x128/apps/buzz-desktop.png"
    raise "Buzz desktop entry is missing" unless File.file?(desktop_source)
    raise "Buzz icon is missing" unless File.file?(icon_source)

    FileUtils.mkdir_p "#{Dir.home}/.local/share/applications"
    FileUtils.mkdir_p "#{Dir.home}/.local/share/icons/hicolor/128x128/apps"

    desktop_contents = File.read(desktop_source)
    desktop_contents.gsub!(/^Exec=.*/, "Exec=#{HOMEBREW_PREFIX}/bin/buzz %U")
    desktop_contents.gsub!(/^Icon=.*/, "Icon=#{Dir.home}/.local/share/icons/hicolor/128x128/apps/buzz.png")
    File.write("#{staged_path}/buzz.desktop", desktop_contents)
    FileUtils.cp(icon_source, "#{staged_path}/buzz.png")

    wrapper = "#{staged_path}/buzz-linux-wrapper"
    File.write(wrapper, <<~SH)
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
          "/usr/lib/aarch64-linux-gnu/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner"; do
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

      exec "#{appimage}" "$@"
    SH
    FileUtils.chmod 0755, wrapper
  end

  postflight do
    applications_dir = "#{Dir.home}/.local/share/applications"
    xdg_mime = ["/usr/bin/xdg-mime", "/bin/xdg-mime", "#{HOMEBREW_PREFIX}/bin/xdg-mime"]
               .find { |candidate| File.executable?(candidate) }
    update_desktop_database = [
      "/usr/bin/update-desktop-database",
      "/bin/update-desktop-database",
      "#{HOMEBREW_PREFIX}/bin/update-desktop-database",
    ].find { |candidate| File.executable?(candidate) }

    system xdg_mime, "default", "buzz.desktop", "x-scheme-handler/buzz" if xdg_mime
    system update_desktop_database, applications_dir if update_desktop_database
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

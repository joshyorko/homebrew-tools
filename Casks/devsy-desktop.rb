cask "devsy-desktop" do
  arch intel: "x86_64"
  os linux: "linux"

  version "1.17.0"
  sha256 x86_64_linux: "021eb0c4bb0661918e7249811a4fe06e56b91cee00aa8c320f3ae06ee9e3b64e"

  url "https://github.com/joshyorko/homebrew-tools/releases/download/devsy-desktop-#{version}/Devsy_linux_x86_64.AppImage"
  name "Devsy"
  desc "Desktop interface for the Devsy development environment platform"
  homepage "https://devsy.sh/"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  depends_on arch: :x86_64

  container type: :naked

  binary "devsy-desktop-wrapper", target: "devsy-desktop"
  artifact "devsy-desktop.desktop",
           target: "#{Dir.home}/.local/share/applications/devsy-desktop.desktop"
  artifact "devsy-desktop.png",
           target: "#{Dir.home}/.local/share/icons/hicolor/128x128/apps/devsy-desktop.png"

  preflight_steps do
    mkdir_p ".local/share/applications", base: :home
    mkdir_p ".local/share/icons/hicolor/128x128/apps", base: :home

    set_permissions "Devsy_linux_{{arch}}.AppImage", "+x"
    run "Devsy_linux_{{arch}}.AppImage",
        args: ["--appimage-extract"],
        base: :staged_path,
        chdir: "{{staged_path}}"

    run "/bin/bash", args: ["-eu", "-c", <<~'SH'], chdir: "{{staged_path}}"
      app_run="squashfs-root/AppRun"
      if [ ! -x "$app_run" ]; then
        echo "No executable AppRun found in extracted Devsy AppImage" >&2
        exit 1
      fi

      desktop_source="squashfs-root/devsy-desktop.desktop"
      if [ ! -f "$desktop_source" ]; then
        echo "No desktop entry found in extracted Devsy AppImage" >&2
        exit 1
      fi
      /bin/cp "$desktop_source" "devsy-desktop.desktop"
      /bin/sed -i \
        -e "s|^Exec=.*|Exec={{HOMEBREW_PREFIX}}/bin/devsy-desktop %U|" \
        -e "s|^Icon=.*|Icon=$HOME/.local/share/icons/hicolor/128x128/apps/devsy-desktop.png|" \
        "devsy-desktop.desktop"

      icon_source="squashfs-root/usr/share/icons/hicolor/128x128/apps/devsy-desktop.png"
      if [ ! -f "$icon_source" ]; then
        echo "No 128x128 icon found in extracted Devsy AppImage" >&2
        exit 1
      fi
      /bin/cp "$icon_source" "devsy-desktop.png"
    SH

    write_file "devsy-desktop-wrapper", <<~'SH'
      #!/bin/bash
      exec "{{staged_path}}/squashfs-root/AppRun" "$@"
    SH
    set_permissions "devsy-desktop-wrapper", "0755"
  end

  postflight_steps do
    run "/bin/bash", args: ["-eu", "-c", <<~'SH'],
      run_optional() {
        "$@" || true
      }

      for candidate in /usr/bin/xdg-mime /bin/xdg-mime "{{HOMEBREW_PREFIX}}/bin/xdg-mime"; do
        if [ -x "$candidate" ]; then
          run_optional "$candidate" default "devsy-desktop.desktop" "x-scheme-handler/devsy"
          break
        fi
      done

      for candidate in /usr/bin/update-desktop-database /bin/update-desktop-database "{{HOMEBREW_PREFIX}}/bin/update-desktop-database"; do
        if [ -x "$candidate" ]; then
          run_optional "$candidate" "$HOME/.local/share/applications"
          break
        fi
      done
    SH
        writable_paths: [".config", ".local/share/applications"],
        writable_base: :home
  end

  zap trash: [
    "#{Dir.home}/.local/share/applications/devsy-desktop.desktop",
    "#{Dir.home}/.local/share/icons/hicolor/128x128/apps/devsy-desktop.png",
  ]

  caveats <<~EOS
    Launch the desktop app with:
      devsy-desktop

    The AppImage contains an internal Devsy CLI used by the desktop app, but
    this cask does not expose it on PATH. Install the independently versioned
    CLI formula when you want the devsy command:
      brew install joshyorko/tools/devsy
  EOS
end

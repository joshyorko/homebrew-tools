cask "vscode-insiders-linux" do
  arch intel: "x64"
  os linux: "linux"

  version "1.137.0,1788539840.el8,de8cc55dae90"
  sha256 x86_64_linux: "d8f560f25c6ee047624ce70bab0e9201215971d48e89a281e4d3e40bc134ad35"

  url "https://github.com/joshyorko/homebrew-tools/releases/download/vscode-insiders-linux-1.137.0-1788539840.el8-de8cc55dae90/vscode-insiders-linux-1.137.0-1788539840.el8-de8cc55dae90.tar.gz"
  name "Visual Studio Code - Insiders"
  desc "Insiders build of Visual Studio Code packaged for Linux Homebrew"
  homepage "https://code.visualstudio.com/insiders/"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  binary "usr/share/code-insiders/bin/code-insiders", target: "code-insiders"
  binary "usr/share/code-insiders/bin/code-tunnel-insiders", target: "code-tunnel-insiders"
  artifact "usr/share/applications/code-insiders.desktop",
           target: "#{Dir.home}/.local/share/applications/code-insiders.desktop"
  artifact "usr/share/applications/code-insiders-url-handler.desktop",
           target: "#{Dir.home}/.local/share/applications/code-insiders-url-handler.desktop"
  artifact "usr/share/pixmaps/vscode-insiders.png",
           target: "#{Dir.home}/.local/share/icons/hicolor/512x512/apps/vscode-insiders.png"
  artifact "usr/share/mime/packages/code-insiders-workspace.xml",
           target: "#{Dir.home}/.local/share/mime/packages/code-insiders-workspace.xml"

  preflight_steps do
    remove [
      ".local/share/applications/vscode-insiders-linux.desktop",
      ".local/share/applications/vscode-insiders-linux-url-handler.desktop",
      ".local/share/icons/hicolor/512x512/apps/vscode-insiders-linux.png",
    ], base: :home

    mkdir_p ".local/share/applications", base: :home
    mkdir_p ".local/share/icons/hicolor/512x512/apps", base: :home
    mkdir_p ".local/share/mime/packages", base: :home

    run "/bin/bash", args: ["-euo", "pipefail", "-c", <<~'SH'], chdir: "{{staged_path}}",
      desktop_file="usr/share/applications/code-insiders.desktop"
      if ! /bin/grep -Eq '^Exec=/usr/share/code-insiders/code-insiders %F$' "$desktop_file"; then
        echo "missing upstream Exec in {{staged_path}}/$desktop_file" >&2
        exit 1
      fi
      if ! /bin/grep -Eq '^Exec=/usr/share/code-insiders/code-insiders --new-window %F$' "$desktop_file"; then
        echo "missing new-window action Exec in {{staged_path}}/$desktop_file" >&2
        exit 1
      fi
      /bin/sed -i -E \
        -e 's|^Exec=/usr/share/code-insiders/code-insiders %F$|Exec=/usr/bin/env CHROME_DESKTOP=code-insiders.desktop {{HOMEBREW_PREFIX}}/bin/code-insiders %F|' \
        -e 's|^Exec=/usr/share/code-insiders/code-insiders --new-window %F$|Exec=/usr/bin/env CHROME_DESKTOP=code-insiders.desktop {{HOMEBREW_PREFIX}}/bin/code-insiders --new-window %F|' \
        "$desktop_file"
      /bin/sed -i "s|^Icon=.*|Icon=$HOME/.local/share/icons/hicolor/512x512/apps/vscode-insiders.png|" "$desktop_file"

      url_handler_file="usr/share/applications/code-insiders-url-handler.desktop"
      if ! /bin/grep -Eq '^Exec=/usr/share/code-insiders/code-insiders --open-url %U$' "$url_handler_file"; then
        echo "missing URL handler Exec in {{staged_path}}/$url_handler_file" >&2
        exit 1
      fi
      /bin/sed -i -E \
        -e 's|^Exec=/usr/share/code-insiders/code-insiders --open-url %U$|Exec=/usr/bin/env CHROME_DESKTOP=code-insiders.desktop {{HOMEBREW_PREFIX}}/bin/code-insiders --open-url %U|' \
        -e "s|^Icon=.*|Icon=$HOME/.local/share/icons/hicolor/512x512/apps/vscode-insiders.png|" \
        "$url_handler_file"

      package_json_file="usr/share/code-insiders/resources/app/package.json"
      if ! /bin/grep -Eq '"desktopName"[[:space:]]*:[[:space:]]*"[^"]+"' "$package_json_file"; then
        echo "missing desktopName in {{staged_path}}/$package_json_file" >&2
        exit 1
      fi
      /bin/sed -i -E 's|"desktopName"[[:space:]]*:[[:space:]]*"[^"]+"|"desktopName": "code-insiders.desktop"|' "$package_json_file"
    SH
        writable_paths: ["usr/share/applications", "usr/share/code-insiders/resources/app"]
  end

  postflight_steps do
    run "/bin/bash", args: ["-eu", "-c", <<~'SH'],
      run_optional() {
        "$@" || true
      }

      for candidate in /usr/bin/xdg-mime /bin/xdg-mime "{{HOMEBREW_PREFIX}}/bin/xdg-mime"; do
        if [ -x "$candidate" ]; then
          run_optional "$candidate" default "code-insiders-url-handler.desktop" "x-scheme-handler/vscode-insiders"
          break
        fi
      done

      for candidate in /usr/bin/xdg-settings /bin/xdg-settings "{{HOMEBREW_PREFIX}}/bin/xdg-settings"; do
        if [ -x "$candidate" ]; then
          run_optional "$candidate" set default-url-scheme-handler "vscode-insiders" "code-insiders-url-handler.desktop"
          break
        fi
      done

      for candidate in /usr/bin/update-desktop-database /bin/update-desktop-database "{{HOMEBREW_PREFIX}}/bin/update-desktop-database"; do
        if [ -x "$candidate" ]; then
          run_optional "$candidate" "$HOME/.local/share/applications"
          break
        fi
      done

      for candidate in /usr/bin/update-mime-database /bin/update-mime-database "{{HOMEBREW_PREFIX}}/bin/update-mime-database"; do
        if [ -x "$candidate" ]; then
          run_optional "$candidate" "$HOME/.local/share/mime"
          break
        fi
      done
    SH
        writable_paths: [".config", ".local/share/applications", ".local/share/mime"],
        writable_base: :home
  end

  zap trash: [
    "#{Dir.home}/.local/share/applications/code-insiders.desktop",
    "#{Dir.home}/.local/share/applications/code-insiders-url-handler.desktop",
    "#{Dir.home}/.local/share/applications/vscode-insiders-linux.desktop",
    "#{Dir.home}/.local/share/applications/vscode-insiders-linux-url-handler.desktop",
    "#{Dir.home}/.local/share/icons/hicolor/512x512/apps/vscode-insiders.png",
    "#{Dir.home}/.local/share/icons/hicolor/512x512/apps/vscode-insiders-linux.png",
    "#{Dir.home}/.local/share/mime/packages/code-insiders-workspace.xml",
  ]

  caveats <<~EOS
    Launch the editor with:
      code-insiders

    Tunnel CLI is also available:
      code-tunnel-insiders

    App launcher installed for immutable/atomic desktops:
      #{Dir.home}/.local/share/applications/code-insiders.desktop

    URL handler installed for vscode-insiders:// links:
      #{Dir.home}/.local/share/applications/code-insiders-url-handler.desktop

    Workspace MIME definition installed at:
      #{Dir.home}/.local/share/mime/packages/code-insiders-workspace.xml

    If it doesn't appear in your app grid immediately, log out and back in.
  EOS
end

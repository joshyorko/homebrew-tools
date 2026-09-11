cask "t3-code-linux" do
  arch intel: "x86_64"
  os linux: "linux"

  version "main.20260911170948.05d404210058"
  sha256 x86_64_linux: "864dc00c67b1327abb2061efe386f93a8b8da2d2bb824d66412adc83c1b47031"

  url "https://github.com/joshyorko/homebrew-tools/releases/download/t3-code-linux-main.20260911170948.05d404210058/T3-Code-main.20260911170948.05d404210058-x86_64.AppImage"
  name "T3 Code"
  desc "Minimal GUI for AI code agents"
  homepage "https://t3.codes/"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  container type: :naked

  binary "t3-code-linux-wrapper", target: "t3-code-linux"
  artifact "t3-code-linux.desktop",
           target: "#{Dir.home}/.local/share/applications/t3-code-linux.desktop"
  artifact "t3-code-linux.png",
           target: "#{Dir.home}/.local/share/icons/hicolor/512x512/apps/t3-code-linux.png"

  preflight_steps do
    mkdir_p ".local/share/applications", base: :home
    mkdir_p ".local/share/icons/hicolor/512x512/apps", base: :home

    set_permissions "T3-Code-{{version}}-{{arch}}.AppImage", "+x"
    run "T3-Code-{{version}}-{{arch}}.AppImage",
        args: ["--appimage-extract"],
        base: :staged_path,
        chdir: "{{staged_path}}"

    run "/bin/bash", args: ["-euo", "pipefail", "-c", <<~'SH'], chdir: "{{staged_path}}"
      app_run="squashfs-root/AppRun"
      if [ ! -x "$app_run" ]; then
        echo "T3 Code AppRun is not executable" >&2
        exit 1
      fi

      desktop_source=$(/usr/bin/find squashfs-root -maxdepth 1 -type f -name '*.desktop' -print |
        LC_ALL=C /usr/bin/sort | /usr/bin/head -n 1)
      if [ -z "$desktop_source" ] || [ ! -f "$desktop_source" ]; then
        echo "No desktop entry found in extracted T3 Code AppImage" >&2
        exit 1
      fi
      /bin/cp "$desktop_source" "t3-code-linux.desktop"
      /bin/sed -i \
        -e "s|^Exec=.*|Exec={{HOMEBREW_PREFIX}}/bin/t3-code-linux %U|" \
        -e "s|^Icon=.*|Icon=$HOME/.local/share/icons/hicolor/512x512/apps/t3-code-linux.png|" \
        "t3-code-linux.desktop"

      icon_source=""
      icon_size=-1
      if [ -d squashfs-root/usr/share/icons/hicolor ]; then
        while IFS= read -r -d '' candidate; do
          dimensions="${candidate#*hicolor/}"
          dimensions="${dimensions%%x*}"
          if [[ "$dimensions" =~ ^[0-9]+$ ]] && [ "$dimensions" -gt "$icon_size" ]; then
            icon_size="$dimensions"
            icon_source="$candidate"
          fi
        done < <(/usr/bin/find squashfs-root/usr/share/icons/hicolor -type f -path '*/apps/*.png' -print0 |
          LC_ALL=C /usr/bin/sort -z)
      fi
      if [ -z "$icon_source" ]; then
        icon_source=$(/usr/bin/find squashfs-root -type f -name '*.png' -print |
          LC_ALL=C /usr/bin/sort | /usr/bin/head -n 1)
      fi
      if [ -z "$icon_source" ] || [ ! -f "$icon_source" ]; then
        echo "No PNG icon found in extracted T3 Code AppImage" >&2
        exit 1
      fi
      /bin/cp "$icon_source" "t3-code-linux.png"
    SH

    write_file "t3-code-linux-wrapper", <<~'SH'
      #!/bin/bash
      path_prepend_if_dir() {
        local dir="$1"
        [ -d "$dir" ] || return 0
        case ":${PATH:-}:" in
          *":$dir:"*) ;;
          *) PATH="$dir${PATH:+:$PATH}" ;;
        esac
      }

      PATH="${PATH:-/usr/local/bin:/usr/bin:/bin}"
      path_prepend_if_dir "{{HOMEBREW_PREFIX}}/bin"
      path_prepend_if_dir "{{HOMEBREW_PREFIX}}/sbin"
      path_prepend_if_dir "$HOME/.local/bin"
      path_prepend_if_dir "$HOME/bin"
      path_prepend_if_dir "$HOME/.cargo/bin"
      path_prepend_if_dir "$HOME/.deno/bin"
      path_prepend_if_dir "$HOME/.bun/bin"
      path_prepend_if_dir "$HOME/go/bin"
      path_prepend_if_dir "$HOME/.opencode/bin"
      path_prepend_if_dir "$HOME/.local/share/mise/shims"
      export PATH

      exec "{{staged_path}}/squashfs-root/AppRun" --no-sandbox "$@"
    SH
    set_permissions "t3-code-linux-wrapper", "+x"
  end

  zap trash: [
    "#{Dir.home}/.local/share/applications/t3-code-linux.desktop",
    "#{Dir.home}/.local/share/icons/hicolor/512x512/apps/t3-code-linux.png",
  ]

  caveats <<~EOS
    Launch the app with:
      t3-code-linux

    App launcher installed for immutable/atomic desktops:
      #{Dir.home}/.local/share/applications/t3-code-linux.desktop

    If it doesn't appear in your app grid immediately, log out and back in.
  EOS
end

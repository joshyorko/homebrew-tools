# frozen_string_literal: true

cask "devpod-linux" do
  arch intel: "amd64"
  os linux: "linux"

  version "0.26.1"
  sha256 x86_64_linux: "94b8e0ab24e5d1fb5db3d0a948c2f1046c2479c3f4a015208151b2990a445685"

  url "https://github.com/joshyorko/homebrew-tools/releases/download/devpod-linux-0.26.1/DevPod_linux_amd64.deb"
  name "DevPod"
  desc "Open-source dev environments based on devcontainer.json"
  homepage "https://github.com/skevetter/devpod"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  depends_on formula: "devpod-appindicator-runtime-tools"

  binary "usr/bin/devpod"
  binary "devpod-desktop-wrapper", target: "devpod-desktop"
  artifact "usr/share/applications/DevPod.desktop",
           target: "#{Dir.home}/.local/share/applications/sh.loft.devpod.desktop"
  artifact "usr/share/icons/hicolor/32x32/apps/DevPod Desktop.png",
           target: "#{Dir.home}/.local/share/icons/hicolor/32x32/apps/devpod-desktop.png"
  artifact "usr/share/icons/hicolor/128x128/apps/DevPod Desktop.png",
           target: "#{Dir.home}/.local/share/icons/hicolor/128x128/apps/devpod-desktop.png"
  artifact "usr/share/icons/hicolor/256x256@2/apps/DevPod Desktop.png",
           target: "#{Dir.home}/.local/share/icons/hicolor/256x256@2/apps/devpod-desktop.png"

  preflight_steps do
    mkdir_p ".local/share/applications", base: :home
    mkdir_p ".local/share/icons/hicolor/32x32/apps", base: :home
    mkdir_p ".local/share/icons/hicolor/128x128/apps", base: :home
    mkdir_p ".local/share/icons/hicolor/256x256@2/apps", base: :home

    run "/bin/bash", args: ["-eu", "-c", <<~'SH'], chdir: "{{staged_path}}"
      deb=""
      for candidate in DevPod_*_*.deb; do
        if [ -f "$candidate" ]; then
          deb="$candidate"
          break
        fi
      done
      if [ -z "$deb" ]; then
        echo "unable to find DevPod .deb in {{staged_path}}" >&2
        exit 1
      fi

      /usr/bin/ar x "$deb"

      data_archive=""
      for candidate in data.tar.*; do
        if [ -f "$candidate" ]; then
          data_archive="$candidate"
          break
        fi
      done
      if [ -z "$data_archive" ]; then
        echo "unable to find data archive in $deb" >&2
        exit 1
      fi

      case "$data_archive" in
        *.tar.gz)
          /usr/bin/tar -xzf "$data_archive" -C "{{staged_path}}"
          ;;
        *.tar.xz)
          /usr/bin/tar -xJf "$data_archive" -C "{{staged_path}}"
          ;;
        *.tar.zst)
          unzstd -c "$data_archive" | /usr/bin/tar -xf - -C "{{staged_path}}"
          ;;
        *)
          /usr/bin/tar -xf "$data_archive" -C "{{staged_path}}"
          ;;
      esac

      desktop_file="usr/share/applications/DevPod.desktop"
      /bin/sed -i \
        -e "s|^Exec=.*|Exec={{HOMEBREW_PREFIX}}/bin/devpod-desktop %U|" \
        -e "s|^Icon=.*|Icon=$HOME/.local/share/icons/hicolor/256x256@2/apps/devpod-desktop.png|" \
        "$desktop_file"
      if /bin/grep -Eq '^StartupWMClass=' "$desktop_file"; then
        /bin/sed -i 's|^StartupWMClass=.*|StartupWMClass=gdk-pixbuf-csource|' "$desktop_file"
      else
        /bin/printf '\nStartupWMClass=gdk-pixbuf-csource\n' >> "$desktop_file"
      fi
      if ! /bin/grep -Eq '^MimeType=.*x-scheme-handler/devpod;?' "$desktop_file"; then
        /bin/printf 'MimeType=x-scheme-handler/devpod;\n' >> "$desktop_file"
      fi
    SH

    write_file "devpod-desktop-wrapper", <<~'SH'
      #!/bin/bash
      # Desktop launchers on GNOME/Bluefin do not reliably inherit the user's
      # interactive shell PATH, so ensure both Homebrew and system XDG tools
      # are discoverable when DevPod tries to open IDEs or register handlers.
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
      export PATH

      APPINDICATOR_LIB_DIRS=(
        "${DEVPOD_APPINDICATOR_LIB_DIR:-}"
        "{{HOMEBREW_PREFIX}}/opt/devpod-appindicator-runtime-tools/lib"
        "{{HOMEBREW_PREFIX}}/opt/libayatana-appindicator/lib"
      )
      APPINDICATOR_SO_CANDIDATES=(
        "libayatana-appindicator3.so.1"
        "libappindicator3.so.1"
      )
      SYSTEM_LIB_DIRS=("/usr/lib64" "/usr/lib" "/lib64" "/lib")
      APPINDICATOR_SO=""
      APPINDICATOR_LIB=""
      DEVPOD_STATE_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/sh.loft.devpod"
      DEVPOD_SETTINGS_FILE="$DEVPOD_STATE_DIR/.settings.json"
      USER_MOTD_SENTINEL="$HOME/.config/no-show-user-motd"
      USER_MOTD_LOCK_DIR="${XDG_RUNTIME_DIR:-/tmp}/devpod-desktop-no-show-user-motd"
      USER_MOTD_LOCK_FILE="$USER_MOTD_LOCK_DIR/$$"
      USER_MOTD_SENTINEL_CREATED_BY_DEVPOD=0

      # Fedora/Bluefin GTK icon loading can crash when glycin spawns bwrap.
      # Allow users to override, but default to the known-safe setting.
      export GLYCIN_SANDBOX="${GLYCIN_SANDBOX:-off}"
      export WEBKIT_DISABLE_DMABUF_RENDERER="${WEBKIT_DISABLE_DMABUF_RENDERER:-1}"
      export GSK_RENDERER="${GSK_RENDERER:-ngl}"
      if [ "${XDG_SESSION_TYPE:-}" = "wayland" ] && [ -z "${GDK_BACKEND:-}" ]; then
        export GDK_BACKEND="wayland,x11"
      fi

      find_appindicator() {
        local candidate libdir

        for libdir in "${APPINDICATOR_LIB_DIRS[@]}"; do
          [ -n "$libdir" ] || continue
          for candidate in "${APPINDICATOR_SO_CANDIDATES[@]}"; do
            if [ -f "$libdir/$candidate" ]; then
              APPINDICATOR_SO="$candidate"
              APPINDICATOR_LIB="$libdir"
              return 0
            fi
          done
        done

        for candidate in "${APPINDICATOR_SO_CANDIDATES[@]}"; do
          if ldconfig -p 2>/dev/null | grep -Fq "$candidate"; then
            APPINDICATOR_SO="$candidate"
            return 0
          fi

          for libdir in "${SYSTEM_LIB_DIRS[@]}"; do
            if [ -f "$libdir/$candidate" ]; then
              APPINDICATOR_SO="$candidate"
              return 0
            fi
          done
        done

        return 1
      }

      if find_appindicator; then
        if [ -n "$APPINDICATOR_LIB" ]; then
          export LD_LIBRARY_PATH="$APPINDICATOR_LIB${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
        fi
      else
        echo "DevPod Desktop requires an AppIndicator runtime library."
        echo "Install one of:"
        echo "  brew install joshyorko/tools/devpod-appindicator-runtime-tools"
        echo "  rpm-ostree install libayatana-appindicator-gtk3"
        echo "  brew install libayatana-appindicator"
        exit 1
      fi

      APP_BIN="{{staged_path}}/usr/bin/DevPod Desktop"
      APP_ARGS=("$@")
      WATCH_COLOR_MODE_CHANGES="${DEVPOD_DESKTOP_WATCH_COLOR_MODE_CHANGES:-0}"
      COLOR_MODE_POLL_INTERVAL="${DEVPOD_DESKTOP_COLOR_MODE_POLL_INTERVAL:-2}"

      if ! [[ "$COLOR_MODE_POLL_INTERVAL" =~ ^[0-9]+$ ]] || [ "$COLOR_MODE_POLL_INTERVAL" -lt 1 ]; then
        COLOR_MODE_POLL_INTERVAL=2
      fi

      resolve_color_mode() {
        local mode
        mode="${DEVPOD_DESKTOP_FORCE_COLOR_MODE:-}"
        if [ -z "$mode" ] && [ -f "$DEVPOD_SETTINGS_FILE" ]; then
          mode="$(LC_ALL=C sed -nE 's/.*"experimental_colorMode"[[:space:]]*:[[:space:]]*"([^"]+)".*/\\1/p' "$DEVPOD_SETTINGS_FILE" | head -n1)"
        fi

        case "$mode" in
          dark|light)
            printf "%s" "$mode"
            ;;
          *)
            printf ""
            ;;
        esac
      }

      apply_color_mode_env() {
        case "$1" in
          dark)
            export GTK_THEME="Adwaita:dark"
            export GTK_APPLICATION_PREFER_DARK_THEME=1
            ;;
          light)
            export GTK_THEME="Adwaita"
            export GTK_APPLICATION_PREFER_DARK_THEME=0
            ;;
          *)
            unset GTK_THEME
            unset GTK_APPLICATION_PREFER_DARK_THEME
          ;;
        esac
      }

      enable_shell_probe_compat() {
        # VS Code Remote-SSH probes the user's shell for PATH and treats any
        # MOTD output as part of that value, which breaks ssh spawning.
        local existing_file

        mkdir -p "$HOME/.config" "$USER_MOTD_LOCK_DIR"
        : > "$USER_MOTD_LOCK_FILE"

        if [ ! -e "$USER_MOTD_SENTINEL" ]; then
          existing_file=0
          : > "$USER_MOTD_SENTINEL"
        else
          existing_file=1
        fi

        if [ "$existing_file" = "0" ]; then
          USER_MOTD_SENTINEL_CREATED_BY_DEVPOD=1
        fi
      }

      cleanup_shell_probe_compat() {
        local candidate
        local remaining_locks=0

        rm -f "$USER_MOTD_LOCK_FILE"

        if [ -d "$USER_MOTD_LOCK_DIR" ]; then
          for candidate in "$USER_MOTD_LOCK_DIR"/*; do
            [ -e "$candidate" ] || continue
            remaining_locks=1
            break
          done
        fi

        if [ "$USER_MOTD_SENTINEL_CREATED_BY_DEVPOD" = "1" ] && [ "$remaining_locks" = "0" ]; then
          rm -f "$USER_MOTD_SENTINEL"
        fi

        if [ "$remaining_locks" = "0" ]; then
          rmdir "$USER_MOTD_LOCK_DIR" 2>/dev/null || true
        fi
      }

      start_desktop() {
        apply_color_mode_env "$1"
        if [ "${DEVPOD_DESKTOP_NO_GLYCIN_WORKAROUND:-0}" = "1" ]; then
          "$APP_BIN" "${APP_ARGS[@]}" &
        else
          # gdk-pixbuf only disables glycin sandboxing for selected tool names.
          # Running as gdk-pixbuf-csource avoids a known bwrap spawn crash.
          (exec -a gdk-pixbuf-csource "$APP_BIN" "${APP_ARGS[@]}") &
        fi
        child_pid=$!
      }

      stop_desktop() {
        local pid="$1"
        local i
        if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
          return
        fi

        kill -TERM "$pid" 2>/dev/null || true
        for i in 1 2 3 4 5 6 7 8; do
          if ! kill -0 "$pid" 2>/dev/null; then
            return
          fi
          sleep 1
        done
        kill -KILL "$pid" 2>/dev/null || true
      }

      child_pid=""
      trap 'cleanup_shell_probe_compat; stop_desktop "$child_pid"; exit 143' INT TERM HUP
      trap 'cleanup_shell_probe_compat' EXIT

      enable_shell_probe_compat
      current_mode="$(resolve_color_mode)"
      if [ "$WATCH_COLOR_MODE_CHANGES" != "1" ] || [ -n "${DEVPOD_DESKTOP_FORCE_COLOR_MODE:-}" ]; then
        start_desktop "$current_mode"
        wait "$child_pid"
        exit $?
      fi

      while true; do
        start_desktop "$current_mode"
        while kill -0 "$child_pid" 2>/dev/null; do
          sleep "$COLOR_MODE_POLL_INTERVAL"
          next_mode="$(resolve_color_mode)"
          if [ -n "$next_mode" ] && [ "$next_mode" != "$current_mode" ]; then
            stop_desktop "$child_pid"
            wait "$child_pid" 2>/dev/null || true
            current_mode="$next_mode"
            continue 2
          fi
        done

        wait "$child_pid"
        exit $?
      done
    SH
    set_permissions "devpod-desktop-wrapper", "+x"
  end

  postflight_steps do
    mkdir_p ".config", base: :home
    run "/bin/bash", args: ["-eu", "-c", <<~'SH'],
      run_optional() {
        "$@" || true
      }

      for candidate in /usr/bin/xdg-mime /bin/xdg-mime "{{HOMEBREW_PREFIX}}/bin/xdg-mime"; do
        if [ -x "$candidate" ]; then
          run_optional "$candidate" default "sh.loft.devpod.desktop" "x-scheme-handler/devpod"
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
    "~/.cache/sh.loft.devpod",
    "~/.config/sh.loft.devpod",
    "~/.devpod",
    "~/.local/share/applications/devpod.desktop",
    "~/.local/share/applications/sh.loft.devpod.desktop",
    "~/.local/share/sh.loft.devpod",
  ]

  caveats <<~EOS
    Provider setup (validated against DevPod v0.12.16):

    Works by short name:
      devpod provider add docker
      devpod provider add kubernetes
      devpod provider add aws -o AWS_REGION=us-east-1
      devpod provider add gcloud -o PROJECT=<gcp-project-id>
      devpod provider add ssh -o HOST=<host-or-ip>

    Some list-available entries currently 404 by short name. Use explicit source:
      devpod provider add loft-sh/devpod-provider-azure
      devpod provider add loft-sh/devpod-provider-digitalocean
      devpod provider add loft-sh/devpod-provider-terraform
      devpod provider add loft-sh/devpod-provider-civo
      devpod provider add loft-sh/devpod-provider-ecs
      devpod provider add loft-sh/devpod-provider-dockerless

    Discover provider names:
      devpod provider list-available

    UI dependency note:
      This cask depends on a lightweight AppIndicator runtime formula:
        brew install joshyorko/tools/devpod-appindicator-runtime-tools

      It installs only the required Ayatana/dbusmenu runtime libraries,
      avoiding the heavier full Homebrew GTK dependency tree.

      Alternative system package path:
        rpm-ostree install libayatana-appindicator-gtk3

      Full Homebrew stack (heavier):
        brew install libayatana-appindicator

    Desktop launcher note:
      To avoid a GTK/glycin crash on some Bluefin/Fedora systems, the wrapper
      uses a gdk-pixbuf launcher path by default.
      To opt out and run with normal process identity:
        DEVPOD_DESKTOP_NO_GLYCIN_WORKAROUND=1 devpod-desktop

    Custom protocol note:
      The cask pre-registers the devpod:// scheme with:
        #{Dir.home}/.local/share/applications/sh.loft.devpod.desktop

    Color mode note:
      DevPod currently initializes new windows from system color mode.
      The wrapper maps your persisted experimental color mode to GTK on launch.
      Optional controls:
        DEVPOD_DESKTOP_WATCH_COLOR_MODE_CHANGES=1 devpod-desktop
        DEVPOD_DESKTOP_COLOR_MODE_POLL_INTERVAL=1 devpod-desktop
      Optional override:
        DEVPOD_DESKTOP_FORCE_COLOR_MODE=dark devpod-desktop
        DEVPOD_DESKTOP_FORCE_COLOR_MODE=light devpod-desktop
  EOS
end

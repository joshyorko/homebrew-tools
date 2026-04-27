class Eitype < Formula
  desc "Wayland text injection CLI using the EI protocol"
  homepage "https://github.com/Adam-D-Lewis/eitype"
  url "https://github.com/joshyorko/homebrew-tools/releases/download/eitype-0.2.1/eitype-0.2.1-homebrew-x86_64-linux.tar.gz"
  version "0.2.1"
  sha256 "10007b2ce047035ec8076882738bb99005885b001ebd0380738152c62145e11a"
  license "Apache-2.0"

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  depends_on arch: :x86_64
  depends_on :linux

  def install
    libexec.install "libexec/eitype"
    doc.install "README.md", "LICENSE"

    (bin/"eitype").write <<~SH
      #!/bin/bash
      set -euo pipefail

      brew_lib="#{HOMEBREW_PREFIX}/opt/libxkbcommon/lib"
      brew_xkb_root="#{HOMEBREW_PREFIX}/share/X11/xkb"

      have_system_lib() {
        if command -v ldconfig >/dev/null 2>&1 && ldconfig -p 2>/dev/null | grep -q 'libxkbcommon\\.so\\.0'; then
          return 0
        fi

        for path in \
          /lib64/libxkbcommon.so.0 \
          /usr/lib64/libxkbcommon.so.0 \
          /lib/x86_64-linux-gnu/libxkbcommon.so.0 \
          /usr/lib/x86_64-linux-gnu/libxkbcommon.so.0
        do
          if [ -e "$path" ]; then
            return 0
          fi
        done

        return 1
      }

      if have_system_lib; then
        exec "#{libexec}/eitype" "$@"
      fi

      if [ -e "${brew_lib}/libxkbcommon.so.0" ]; then
        export LD_LIBRARY_PATH="${brew_lib}${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"

        if [ -d "${brew_xkb_root}" ] && [ -z "${XKB_CONFIG_ROOT:-}" ]; then
          export XKB_CONFIG_ROOT="${brew_xkb_root}"
        fi

        exec "#{libexec}/eitype" "$@"
      fi

      cat >&2 <<'EOF'
      eitype needs libxkbcommon.so.0 at runtime.

      This launcher checked for:
        - a host system libxkbcommon runtime
        - Homebrew's optional libxkbcommon fallback

      Install one of:
        brew install libxkbcommon
        or the equivalent host package for your distro
      EOF
      exit 1
    SH
  end

  def caveats
    <<~EOS
      This formula checks for `libxkbcommon.so.0` at runtime instead of pulling
      Homebrew's full desktop/X11 dependency tree by default.

      Launch behavior:
        1. Prefer the host system runtime when it already exists
        2. Fall back to Homebrew's copy if you later run `brew install libxkbcommon`
        3. Exit with a clear error if neither runtime is available

      On GNOME, KDE, Bluefin, and most other Wayland desktops, the host runtime
      is already present.
    EOS
  end

  test do
    assert_path_exists libexec/"eitype"
    output = shell_output("#{bin}/eitype --version")
    assert_match version.to_s, output
  end
end

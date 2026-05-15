class CodexDesktop < Formula
  desc "Linux runtime for a DMG-converted Codex Desktop app"
  homepage "https://github.com/joshyorko/homebrew-tools"
  url "https://github.com/joshyorko/homebrew-tools/releases/download/codex-desktop-linux-research.20260514171029.43c8bd1b5d4a/codex-desktop-linux-research.20260514171029.43c8bd1b5d4a.tar.gz"
  version "research.20260514171029.43c8bd1b5d4a"
  sha256 "74059141240bd2d2d345d01bc5dee6cc0b0f341f83b25973de2bb36712a99d96"

  livecheck do
    skip "Built from an explicit official Codex.dmg input via Dagger."
  end

  depends_on :linux

  def install
    libexec.install Dir["*"]
    bin.install_symlink libexec/"bin/codex-desktop"
  end

  def post_install
    system(
      { "CODEX_DESKTOP_BIN" => "#{HOMEBREW_PREFIX}/bin/codex-desktop" },
      "#{bin}/codex-desktop",
      "install-desktop-entry"
    )
  end

  def caveats
    <<~EOS
      This formula is rendered from a Dagger build that converts an explicit
      official Codex.dmg into a Linux Electron runtime.

      Launch from your app grid as Codex Desktop, or run:
        codex-desktop

      Logs and diagnostics:
        codex-desktop logs
        codex-desktop logs --follow
        codex-desktop doctor

      Desktop launcher installed for immutable/atomic desktops:
        #{Dir.home}/.local/share/applications/codex-desktop.desktop
    EOS
  end

  test do
    output = shell_output("#{bin}/codex-desktop --help")
    assert_match "Usage: codex-desktop", output
    assert_match "desktop", output
  end
end

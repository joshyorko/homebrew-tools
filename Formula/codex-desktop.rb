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

  def caveats
    <<~EOS
      This formula is rendered from a Dagger build that converts an explicit
      official Codex.dmg into a Linux Electron runtime.

      Useful commands:
        codex-desktop --help
        codex-desktop desktop
        codex-desktop doctor
        codex-desktop install-desktop-entry
        codex-desktop web --inspect

      Build the runtime artifact through the tap's Dagger pipeline with an
      explicit official Codex.dmg input.
    EOS
  end

  test do
    output = shell_output("#{bin}/codex-desktop --help")
    assert_match "Usage: codex-desktop", output
    assert_match "desktop", output
  end
end

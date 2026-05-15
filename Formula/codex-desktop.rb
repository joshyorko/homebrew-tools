class CodexDesktop < Formula
  desc "Personal Linux runtime skeleton for Codex Desktop"
  homepage "https://github.com/joshyorko/homebrew-tools"
  url "https://github.com/joshyorko/homebrew-tools/releases/download/codex-desktop-linux-research.20260514171029.43c8bd1b5d4a/codex-desktop-linux-research.20260514171029.43c8bd1b5d4a.tar.gz"
  version "research.20260514171029.43c8bd1b5d4a"
  sha256 "74059141240bd2d2d345d01bc5dee6cc0b0f341f83b25973de2bb36712a99d96"
  license :cannot_represent

  livecheck do
    skip "Personal build from an explicit official Codex.dmg input via Dagger."
  end

  depends_on :linux

  def install
    libexec.install Dir["*"]
    bin.install_symlink libexec/"bin/codex-desktop"
  end

  def caveats
    <<~EOS
      This formula installs the conservative Codex Desktop Linux runtime skeleton.
      It does not redistribute the proprietary Codex Desktop app payload.

      Useful commands:
        codex-desktop --help
        codex-desktop doctor
        codex-desktop install-desktop-entry
        codex-desktop web --inspect

      Build a private runtime artifact through the tap's Dagger pipeline with an
      explicit official Codex.dmg input before using:
        codex-desktop desktop
    EOS
  end

  test do
    output = shell_output("#{bin}/codex-desktop --help")
    assert_match "Usage: codex-desktop", output
    assert_match "doctor", output
  end
end

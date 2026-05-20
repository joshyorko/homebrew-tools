class CodexDesktopLinuxBuilder < Formula
  desc "Local builder for Codex Desktop Linux from the official OpenAI DMG"
  homepage "https://github.com/joshyorko/homebrew-tools"
  license "MIT"
  head "https://github.com/joshyorko/homebrew-tools.git", branch: "main"

  depends_on "dagger"
  depends_on :linux

  def install
    libexec.install ".github", "Casks", "Formula", "dagger", "scripts", "README.md"

    (bin/"codex-desktop-linux-builder").write <<~SH
      #!/usr/bin/env bash
      exec "#{libexec}/scripts/install-codex-desktop-local.sh" "$@"
    SH
  end

  def caveats
    <<~EOS
      This installs only builder/bootstrap tooling.

      It does not install or distribute a converted Codex Desktop app payload.
      Run the builder to download the official OpenAI DMG on this machine,
      convert it locally, render a temporary local cask, and install that cask:

        codex-desktop-linux-builder

      For a build-only smoke run:

        codex-desktop-linux-builder --skip-install --bundle-dir /tmp/codex-desktop-local
    EOS
  end

  test do
    output = shell_output("#{bin}/codex-desktop-linux-builder --help")
    assert_match "official OpenAI DMG", output
    assert_match "--skip-install", output
  end
end

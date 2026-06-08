class CodexRelease < Formula
  desc "Codex CLI built from Josh Yorko's tap-release branch fork"
  homepage "https://github.com/joshyorko/codex/tree/tap-release"
  url "https://github.com/joshyorko/homebrew-tools/releases/download/codex-release-release.20260606000000.000000000000/codex-release-release.20260606000000.000000000000.tar.gz"
  version "release.20260606000000.000000000000"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"
  license "Apache-2.0"
  version_scheme 1

  livecheck do
    skip "Updated by the tap's GitHub Actions workflow."
  end

  depends_on :linux

  def install
    libexec.install Dir["*"]

    (bin/"codex").write <<~SH
      #!/bin/bash
      exec "#{libexec}/bin/codex" "$@"
    SH
  end

  def caveats
    <<~EOS
      This formula tracks Josh Yorko's Codex fork tap-release branch:
        https://github.com/joshyorko/codex/tree/tap-release

      The unique formula name keeps it separate from any upstream `codex` package,
      but the installed executable stays `codex`.
      Uninstall the official `codex` cask first if it already owns that executable.
    EOS
  end

  test do
    shell_output("#{bin}/codex --help")
  end
end

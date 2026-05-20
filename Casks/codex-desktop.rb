cask "codex-desktop" do
  version "local-only"
  sha256 :no_check

  url "https://github.com/joshyorko/homebrew-tools"
  name "Codex Desktop"
  desc "Local-only Codex Desktop Linux builder; no converted app payload is distributed"
  homepage "https://github.com/joshyorko/homebrew-tools"

  disable! date: "2026-05-20", because: "converted Codex Desktop app artifacts are no longer distributed by this tap"

  caveats <<~EOS
    Codex Desktop is local-only in this tap.

    Build from the official OpenAI DMG on this machine and install with:
      brew install --HEAD joshyorko/tools/codex-desktop-linux-builder
      codex-desktop-linux-builder
  EOS
end
